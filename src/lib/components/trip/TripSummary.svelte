<script lang="ts">
  export let totalMileage: number;
  export let distanceUnit: string;
  export let totalTime: string;
  export let fuelCost: number;
  export let netProfit: number;
</script>

<div class="bg-green-50 border border-green-200 rounded-xl p-6 my-6 shadow-sm">
  <h3 class="text-green-800 font-bold text-lg mb-4">Trip Summary</h3>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div>
      <div class="text-xs text-green-600 uppercase font-semibold">Distance</div>
      <div class="text-xl font-bold text-green-900">{totalMileage} {distanceUnit}</div>
    </div>
    <div>
      <div class="text-xs text-green-600 uppercase font-semibold">Time</div>
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