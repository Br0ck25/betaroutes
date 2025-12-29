// src/lib/utils/autocomplete.ts
import type { Action } from 'svelte/action';

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
		// Note: We still load 'places' lib for types, but we won't call AutocompleteService
		// Use Google's recommended loading pattern to avoid the "loaded directly without loading=async" warning
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

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
	let dropdown: HTMLDivElement | null = null;
	let debounceTimer: number | undefined;
	let isSelecting = false;
	// Event handlers for dropdown - declared here so cleanup can access the same references
	let stop: (e: Event) => void;
	let stopAndPrevent: (e: Event) => void;

	if (params.apiKey && params.apiKey !== 'undefined') {
		loadGoogleMaps(params.apiKey).catch(console.error);
	}

	// Prefer appending the dropdown to the nearest <dialog> (modal) when present.
	// This prevents native dialog backdrops from intercepting clicks on the dropdown.
	function initUI() {
		dropdown = document.createElement('div');
		dropdown.className = 'pac-container';

		Object.assign(dropdown.style, {
			position: 'absolute', // may be changed to 'fixed' when appended to <body>
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

		// If the input is inside a native <dialog>, append the dropdown to that dialog
		// so it sits above the backdrop and is selectable. Otherwise append to document.body
		const dialogAncestor = node.closest && node.closest('dialog');
		if (dialogAncestor) {
			(dropdown as HTMLElement & { __autocompleteContainer?: Element }).__autocompleteContainer =
				dialogAncestor; // store ref for cleanup
			dialogAncestor.appendChild(dropdown);
			// Keep position absolute (relative to the dialog)
			dropdown.style.position = 'absolute';
		} else {
			document.body.appendChild(dropdown);
			// Use fixed positioning when attached to body so it stays aligned to viewport
			dropdown.style.position = 'fixed';
		}

		// Prevent clicks inside the dropdown from bubbling up to the <dialog> backdrop or other parent handlers
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
			// Dropdown is inside a dialog; compute position relative to that dialog
			const parentRect = container.getBoundingClientRect();
			Object.assign(dropdown.style, {
				top: `${rect.bottom - parentRect.top}px`,
				left: `${rect.left - parentRect.left}px`,
				width: `${rect.width}px`
			});
		} else {
			// Dropdown is attached to body (fixed positioning)
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

				// Always fetch from our API (Proxies to Photon/Google if needed)
				const kvUrl = `/api/autocomplete?q=${encodeURIComponent(value)}`;
				const kvRes = await fetch(kvUrl);
				const data = await kvRes.json();
				const time = Math.round(performance.now() - startTime);

				const validData = Array.isArray(data) ? data : [];

				if (validData.length > 0) {
					// Identify source based on data properties
					// 'google_proxy' and 'photon' are set by the server
					let source: 'kv' | 'google' | 'photon' = 'kv';
					if (validData[0].source === 'google_proxy') source = 'google';
					if (validData[0].source === 'photon') source = 'photon';

					// If results came from external APIs (Google/Photon), cache them for next time
					if (source !== 'kv') {
						// Remove the 'source' tag so the cache sees them as clean KV objects next time
						const cleanResults = validData.map(({ source, ...rest }) => {
							// consume 'source' so it isn't reported as unused by linter
							void source;
							return rest;
						});
						cacheToKV(value, cleanResults);
					}

					renderResults(validData.slice(0, 5), source, time);
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

	// Save a fully selected place (with geometry) to KV
	async function savePlaceToKV(place: Record<string, unknown>) {
		try {
			// [!code fix] Changed from '/api/autocomplete' to '/api/places/cache' to match server handler
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
		timing?: number
	) {
		if (!dropdown) return;
		// Clear dropdown safely
		while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);

		const header = document.createElement('div');

		let sourceLabel = '⚡ Fast Cache';
		let sourceColor = '#10B981'; // Green

		if (source === 'google') {
			sourceLabel = '🌐 Google Live';
			sourceColor = '#4285F4'; // Blue
		} else if (source === 'photon') {
			sourceLabel = '🌍 OpenMap';
			sourceColor = '#F59E0B'; // Orange/Amber
		}

		// Build header using safe DOM nodes (avoid innerHTML)
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

			// Build result row safely (avoid innerHTML to prevent XSS from external data)
			const iconWrap = document.createElement('div');
			Object.assign(iconWrap.style, {
				minWidth: '24px',
				marginRight: '12px',
				display: 'flex',
				alignItems: 'center'
			});
			iconWrap.innerHTML = pinIcon; // static SVG constant is safe

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
			// Use pointerdown and stop propagation to avoid dialog/backdrop clicks closing the modal
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

		// Check if we need to fetch details (geometry)
		// Photon and KV usually have geometry. Google Proxy usually does not.
		if (!it.geometry || !it.geometry.location) {
			if (it.place_id && source === 'google') {
				try {
					// Proxy 'Get Details' through our API
					const res = await fetch(`/api/autocomplete?placeid=${it.place_id}`);
					const details: any = await res.json();

					if (details && details.geometry) {
						const fullItem = {
							...item,
							formatted_address: details.formatted_address || it.formatted_address,
							name: details.name || it.name,
							geometry: details.geometry
						};

						// Save the FULL item (with geometry) to KV for next time
						savePlaceToKV(fullItem);

						commitSelection(fullItem);
						return;
					}
				} catch (err: unknown) {
					console.error('Details fetch failed', err);
				}
			}
			// Fallback: commit what we have (might miss Lat/Lng)
			commitSelection(item);
		} else {
			// If it came from KV or Photon, we likely have geometry already.
			// We ensure we save it to KV so it gets "promoted" from 'photon' source to 'kv' cache
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

		// Ensure input regains focus so the modal doesn't get an unexpected focus shift
		setTimeout(() => {
			try {
				node.focus();
			} catch (_e: unknown) {
				void _e;
			}
		}, 0);

		// If the input lives inside a <dialog>, temporarily suppress its close handler
		// to avoid races where backdrop click closes it during selection.
		const dlg = node.closest && node.closest('dialog');
		if (dlg) {
			try {
				(dlg as any).__suppressClose = true;
				// Short timeout, long enough to survive the click/close event cycle
				setTimeout(() => {
					try {
						(dlg as any).__suppressClose = false;
					} catch (_e: unknown) {
						void _e;
					}
				}, 500);
				if (console && console.debug)
					console.debug('[autocomplete] commitSelection: set __suppressClose on dialog', {
						open: (dlg as any).open
					});
			} catch (_e: unknown) {
				void _e;
			}
		}

		// If it was closed synchronously, try to re-open it
		if (dlg && !(dlg as HTMLDialogElement).open) {
			try {
				(dlg as HTMLDialogElement).showModal();
			} catch (_e: unknown) {
				void _e;
			}
			// re-focus after re-opening
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
		setTimeout(() => {
			if (dropdown) dropdown.style.display = 'none';
		}, 200)
	);

	// Cleanup helpers (so we can remove the handlers we added above)
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
