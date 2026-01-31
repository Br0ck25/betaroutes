<script lang="ts">
  // Use $effect for client-only setup/cleanup (replaces onMount/onDestroy)
  interface Props {
    sections?: string[];
    children?: import('svelte').Snippet;
  }

  const { sections = ['profile', 'maintenance', 'integrations', 'security'], children }: Props =
    $props();

  // Ensure `active` is initialized and reacts to `sections` changes (writable state)
  let active = $state('');

  // Keep `active` in sync when the available `sections` changes
  $effect(() => {
    active = sections?.[0] ?? active;
  });

  $effect(() => {
    // Client-only: IntersectionObserver and DOM lookups must not run on the server
    if (typeof document === 'undefined') return;

    const opts = { root: null, rootMargin: '0px 0px -55%', threshold: 0.1 };
    const observer = new IntersectionObserver((entries) => {
      // Pick the most visible section
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0));
      const entry = visible[0];
      if (entry && entry.target) {
        const id = (entry.target as HTMLElement).id;
        if (id) active = id;
      }
    }, opts);

    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
    };
  });

  function scrollTo(id: string) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    // Set the active tab immediately for instant feedback while we smooth-scroll
    if (id) active = id;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<div class="settings-wrap">
  <nav class="side-nav" aria-label="Settings navigation">
    <ul>
      {#each sections as s (s)}
        <li class:active={active === s}>
          <button
            type="button"
            onclick={() => scrollTo(s)}
            aria-current={active === s ? 'true' : 'false'}
          >
            {s ? s[0]?.toUpperCase() + s.slice(1) : ''}
          </button>
        </li>
      {/each}
    </ul>
  </nav>

  <main class="settings-main">
    {@render children?.()}
  </main>
</div>

<style>
  .settings-wrap {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 24px;
    align-items: start;
  }

  .side-nav {
    position: sticky;
    top: 20px;
    height: calc(100vh - 40px);
    overflow: auto;
    padding: 12px 0;
  }
  .side-nav ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .side-nav li button {
    background: transparent;
    border: none;
    padding: 10px 12px;
    text-align: left;
    width: 100%;
    border-radius: 8px;
    cursor: pointer;
    color: #374151;
    font-weight: 600;
  }
  .side-nav li button:hover {
    background: rgba(255, 127, 80, 0.06);
    color: var(--orange, #ff6a3d);
  }
  .side-nav li.active button {
    background: linear-gradient(90deg, rgba(255, 127, 80, 0.12), rgba(255, 127, 80, 0.02));
    color: var(--orange, #ff6a3d);
    box-shadow: inset 0 0 0 1px rgba(255, 127, 80, 0.06);
  }

  .settings-main {
    min-width: 0;
  }

  /* Shared save button styling for settings (global so children can use it) */
  :global(.save-btn) {
    display: block;
    width: 100%;
    box-sizing: border-box;
    min-width: 120px;
    padding: 12px 16px;
    border-radius: 10px;
    font-weight: 700;
    margin-top: 8px;
    text-align: center;
  }
  :global(.save-btn:focus-visible) {
    outline: 3px solid rgba(255, 127, 80, 0.18);
    outline-offset: 3px;
  }

  /* Global highlight styles for Save buttons */
  :global(.btn-secondary.highlight),
  :global(.btn-primary.highlight) {
    border-color: var(--orange, #ff6a3d);
    color: var(--orange, #ff6a3d);
    box-shadow: 0 8px 22px rgba(255, 127, 80, 0.16);
    transform: translateY(-1px);
    transition:
      box-shadow 0.18s ease,
      border-color 0.18s ease,
      transform 0.12s ease;
  }

  /* Ensure consistent icon/title sizing for all settings cards */
  :global(.settings .card-icon) {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
    font-size: 20px;
  }
  :global(.settings .card-title) {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 4px;
  }
  :global(.settings .card-subtitle) {
    font-size: 14px;
    color: #6b7280;
  }

  /* Responsive: move nav to top as scrollable horizontal row */
  @media (max-width: 1024px) {
    .settings-wrap {
      grid-template-columns: 1fr;
    }
    .side-nav {
      position: relative;
      top: 0;
      height: auto;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 8px 0 12px;
      -webkit-overflow-scrolling: touch;
    }
    .side-nav ul {
      flex-direction: row;
      gap: 6px;
      padding-left: 6px;
      padding-right: 6px;
    }
    .side-nav li button {
      padding: 8px 14px;
      white-space: nowrap;
    }
  }
</style>
