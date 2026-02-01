import type { Snippet, SvelteComponentTyped } from 'svelte';

export default class Button extends SvelteComponentTyped<
  {
    variant?: 'primary' | 'secondary' | 'outline' | 'danger';
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    className?: string;
    action?: (event: MouseEvent) => void;
    onClick?: (event: MouseEvent) => void;
    onclick?: (event: MouseEvent) => void;
    // children is accepted as a slot/snippet
    children?: Snippet;
  },
  // No custom component events are emitted; if consumers need DOM events they should
  // attach handlers to the underlying element via the action prop instead.
  Record<string, never>,
  { default: Snippet }
> {}
