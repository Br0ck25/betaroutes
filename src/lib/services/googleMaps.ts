// src/lib/services/googleMaps.ts

interface BooleanStore {
  subscribe: (run: (v: boolean) => void) => () => void;
  set: (v: boolean) => void;
  get: () => boolean;
}

function createBooleanStore(initial = false): BooleanStore {
  let value = initial;
  const subscribers = new Set<(v: boolean) => void>();

  return {
    subscribe(run: (v: boolean) => void) {
      run(value);
      subscribers.add(run);
      return () => subscribers.delete(run);
    },
    set(v: boolean) {
      value = v;
      for (const s of subscribers) s(value);
    },
    get() {
      return value;
    }
  };
}

class GoogleMapsLoader {
  private static instance: GoogleMapsLoader;
  private loadPromise: Promise<void> | null = null;
  public isLoaded = createBooleanStore(false);

  private constructor() {}

  static getInstance() {
    if (!GoogleMapsLoader.instance) {
      GoogleMapsLoader.instance = new GoogleMapsLoader();
    }
    return GoogleMapsLoader.instance;
  }

  /**
   * Idempotent load function.
   * Call this from anywhere (SyncManager, Components) to ensure Maps is ready.
   */
  load(apiKey: string): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve(); // SSR safety

    // 1. Check if already loaded globally
    if (window.google?.maps?.places) {
      this.isLoaded.set(true);
      return Promise.resolve();
    }

    // 2. Return existing promise if loading is in progress
    if (this.loadPromise) return this.loadPromise;

    // 3. Start loading
    this.loadPromise = new Promise((resolve, reject) => {
      // Double check inside promise in case of race
      if (window.google?.maps?.places) {
        this.isLoaded.set(true);
        resolve();
        return;
      }

      const script = document.createElement('script');
      // Use Google's recommended loading pattern to avoid the "loaded directly without loading=async" warning
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        this.isLoaded.set(true);
        resolve();
      };

      script.onerror = (err) => {
        this.loadPromise = null;
        console.error('Failed to load Google Maps API', err);
        reject(err);
      };

      document.head.appendChild(script);
    });

    return this.loadPromise;
  }
}

export const googleMaps = GoogleMapsLoader.getInstance();
