/**
 * Emergency Reindex Utility
 *
 * Usage: Open browser console on any authenticated page and run:
 *
 *   await reindexTrips()
 *
 * This will:
 * 1. Clear the Durable Object index (removes ghost data)
 * 2. Rebuild the index from Cloudflare KV (adds back real trips)
 */

async function reindexTrips() {
	console.log('🔄 Starting reindex...');

	try {
		const response = await fetch('/api/trips/reindex', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			}
		});

		if (!response.ok) {
			const error = await response.json();
			console.error('❌ Reindex failed:', error);
			return { success: false, error };
		}

		const result = await response.json();
		console.log('✅ Reindex complete!', result);
		console.log(`   - Cleared old index`);
		console.log(`   - Rebuilt with ${result.rebuilt} trips`);
		console.log('');
		console.log('💡 Refresh the page to see updated trip list');

		return result;
	} catch (err) {
		console.error('❌ Reindex error:', err);
		return { success: false, error: err.message };
	}
}

// Make it globally available
if (typeof window !== 'undefined') {
	window.reindexTrips = reindexTrips;
	console.log('');
	console.log('📦 Emergency Reindex Utility Loaded');
	console.log('   Run: await reindexTrips()');
	console.log('');
}

export { reindexTrips };
