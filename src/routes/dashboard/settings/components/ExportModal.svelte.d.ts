import type { Snippet, SvelteComponentTyped } from 'svelte';

export default class ExportModal extends SvelteComponentTyped<
  {
    showAdvancedExport?: boolean;
    onSuccess?: (msg: string) => void;
    onError?: (msg: string) => void;
  },
  Record<string, unknown>,
  { default: Snippet }
> {}
