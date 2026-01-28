import type { SvelteComponentTyped } from 'svelte';

export default class Button extends SvelteComponentTyped<
	{
		variant?: 'primary' | 'secondary' | 'outline' | 'danger';
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		className?: string;
	},
	{ click: MouseEvent },
	{ default: Record<string, unknown> }
> {}
