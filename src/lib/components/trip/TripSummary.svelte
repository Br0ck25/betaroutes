<script lang="ts">
  // [!code fix] Use Svelte 5 Runes for props
  const {
    totalMileage = 0,
    distanceUnit = 'mi',
    totalTime = '',
    fuelCost = 0,
    netProfit = 0
  } = $props();
</script>

<div
  data-testid="trip-summary"
  class="bg-green-50 border border-green-200 rounded-xl p-6 my-6 shadow-sm"
>
  <h3 class="text-green-800 font-bold text-lg mb-4">Trip Summary</h3>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div>
      <div class="text-xs text-green-600 uppercase font-semibold">Total Miles</div>
      <div class="text-xl font-bold text-green-900">
        <span data-testid="trip-distance">{totalMileage} {distanceUnit}</span>
      </div>
    </div>
    <div>
      <div class="text-xs text-green-600 uppercase font-semibold">Drive Time (Est)</div>
      <div class="text-xl font-bold text-green-900">{totalTime}</div>
    </div>
    <div>
      <div class="text-xs text-green-600 uppercase font-semibold">Fuel</div>
      <div class="text-xl font-bold text-green-900">${fuelCost}</div>
    </div>
    <div>
      <div class="text-xs text-green-600 uppercase font-semibold">Net Profit</div>
      <div class="text-xl font-bold {netProfit >= 0 ? 'text-green-900' : 'text-red-600'}">
        ${netProfit}
      </div>
    </div>
  </div>
</div>
