import type { SvelteComponentTyped } from 'svelte';

export interface ProfileCardProps {
  profile?: { name?: string; email?: string };
  onSuccess?: (msg: string) => void;
  onPortal?: () => void;
  onUpgrade?: (plan?: 'generic' | 'export' | 'advanced-export') => void;
  onProfileChange?: (profile: { name: string; email: string }) => void;
}

export default class ProfileCard extends SvelteComponentTyped<ProfileCardProps> {}
