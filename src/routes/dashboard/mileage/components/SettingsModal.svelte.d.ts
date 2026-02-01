import type { Snippet, SvelteComponentTyped } from 'svelte';

export default class SettingsModal extends SvelteComponentTyped<
  {
    open?: boolean;
    activeCategoryType?: 'defaults' | 'vehicles';
    onClose?: () => void;
  },
  Record<string, unknown>,
  { default: Snippet }
> {}
