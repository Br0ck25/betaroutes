<script lang="ts">
  export let installPay: number;
  export let repairPay: number;
  export let upgradePay: number;
  export let poleCost: number;
  export let concreteCost: number;
  export let poleCharge: number;
  export let installTime: number;
  export let repairTime: number;
  export let overrideTimes: boolean;
</script>

<div class="settings-card">
  <div class="card-header">
    <div class="card-icon orange">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
         <path d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z" stroke="currentColor" stroke-width="2"/>
        <path d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15C7.5 15 7 15.2 6.7 15.6L6.6 15.7C6.3 16 5.9 16.2 5.5 16.2C5.1 16.2 4.7 16 4.4 15.7C4.1 15.4 3.9 15 3.9 14.6C3.9 14.2 4.1 13.8 4.4 13.5L4.5 13.4C4.9 13.1 5.1 12.6 5 12.1C4.9 11.6 4.5 11.3 4 11.2H3.8C2.9 11.2 2.2 10.5 2.2 9.6C2.2 8.7 2.9 8 3.8 8H3.9C4.5 7.9 4.9 7.5 5 6.9C5 6.4 4.8 5.9 4.4 5.6L4.3 5.5C4 5.2 3.8 4.8 3.8 4.4C3.8 4 4 3.6 4.3 3.3C4.6 3 5 2.8 5.4 2.8C5.8 2.8 6.2 3 6.5 3.3L6.6 3.4C7 3.8 7.5 4 8 3.9C8.5 3.9 8.8 3.4 8.9 2.9V2.7C8.9 1.8 9.6 1.1 10.5 1.1C11.4 1.1 12.1 1.8 12.1 2.7V2.8C12.1 3.4 12.5 3.8 13.1 3.9C13.6 4 14.1 3.8 14.4 3.4L14.5 3.3C14.8 3 15.2 2.8 15.6 2.8C16 2.8 16.4 3 16.7 3.3C17 3.6 17.2 4 17.2 4.4C17.2 4.8 17 5.2 16.7 5.5L16.6 5.6C16.2 5.9 16 6.4 16.1 6.9C16.2 7.4 16.6 7.7 17.1 7.8H17.3C18.2 7.8 18.9 8.5 18.9 9.4C18.9 10.3 18.2 11 17.3 11H17.2C16.6 11.1 16.2 11.5 16.1 12.1L16.2 12Z" stroke="currentColor" stroke-width="2"/>
      </svg>
    </div>
    <div>
      <h2 class="card-title">Configuration</h2>
      <p class="card-subtitle">Pay rates and supply costs</p>
    </div>
  </div>

  <h3 class="section-label">Pay Rates</h3>
  <div class="config-grid">
      <div class="form-group">
        <label for="install-pay">Install Pay ($)</label>
        <input id="install-pay" type="number" bind:value={installPay} placeholder="150.00" min="0" step="0.01" />
      </div>
      
      <div class="form-group">
        <label for="repair-pay">Repair Pay ($)</label>
        <input id="repair-pay" type="number" bind:value={repairPay} placeholder="80.00" min="0" step="0.01" />
      </div>

      <div class="form-group">
        <label for="upgrade-pay">Upgrade Pay ($)</label>
        <input id="upgrade-pay" type="number" bind:value={upgradePay} placeholder="80.00" min="0" step="0.01" />
      </div>
  </div>
  
  <h3 class="section-label text-red">Supply Costs (Deductions)</h3>
  <div class="config-grid">
      <div class="form-group">
        <label for="pole-cost" class="text-red">Pole Cost ($)</label>
        <input id="pole-cost" type="number" bind:value={poleCost} placeholder="0.00" min="0" step="0.01" class="border-red" />
        <span class="help-text">Deducted if Pole detected</span>
      </div>
      
      <div class="form-group">
        <label for="conc-cost" class="text-red">Concrete Cost ($)</label>
        <input id="conc-cost" type="number" bind:value={concreteCost} placeholder="0.00" min="0" step="0.01" class="border-red" />
        <span class="help-text">Deducted if Pole detected</span>
      </div>

      <div class="form-group">
        <label for="pole-charge" class="text-green">Pole Charge Amount ($)</label>
        <input id="pole-charge" type="number" bind:value={poleCharge} placeholder="0.00" min="0" step="0.01" class="border-green" />
        <span class="help-text">Added to pay if Pole detected</span>
      </div>
  </div>

  <div class="separator"></div>

  <div class="config-grid">
      <div class="form-group">
        <label for="install-time">Install Time (min)</label>
        <input id="install-time" type="number" bind:value={installTime} placeholder="90" min="1" />
      </div>
      
      <div class="form-group">
        <label for="repair-time">Repair Time (min)</label>
        <input id="repair-time" type="number" bind:value={repairTime} placeholder="60" min="1" />
      </div>
  </div>
  
  <div class="checkbox-wrapper">
     <label class="checkbox-label">
        <input type="checkbox" bind:checked={overrideTimes} />
        <div>
            <span class="cb-title">Override Calculated Times</span>
            <span class="cb-desc">Ignore system logs and force the durations above</span>
        </div>
     </label>
  </div>
  
  <div class="tip-text">
    Values will be applied to the next sync.
  </div>
</div>

<style>
  .settings-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px; }
  .card-header { display: flex; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #E5E7EB; }
  .card-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
  .card-icon.orange { background: linear-gradient(135deg, #F97316 0%, #FF6A3D 100%); }
  .card-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .card-subtitle { font-size: 14px; color: #6B7280; }
  
  .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  .form-group label.text-red { color: #DC2626; }
  .form-group label.text-green { color: #166534; }
  
  .form-group input { width: 100%; padding: 12px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; background: white; transition: all 0.2s; box-sizing: border-box; }
  .form-group input:focus { outline: none; border-color: #F97316; box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  .form-group input.border-red { border-color: #FECACA; background: #FEF2F2; }
  .form-group input.border-red:focus { border-color: #DC2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1); }
  .form-group input.border-green { border-color: #BBF7D0; background: #F0FDF4; }
  .form-group input.border-green:focus { border-color: #166534; box-shadow: 0 0 0 3px rgba(22, 101, 52, 0.1); }
  
  .help-text { font-size: 11px; color: #9CA3AF; margin-top: 4px; display: block; }
  .section-label { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #9CA3AF; margin-bottom: 12px; letter-spacing: 0.05em; margin-top: 8px; }
  .section-label.text-red { color: #EF4444; }
  .separator { height: 1px; background: #E5E7EB; margin: 24px 0; }
  
  .checkbox-wrapper { margin: 20px 0; padding: 16px; background: #F9FAFB; border-radius: 10px; border: 1px solid #E5E7EB; }
  .checkbox-label { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
  .checkbox-label input { margin-top: 4px; width: 16px; height: 16px; cursor: pointer; accent-color: #F97316; }
  .cb-title { display: block; font-weight: 600; color: #111827; font-size: 14px; }
  .cb-desc { display: block; color: #6B7280; font-size: 13px; margin-top: 2px; }
  .tip-text { font-size: 13px; color: #6B7280; font-style: italic; margin-top: 10px; }
</style>