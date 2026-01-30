<script lang="ts">
  import type { Snippet } from 'svelte';

  export type Props = {
    variant?: 'primary' | 'secondary' | 'outline' | 'danger';
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    className?: string;
    action?: (event: MouseEvent) => void;
    onClick?: (event: MouseEvent) => void;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
  };

  let {
    variant = 'primary',
    disabled = false,
    type = 'button',
    className = '',
    action,
    onClick,
    onclick,
    children
  }: Props = $props();

  function handleClick(e: MouseEvent) {
    if (disabled) {
      e.preventDefault();
      return;
    }

    // Prefer explicit action prop, then fall back to conventional names
    const cb =
      typeof action === 'function'
        ? action
        : typeof onClick === 'function'
          ? onClick
          : typeof onclick === 'function'
            ? onclick
            : undefined;
    if (cb) {
      try {
        cb(e as MouseEvent);
      } catch (err) {
        console.error('Button click prop error', err);
      }
    }
  }
</script>

<button
  {type}
  class={`px-4 py-2 rounded-md font-semibold transition-all active:scale-95 active:brightness-90
    ${variant === 'primary' ? 'bg-primary-green text-white hover:bg-primary-green-dark shadow-md hover:shadow-lg' : ''}
    ${variant === 'secondary' ? 'bg-white text-primary-green border border-primary-green hover:bg-primary-green hover:text-white' : ''}
    ${variant === 'outline' ? 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50' : ''}
    ${variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : ''}
    ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
    ${className}`}
  {disabled}
  onclick={handleClick}
>
  {@render children?.()}
</button>
