<script lang="ts">
  import { resolve } from '$app/paths';

  const { class: className = '' } = $props();
</script>

<footer
  class="w-full border-t border-neutral-border bg-neutral-bg-secondary mt-10 {className}"
  style="padding-bottom: calc(env(safe-area-inset-bottom, 20px) + 12px);"
>
  <div
    class="max-w-7xl mx-auto px-4 py-6 text-neutral-secondary text-sm flex flex-col tablet:flex-row justify-between items-center gap-4"
  >
    <p>© {new Date().getFullYear()} Go Route Yourself</p>

    <nav class="flex gap-6">
      <a href={resolve('/privacy')} class="hover:text-primary-green">Privacy</a>
      <a href={resolve('/terms')} class="hover:text-primary-green">Terms</a>
      <a href={resolve('/support')} class="hover:text-primary-green">Support</a>
    </nav>
  </div>
</footer>
