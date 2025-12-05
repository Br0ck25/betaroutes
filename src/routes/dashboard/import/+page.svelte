<script>
	let { children } = $props();
</script>

<h1 class="text-2xl font-bold text-gray-900 dark:text-white">Import GPX</h1>
<p class="mt-2 text-gray-600 dark:text-gray-300">
	Upload GPX files and preview them before saving.
</p>

<div class="mt-6">
	<input type="file" accept=".gpx" class="border rounded p-3 bg-white dark:bg-gray-900" />

	<div class="mt-6 border border-gray-300 dark:border-gray-700 p-4 rounded">
		GPX preview will appear here.
	</div>
</div>
