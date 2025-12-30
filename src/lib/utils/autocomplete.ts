// src/lib/utils/autocomplete.ts
import type { Action } from 'svelte/action';

// ... (Keep loadGoogleMaps and imports same as before) ...
let loadingPromise: Promise<void> | null = null;
let googleMapsError = false;

export async function loadGoogleMaps(apiKey: string): Promise<void> {
	// ... (Keep existing loader) ...
	if (typeof google !== 'undefined' && google.maps) return Promise.resolve();
	if (googleMapsError) return Promise.reject(new Error('Google Maps previously failed'));
	if (loadingPromise) return loadingPromise;
	// ...
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

// [!code fix] Strict render validator
function isRenderableCandidate(result: any, input: string) {
	if (!result) return false;
	// Always show Google results
	if (result.source === 'google' || result.source === 'google_proxy') return true;

	// 1. Sanity: Never render numeric-only names
	if (result.name && String(result.name).trim().match(/^\d+$/)) return false;

	// 2. Address Logic
	// If input matches "123 Mastin" pattern
	const inputIsAddress = /^\d+\s+\w+/i.test(input);

	if (inputIsAddress) {
		const hn = result.house_number || (result.properties && result.properties.housenumber);
		const st = result.street || (result.properties && result.properties.street);

		// If NO house number AND NO street, it is likely a city/district match (e.g. "Louisville")
		// Reject it immediately to force fallback logic
		if (!hn && !st) return false;

		// Optional: Ensure the street name in result partially matches input
		// (Prevents "407" matching an unrelated "District 407")
		const nm = result.name || '';
		const inputStreetMatch = input.match(/^\d+\s+(.+)$/);
		if (inputStreetMatch && inputStreetMatch[1]) {
			const inputStreetToken = inputStreetMatch[1].split(' ')[0].toLowerCase(); // "mastin"
			const resultText = (nm + ' ' + (st || '')).toLowerCase();
			if (inputStreetToken.length > 3 && !resultText.includes(inputStreetToken)) {
				return false;
			}
		}
	}
	return true;
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
		// ... (Keep existing UI setup) ...
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
		// ... (Keep parent appending logic) ...
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
		// ... (Keep event listeners) ...
		stop = (e: Event) => e.stopPropagation();
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
		// ... (Keep existing position logic) ...
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
				const startTime = performance.now();
				const kvUrl = `/api/autocomplete?q=${encodeURIComponent(value)}`;
				const kvRes = await fetch(kvUrl);
				const data = await kvRes.json();
				const time = Math.round(performance.now() - startTime);

				let validData = Array.isArray(data) ? data : [];
				let source: 'kv' | 'google' | 'photon' = 'kv';

				if (validData.length > 0) {
					if (validData[0].source === 'google_proxy') source = 'google';
					if (validData[0].source === 'photon') source = 'photon';
				}

				// [!code fix] Mandatory: Strict Filter BEFORE rendering
				let filtered = validData;
				if (source === 'photon') {
					filtered = validData.filter((item: any) => isRenderableCandidate(item, value));
				}

				// [!code fix] Escalation Logic: If Photon gave us junk, ask Server to force Google
				if (source === 'photon' && filtered.length === 0 && validData.length > 0) {
					console.warn('[autocomplete] OSRM results rejected. Escalating to Google...');
					try {
						const googleUrl = `/api/autocomplete?q=${encodeURIComponent(value)}&forceGoogle=true`;
						const googleRes = await fetch(googleUrl);
						const googleData = await googleRes.json();

						if (Array.isArray(googleData) && googleData.length > 0) {
							validData = googleData;
							source = 'google';
							filtered = googleData; // Google results are trusted
						}
					} catch (err) {
						console.error('[autocomplete] Google escalation failed', err);
					}
				}

				if (filtered.length > 0) {
					// Cache external results (remove source tag)
					if (source !== 'kv') {
						const cleanResults = filtered.map(({ source, ...rest }) => {
							void source;
							return rest;
						});
						cacheToKV(value, cleanResults);
					}
					renderResults(filtered.slice(0, 5), source, time);
				} else {
					renderEmpty();
				}
			} catch (err: unknown) {
				console.error('[autocomplete] search failed', err);
				renderError();
			}
		}, 300);
	}

	// ... (Keep existing helpers: cacheToKV, savePlaceToKV) ...
	async function cacheToKV(query: string, results: Array<Record<string, unknown>>) {
		try {
			fetch('/api/autocomplete/cache', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query, results })
			});
		} catch (_e) {
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
		} catch (_e) {
			void _e;
		}
	}

	function renderResults(
		items: Array<Record<string, unknown>>,
		source: 'kv' | 'google' | 'photon' = 'kv',
		timing?: number
	) {
		if (!dropdown) return;
		while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);

		const header = document.createElement('div');
		let sourceLabel = '⚡ Fast Cache';
		let sourceColor = '#10B981';

		if (source === 'google') {
			sourceLabel = '📍 Google Live';
			sourceColor = '#4285F4';
		} else if (source === 'photon') {
			sourceLabel = '🗺️ OpenMap';
			sourceColor = '#F59E0B';
		}

		const leftSpan = document.createElement('span');
		leftSpan.style.color = sourceColor;
		leftSpan.style.fontWeight = '500';
		leftSpan.textContent = sourceLabel;
		header.appendChild(leftSpan);

		if (timing) {
			const timingSpan = document.createElement('span');
			timingSpan.style.color = '#9AA0A6';
			timingSpan.style.fontSize = '11px';
			timingSpan.textContent = `${timing}ms`;
			header.appendChild(timingSpan);
		}

		Object.assign(header.style, {
			display: 'flex',
			justifyContent: 'space-between',
			alignItems: 'center',
			padding: '8px 16px',
			borderBottom: '1px solid #f1f3f4',
			fontSize: '11px',
			textTransform: 'uppercase',
			letterSpacing: '0.5px',
			backgroundColor: '#f8f9fa'
		});
		dropdown.appendChild(header);

		items.forEach((item) => {
			// ... (Keep existing item rendering) ...
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

		if (source === 'google') {
			const footer = document.createElement('div');
			Object.assign(footer.style, { textAlign: 'right', padding: '4px 16px' });
			const poweredImg = document.createElement('img');
			poweredImg.src =
				'https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png';
			poweredImg.alt = 'Powered by Google';
			poweredImg.style.height = '12px';
			poweredImg.style.opacity = '0.7';
			footer.appendChild(poweredImg);
			dropdown.appendChild(footer);
		}

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

		// [!code fix] We trust our filtered list now, so we can be lighter here
		// But still good to ensure we have geometry for Photon items
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
				} catch (err) {
					console.error('Details fetch failed', err);
				}
			}
			commitSelection(item);
		} else {
			if (source === 'photon') savePlaceToKV(item);
			commitSelection(item);
		}
	}

	function commitSelection(data: Record<string, unknown>) {
		// ... (Keep existing commit logic) ...
		node.value = (data['formatted_address'] as string) || (data['name'] as string);
		node.dispatchEvent(new Event('input', { bubbles: true }));
		node.dispatchEvent(new CustomEvent('place-selected', { detail: data }));
		setTimeout(() => {
			try {
				node.focus();
			} catch (_e) {
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
					} catch (_e) {
						void _e;
					}
				}, 500);
			} catch (_e) {
				void _e;
			}
		}
		if (dlg && !(dlg as HTMLDialogElement).open) {
			try {
				(dlg as HTMLDialogElement).showModal();
			} catch (_e) {
				void _e;
			}
			setTimeout(() => {
				try {
					node.focus();
				} catch (_e) {
					void _e;
				}
			}, 60);
		}
	}

	initUI();
	// ... (Keep event listeners and cleanup) ...
	node.addEventListener('input', handleInput);
	node.addEventListener('focus', () => {
		if (node.value.length > 1) {
			const inputEvent = new Event('input', { bubbles: true });
			Object.defineProperty(inputEvent, 'target', { value: node, enumerable: true });
			handleInput(inputEvent);
		}
	});
	node.addEventListener('blur', () =>
		setTimeout(() => {
			if (dropdown) dropdown.style.display = 'none';
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
