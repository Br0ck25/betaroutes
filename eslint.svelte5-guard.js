export default {
  rules: {
    'no-restricted-syntax': [
      'error',

      // Hard bans (never allowed)
      {
        selector: "Identifier[name='onMount']",
        message: 'onMount is forbidden. Use $effect instead.'
      },
      {
        selector: "ImportDeclaration[source.value='svelte/store']",
        message: 'Svelte stores are forbidden. Use $state/$derived.'
      },

      // Soft bans (migration-only)
      {
        selector: "LabeledStatement[label.name='$']",
        message:
          'Legacy $: reactivity detected. Allowed only in unmigrated files. Convert to $derived or $effect.'
      }
    ]
  }
};
