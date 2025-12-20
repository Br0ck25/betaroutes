<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'outline' | 'danger' = 'primary';
  export let disabled = false;
  export let type: 'button' | 'submit' | 'reset' = 'button';
  // Allow passing extra classes (e.g., margins, width)
  export let className = '';
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
  on:click
>
  <slot />
</button>