<script lang="ts">
  const {
    width = '100%',
    height = 'auto',
    className = '',
    class: classAttr = '',
    style = ''
  }: {
    width?: string;
    height?: string;
    className?: string;
    class?: string;
    style?: string;
  } = $props();

  const finalClass = $derived(() => className || classAttr);
</script>

<div
  class="skeleton {finalClass}"
  style="width: {width}; height: {height}; {style}"
  role="status"
  aria-label="Loading..."
></div>

<style>
  .skeleton {
    background-color: #e5e7eb; /* gray-200 */
    border-radius: 0.375rem; /* rounded-md */
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>
