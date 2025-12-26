declare namespace svelteHTML {
  interface HTMLAttributes<T> {
    // Custom event from autocomplete action
    'on:place-selected'?: (e: CustomEvent) => any;
  }
}
