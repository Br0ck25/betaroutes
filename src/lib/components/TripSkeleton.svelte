<div class="animate-pulse space-y-4">
  {#each Array(3) as _}
    <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
      <div class="flex justify-between items-start mb-3">
        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
        <div class="h-5 bg-gray-300 dark:bg-gray-600 rounded w-1/4"></div>
      </div>
      
      <div class="flex items-center gap-3 mb-2">
        <div class="w-2 h-2 rounded-full bg-green-400"></div>
        <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
      </div>
      
      <div class="flex items-center gap-3">
        <div class="w-2 h-2 rounded-full bg-red-400"></div>
        <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
      </div>
    </div>
  {/each}
  
  <div class="text-center pt-4">
    <p class="text-xs text-gray-400 animate-pulse">Optimizing your trip history...</p>
  </div>
</div>