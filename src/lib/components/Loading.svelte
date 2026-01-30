<!-- src/lib/components/Loading.svelte -->
<script lang="ts">
  const { message = 'Loading...' }: { message?: string } = $props();
</script>

<div class="loading-container">
  <div class="spinner"></div>
  <p>{message}</p>
</div>

<style>
  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    gap: 16px;
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #4caf50;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  p {
    color: #666;
    font-size: 14px;
  }
</style>
