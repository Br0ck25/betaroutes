// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

let googleLoaded = false;

// Load Google Places only once
export function loadGoogle(apiKey: string): Promise<void> {
  return new Promise((resolve) => {
    if (googleLoaded) return resolve();

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => {
      googleLoaded = true;
      resolve();
    };

    document.head.appendChild(script);
  });
}

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> =
  (node, params) => {
    let instance: google.maps.places.Autocomplete | null = null;

    async function init() {
      if (!params?.apiKey) return;

      await loadGoogle(params.apiKey);

      instance = new google.maps.places.Autocomplete(node, {
        types: ["geocode"],
        fields: ["formatted_address", "geometry"],
      });

      // Hide autocomplete when input is empty
      node.addEventListener("input", () => {
        if (!node.value.trim()) {
          hideAllDropdowns();
        }
      });

      // Only show dropdown for this input
      node.addEventListener("focus", () => {
        hideAllDropdowns();
        showOwnDropdown(node);
      });

      instance.addListener("place_changed", () => {
        const place = instance!.getPlace();
        node.dispatchEvent(
          new CustomEvent("place-selected", { detail: place })
        );
        hideAllDropdowns();
      });
    }

    init();

    return {
      destroy() {
        hideAllDropdowns();
      }
    };
  };

// Hide EVERY Google dropdown
function hideAllDropdowns() {
  document.querySelectorAll(".pac-container").forEach((el) => {
    (el as HTMLElement).style.display = "none";
  });
}

// Show only the matching autocomplete dropdown
function showOwnDropdown(input: HTMLInputElement) {
  setTimeout(() => {
    document.querySelectorAll(".pac-container").forEach((el) => {
      const rect = input.getBoundingClientRect();
      const topMatch = Math.abs(el.getBoundingClientRect().top - rect.bottom) < 50;

      // Show one matching dropdown
      if (topMatch) {
        (el as HTMLElement).style.display = "";
      }
    });
  }, 50);
}
