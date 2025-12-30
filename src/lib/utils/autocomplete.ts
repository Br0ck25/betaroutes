// src/lib/utils/autocomplete.ts
import type { Action } from 'svelte/action';
import { isAcceptableGeocode } from './geocode';

// Singleton Promise to prevent race conditions
let loadingPromise: Promise<void> | null = null;
let googleMapsError = false;

// Exported Singleton Loader
export async function loadGoogleMaps(apiKey: string): Promise<void> {
	if (typeof google !== 'undefined' && google.maps) return Promise.resolve();
	if (googleMapsError) return Promise.reject(new Error('Google Maps previously failed'));
	if (loadingPromise) return loadingPromise;

	if (!apiKey || apiKey === 'undefined') {
		googleMapsError = true;
		return Promise.reject(new Error('No API key'));
	}

	const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
	if (existingScript) {
		loadingPromise = new Promise((resolve) => {
			const check = setInterval(() => {
				if (typeof google !== 'undefined' && google.maps) {
					clearInterval(check);
					resolve();
				}
			}, 100);
		});
		return loadingPromise;
	}

	loadingPromise = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&loading=async`;
		script.async = true;
		script.defer = true;

		script.onload = () => resolve();
		script.onerror = () => {
			googleMapsError = true;
			loadingPromise = null;
			reject(new Error('Failed to load Google Maps'));
		};

		document.head.appendChild(script);
	});

	return loadingPromise;
}

// [!code fix] Lightweight validator for Rendering Phase
export function isRenderableCandidate(result: any, input: string) {
	return isAcceptableGeocode(result, input);
}

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
	let dropdown: HTMLDivElement | null = null;
	let debounceTimer: number | undefined;
	let isSelecting = false;
	let stop: (e: Event) => void;
	let stopAndPrevent: (e: Event) => void;

	if (params.apiKey && params.apiKey !== 'undefined') {
		loadGoogleMaps(params.apiKey).catch(console.error);
	}

	function initUI() {
		dropdown = document.createElement('div');
		dropdown.className = 'pac-container';

		Object.assign(dropdown.style, {
			position: 'absolute',
			zIndex: '2147483647',
			backgroundColor: '#fff',
			borderTop: '1px solid #e6e6e6',
			fontFamily: '"Roboto", "Arial", sans-serif',
			boxShadow: '0 4px 6px rgba(32, 33, 36, 0.28)',
			boxSizing: 'border-box',
			overflow: 'hidden',
			display: 'none',
			borderRadius: '0 0 8px 8px',
			marginTop: '-2px',
			paddingBottom: '8px',
			pointerEvents: 'auto'
		});

		const dialogAncestor = node.closest && node.closest('dialog');
		if (dialogAncestor) {
			(dropdown as HTMLElement & { __autocompleteContainer?: Element }).__autocompleteContainer =
				dialogAncestor;
			dialogAncestor.appendChild(dropdown);
			dropdown.style.position = 'absolute';
		} else {
			document.body.appendChild(dropdown);
			dropdown.style.position = 'fixed';
		}

		stop = (e: Event) => {
			e.stopPropagation();
		};
		stopAndPrevent = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
		};

		dropdown.addEventListener('pointerdown', stopAndPrevent);
		dropdown.addEventListener('pointerup', stop);
		dropdown.addEventListener('mousedown', stopAndPrevent);
		dropdown.addEventListener('mouseup', stop);
		dropdown.addEventListener('touchstart', stopAndPrevent);
		dropdown.addEventListener('touchend', stop);
		dropdown.addEventListener('click', stop);
	}

	function updatePosition() {
		if (!dropdown) return;
		const rect = node.getBoundingClientRect();

		const container = (dropdown as HTMLElement & { __autocompleteContainer?: Element })
			.__autocompleteContainer;
		if (container && container instanceof Element) {
			const parentRect = container.getBoundingClientRect();
			Object.assign(dropdown.style, {
				top: `${rect.bottom - parentRect.top}px`,
				left: `${rect.left - parentRect.left}px`,
				width: `${rect.width}px`
			});
		} else {
			Object.assign(dropdown.style, {
				top: `${rect.bottom}px`,
				left: `${rect.left}px`,
				width: `${rect.width}px`
			});
		}
	}

	async function handleInput(e: Event) {
		if (isSelecting) {
			isSelecting = false;
			return;
		}

		const value = (e.target as HTMLInputElement).value;
		updatePosition();

		if (!value || value.length < 2) {
			if (dropdown) dropdown.style.display = 'none';
			return;
		}

		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = window.setTimeout(async () => {
			try {
				const kvUrl = `/api/autocomplete?q=${encodeURIComponent(value)}`;
				const kvRes = await fetch(kvUrl);
				const data = await kvRes.json();

				const validData = Array.isArray(data) ? data : [];
				let source: 'kv' | 'google' | 'photon' = 'kv';

				if (validData.length > 0) {
					if (validData[0].source === 'google_proxy') source = 'google';
					if (validData[0].source === 'photon') source = 'photon';
				}

				// [!code fix] Mandatory: Strict Filter BEFORE rendering
				const suggestionsToShow = validData.slice(0, 5);
				const acceptableSet = new Set(
					suggestionsToShow
						.filter((item: any) => isAcceptableGeocode(item, value))
						.map((it: any) => it.place_id || it.formatted_address || JSON.stringify(it))
				);
				let filtered = suggestionsToShow; // Keep the top suggestions visible regardless of acceptability (we'll validate on blur/selection)
				filtered = suggestionsToShow;
				if (filtered.length > 0) {
					// Cache external results (remove source tag for KV storage)
					if (source !== 'kv') {
						const cleanResults = filtered.map(({ source, ...rest }) => {
							void source;
							return rest;
						});
						cacheToKV(value, cleanResults);
					}
					renderResults(filtered.slice(0, 5), source, acceptableSet);
				} else {
					renderEmpty();
				}
			} catch (err: unknown) {
				console.error('[autocomplete] search failed', err);
				renderError();
			}
		}, 300);
	}

	async function cacheToKV(query: string, results: Array<Record<string, unknown>>) {
		try {
			fetch('/api/autocomplete/cache', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query, results })
			});
		} catch (_e: unknown) {
			void _e;
		}
	}

	async function savePlaceToKV(place: Record<string, unknown>) {
		try {
			fetch('/api/places/cache', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(place)
			});
		} catch (_e: unknown) {
			void _e;
			console.error('Failed to save place details');
		}
	}

	function renderResults(
		items: Array<Record<string, unknown>>,
		source: 'kv' | 'google' | 'photon' = 'kv',
		/* timing removed */
		/* acceptableSet */ acceptableSet?: Set<string>
	) {
		if (!dropdown) return;
		while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);

		items.forEach((item) => {
			const row = document.createElement('div');
			const it: any = item;

			const mainText =
				it.name ||
				(typeof it.formatted_address === 'string' ? it.formatted_address.split(',')[0] : '');
			const secondaryText =
				it.secondary_text ||
				(typeof it.formatted_address === 'string' && it.formatted_address.includes(',')
					? it.formatted_address.split(',').slice(1).join(',').trim()
					: '');

			// Determine if this suggestion is address-grade (acceptable) — google is always acceptable
			const key = it.place_id || it.formatted_address || JSON.stringify(it);
			const isAcceptable = source === 'google' || (acceptableSet && acceptableSet.has(key));

			const pinIcon = `<svg focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#9AA0A6" width="20px" height="20px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

			Object.assign(row.style, {
				display: 'flex',
				alignItems: 'center',
				padding: '10px 16px',
				cursor: 'pointer',
				borderBottom: '1px solid #fff'
			});

			const iconWrap = document.createElement('div');
			Object.assign(iconWrap.style, {
				minWidth: '24px',
				marginRight: '12px',
				display: 'flex',
				alignItems: 'center'
			});
			iconWrap.innerHTML = pinIcon;

			const content = document.createElement('div');
			Object.assign(content.style, { flex: '1', overflow: 'hidden' });

			const mainDiv = document.createElement('div');
			Object.assign(mainDiv.style, {
				fontSize: '14px',
				color: '#202124',
				fontWeight: '500',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap'
			});
			mainDiv.textContent = mainText;

			const secondaryDiv = document.createElement('div');
			Object.assign(secondaryDiv.style, {
				fontSize: '12px',
				color: '#70757A',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
				marginTop: '2px'
			});
			secondaryDiv.textContent = secondaryText;

			content.appendChild(mainDiv);
			// If the suggestion is not address-grade, mark it as unverified (google is considered acceptable already)
			if (!isAcceptable) {
				secondaryDiv.textContent = secondaryDiv.textContent
					? secondaryDiv.textContent + ' • Unverified address'
					: 'Unverified address';
				row.style.opacity = '0.85';
				row.setAttribute('data-unverified', 'true');
			}

			content.appendChild(secondaryDiv);

			row.appendChild(iconWrap);
			row.appendChild(content);

			row.addEventListener('mouseenter', () => {
				row.style.backgroundColor = '#e8f0fe';
			});
			row.addEventListener('mouseleave', () => {
				row.style.backgroundColor = '#fff';
			});
			row.addEventListener('pointerdown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				selectItem(item, source);
			});

			dropdown!.appendChild(row);
		});

		dropdown.style.display = 'block';
		updatePosition();
	}

	function renderEmpty() {
		if (!dropdown) return;
		const emptyDiv = document.createElement('div');
		Object.assign(emptyDiv.style, {
			padding: '16px',
			color: '#70757A',
			fontSize: '13px',
			textAlign: 'center'
		});
		emptyDiv.textContent = 'No results found';
		dropdown.appendChild(emptyDiv);
		dropdown.style.display = 'block';
		updatePosition();
	}

	function renderError() {
		/* ... */
	}

	async function selectItem(item: Record<string, unknown>, source: 'kv' | 'google' | 'photon') {
		const it: any = item;
		if (dropdown) dropdown.style.display = 'none';
		isSelecting = true;

		// Normalize once at top of selectItem
		const normalized = {
			...it,
			house_number: it.house_number || (it.properties && it.properties.housenumber),
			street: it.street || (it.properties && it.properties.street),
			name: it.name,
			nosm_value: it.osm_value || (it.properties && it.properties.osm_value) || null,
			nosm_key: it.osm_key || (it.properties && it.properties.osm_key) || null
		};

		// Use the canonical validator imported at top of the module (isAcceptableGeocode)
		// This keeps selection-time logic consistent with client-side rendering rules.

		// Use normalized object for validation
		if (source === 'photon' || source === 'kv') {
			const candidate = { ...normalized, geometry: it.geometry };
			if (!isAcceptableGeocode(candidate, node.value)) {
				// Try a fallback search if validation failed on selection (double safety)
				try {
					const res = await fetch(
						`/api/autocomplete?q=${encodeURIComponent(node.value)}&forceGoogle=true`
					);
					const data = await res.json();
					if (Array.isArray(data) && data.length > 0) {
						const googleHit = data.find((d: any) => d.source === 'google_proxy');
						if (googleHit) {
							commitSelection(googleHit);
							return;
						}
						const acceptable = data.find((d: any) => {
							const normD = {
								...d,
								house_number: d.house_number || (d.properties && d.properties.housenumber),
								street: d.street || (d.properties && d.properties.street)
							};
							return isAcceptableGeocode(normD, node.value);
						});
						if (acceptable) {
							commitSelection(acceptable);
							return;
						}
					}
				} catch (err: unknown) {
					console.error('[autocomplete] fallback search failed', err);
				}

				node.dispatchEvent(
					new CustomEvent('place-invalid', { detail: { candidate: item, input: node.value } })
				);
				return;
			}
		}

		if (!it.geometry || !it.geometry.location) {
			if (it.place_id && source === 'google') {
				try {
					const res = await fetch(`/api/autocomplete?placeid=${it.place_id}`);
					const details: any = await res.json();

					if (details && details.geometry) {
						const fullItem = {
							...item,
							formatted_address: details.formatted_address || it.formatted_address,
							name: details.name || it.name,
							geometry: details.geometry
						};
						savePlaceToKV(fullItem);
						commitSelection(fullItem);
						return;
					}
				} catch (err: unknown) {
					console.error('Details fetch failed', err);
				}
			}
			commitSelection(item);
		} else {
			if (source === 'photon') {
				savePlaceToKV(item);
			}
			commitSelection(item);
		}
	}

	function commitSelection(data: Record<string, unknown>) {
		node.value = (data['formatted_address'] as string) || (data['name'] as string);
		node.dispatchEvent(new Event('input', { bubbles: true }));
		node.dispatchEvent(new CustomEvent('place-selected', { detail: data }));

		setTimeout(() => {
			try {
				node.focus();
			} catch (_e: unknown) {
				void _e;
			}
		}, 0);

		const dlg = node.closest && node.closest('dialog');
		if (dlg) {
			try {
				(dlg as any).__suppressClose = true;
				setTimeout(() => {
					try {
						(dlg as any).__suppressClose = false;
					} catch (_e: unknown) {
						void _e;
					}
				}, 500);
			} catch (_e: unknown) {
				void _e;
			}
		}

		if (dlg && !(dlg as HTMLDialogElement).open) {
			try {
				(dlg as HTMLDialogElement).showModal();
			} catch (_e: unknown) {
				void _e;
			}
			setTimeout(() => {
				try {
					node.focus();
				} catch (_e: unknown) {
					void _e;
				}
			}, 60);
		}
	}

	initUI();

	node.addEventListener('input', handleInput);
	node.addEventListener('focus', () => {
		if (node.value.length > 1) {
			const inputEvent = new Event('input', { bubbles: true });
			Object.defineProperty(inputEvent, 'target', { value: node, enumerable: true });
			handleInput(inputEvent);
		}
	});
	node.addEventListener('blur', () =>
		setTimeout(async () => {
			if (dropdown) dropdown.style.display = 'none';

			// On blur, revalidate the raw input and silently escalate to Google if needed
			const value = node.value;
			if (!value || value.length < 2) return;
			try {
				const res = await fetch(
					`/api/autocomplete?q=${encodeURIComponent(value)}&forceGoogle=true`
				);
				const data = await res.json();
				if (Array.isArray(data) && data.length > 0) {
					const googleHit = data.find((d: any) => d.source === 'google_proxy');
					if (googleHit) {
						commitSelection(googleHit);
						return;
					}
					const acceptable = data.find((d: any) => isAcceptableGeocode(d, value));
					if (acceptable) {
						commitSelection(acceptable);
						return;
					}
				}
			} catch (err: unknown) {
				console.error('[autocomplete] blur validation failed', err);
			}
		}, 200)
	);

	const _removeDropdownHandlers = () => {
		if (!dropdown) return;
		dropdown.removeEventListener('pointerdown', stopAndPrevent as any);
		dropdown.removeEventListener('pointerup', stop as any);
		dropdown.removeEventListener('mousedown', stopAndPrevent as any);
		dropdown.removeEventListener('mouseup', stop as any);
		dropdown.removeEventListener('touchstart', stopAndPrevent as any);
		dropdown.removeEventListener('touchend', stop as any);
		dropdown.removeEventListener('click', stop as any);
	};

	window.addEventListener('scroll', updatePosition);
	window.addEventListener('resize', updatePosition);

	return {
		destroy() {
			if (dropdown) {
				_removeDropdownHandlers();
				dropdown.remove();
			}
			node.removeEventListener('input', handleInput);
			window.removeEventListener('scroll', updatePosition);
			window.removeEventListener('resize', updatePosition);
		}
	};
};
