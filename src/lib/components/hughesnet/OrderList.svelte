<script lang="ts">
  type Order = {
    id: string | number;
    type?: string;
    hasPoleMount?: boolean;
    address?: string;
    city?: string;
    state?: string;
    confirmScheduleDate?: string;
    beginTime?: string;
  };

  interface Props {
    orders?: Order[];
  }

  let { orders = [] }: Props = $props();
</script>

<div class="settings-card full-width">
  <div class="card-header">
    <div class="card-icon navy">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M17 2H3C2.46957 2 1.96086 2.21071 1.58579 2.58579C1.21071 2.96086 1 3.46957 1 4V16C1 16.5304 1.21071 17.0391 1.58579 17.4142C1.96086 17.7893 2.46957 18 3 18H17C17.5304 18 18.0391 17.7893 18.4142 17.4142C18.7893 17.0391 19 16.5304 19 16V4C19 3.46957 18.7893 2.96086 18.4142 2.58579C18.0391 2.21071 17.5304 2 17 2Z"
          stroke="currentColor"
          stroke-width="2"
        />
        <path
          d="M1 8H19M6 1V3M14 1V3"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </div>
    <div>
      <h2 class="card-title">Cached Orders</h2>
      <p class="card-subtitle">Orders currently stored in your session</p>
    </div>
  </div>

  <div class="orders-list">
    {#each orders as order (order.id)}
      <div class="order-item">
        <div class="order-main">
          <span class="order-id">#{order.id}</span>
          <span
            class="order-badge {order.type === 'Install'
              ? 'blue'
              : order.type === 'Upgrade'
                ? 'green'
                : 'purple'}"
          >
            {order.type || 'Unknown'}
          </span>
          {#if order.hasPoleMount}
            <span class="order-badge pole">Pole</span>
          {/if}
        </div>
        <div class="order-details">
          <div class="order-addr">{order.address}</div>
          <div class="order-meta">{order.city}, {order.state}</div>
        </div>
        <div class="order-time">
          <div class="date">{order.confirmScheduleDate}</div>
          <div class="time">{order.beginTime}</div>
        </div>
      </div>
    {/each}
  </div>
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
  .card-header {
    display: flex;
    gap: 16px;
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid #e5e7eb;
  }
  .card-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
  }
  .card-icon.navy {
    background: linear-gradient(135deg, #111827 0%, #1a3a5c 100%);
  }
  .card-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 4px;
  }
  .card-subtitle {
    font-size: 14px;
    color: #6b7280;
  }

  .orders-list {
    display: grid;
    gap: 12px;
    max-height: 400px;
    overflow-y: auto;
  }
  .order-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    background: #f9fafb;
  }
  .order-main {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .order-id {
    font-weight: 700;
    color: #111827;
  }
  .order-badge {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .order-badge.blue {
    background: #dbeafe;
    color: #1e40af;
  }
  .order-badge.purple {
    background: #f3e8ff;
    color: #6b21a8;
  }
  .order-badge.green {
    background: #dcfce7;
    color: #15803d;
  }
  .order-badge.pole {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fca5a5;
  }
  .order-details {
    flex: 1;
    margin: 0 16px;
  }
  .order-addr {
    font-size: 14px;
    color: #374151;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .order-meta {
    font-size: 12px;
    color: #6b7280;
  }
  .order-time {
    text-align: right;
  }
  .date {
    font-weight: 700;
    color: #059669;
    font-size: 13px;
  }
  .time {
    color: #6b7280;
    font-size: 12px;
  }

  @media (max-width: 768px) {
    .settings-card.full-width {
      grid-column: span 1;
    }
  }
</style>
