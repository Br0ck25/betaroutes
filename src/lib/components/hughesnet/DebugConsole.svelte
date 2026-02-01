<script lang="ts">
  interface Props {
    logs?: string[];
    showConsole?: boolean;
  }

  let {
    showConsole = $bindable(false),
    // eslint-disable-next-line prefer-const -- `rest` must remain mutable because `$bindable()` must be declared with `let` in same destructure
    ...rest
  } = $props();
  const { logs = [] } = rest as Props;
</script>

<div class="settings-card full-width bg-dark">
  <div
    class="console-header"
    onclick={() => (showConsole = !showConsole)}
    onkeydown={(e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showConsole = !showConsole;
      }
    }}
    role="button"
    tabindex="0"
  >
    <div class="flex items-center gap-2">
      <span>Debug Console</span>
      <span class="console-count">({logs.length})</span>
    </div>
    <span class="toggle-icon" class:rotated={showConsole}>▶</span>
  </div>

  {#if showConsole}
    <div class="console-body">
      {#each logs as log, i (i)}
        <div class="log-line">
          <span class="log-time"
            >{log.includes('[') ? '' : '[' + new Date().toLocaleTimeString() + ']'}</span
          >
          <span class="log-msg" class:server={log.includes('[Server]')}>{log}</span>
        </div>
      {/each}
      {#if logs.length === 0}
        <div class="log-line muted">System ready...</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .settings-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    padding: 24px;
  }
  .settings-card.full-width {
    grid-column: span 2;
  }
  .bg-dark {
    background: #111827;
    border-color: #374151;
    padding: 0;
    overflow: hidden;
  }

  .console-header {
    background: #1f2937;
    padding: 12px 24px;
    color: #9ca3af;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    border-bottom: 1px solid #374151;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    user-select: none;
  }
  .console-header:hover {
    color: #e5e7eb;
    background: #374151;
  }
  .console-count {
    color: #6b7280;
    font-weight: 400;
    font-size: 11px;
    margin-left: 4px;
  }
  .toggle-icon {
    transition: transform 0.2s;
    font-size: 10px;
  }
  .toggle-icon.rotated {
    transform: rotate(90deg);
  }

  .console-body {
    padding: 16px 24px;
    height: 200px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 12px;
    display: flex;
    flex-direction: column-reverse;
    border-top: 1px solid #374151;
  }
  .log-line {
    margin-bottom: 6px;
  }
  .log-time {
    color: #6b7280;
    margin-right: 8px;
  }
  .log-msg {
    color: #34d399;
  }
  .log-msg.server {
    color: #60a5fa;
  }
  .log-line.muted {
    color: #4b5563;
    font-style: italic;
  }

  @media (max-width: 768px) {
    .settings-card.full-width {
      grid-column: span 1;
    }
  }
</style>
