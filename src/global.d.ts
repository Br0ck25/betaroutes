declare namespace svelteHTML {
  interface HTMLAttributes {
    // Custom event from autocomplete action
    'on:place-selected'?: (e: CustomEvent<unknown>) => void;
    'onplace-selected'?: (e: CustomEvent<unknown>) => void;
  }
}
