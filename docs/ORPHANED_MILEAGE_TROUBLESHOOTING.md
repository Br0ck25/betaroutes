# Orphaned Mileage Logs Troubleshooting Guide

## Problem Description

**Symptoms:**

- Mileage logs appear in the UI but cannot be deleted
- Hard refresh clears them temporarily, but they return when navigating away
- Attempting to edit results in error: `"Parent trip not found. Cannot update mileage log."`
- DELETE requests return success (200/204) but records persist

**Root Cause:**
These are "zombie" records that exist in **IndexedDB** (browser storage) but **not in Cloudflare KV** (server). This typically happens when:

1. Parent trip was deleted but mileage log cleanup failed
2. Server rejected the mileage log creation but client saved it locally
3. Manual KV deletion was performed outside the app
4. Sync failure during offline operation

**Why They Keep Coming Back:**

- The app loads mileage from IndexedDB on page navigation
- DELETE endpoint returns success even when record doesn't exist in KV (fixed in this update)
- Client thinks the record is valid and keeps displaying it

---

## Solution 1: Settings UI Cleanup Tool (Recommended)

### Steps:

1. Navigate to **Dashboard → Settings**
2. Scroll to the **"Data Cleanup"** section
3. Click **"Scan & Clean Up"**
4. Review the scan results:
   - Total mileage logs scanned
   - Valid records (exist on server)
   - Orphaned records (missing from server)
   - Records removed
5. If orphaned records were removed, **refresh the page** to see updated data

### What It Does:

- Checks each mileage log in IndexedDB against the server (GET `/api/mileage/{id}`)
- Records returning 404 are marked as orphaned
- Removes orphaned records from IndexedDB
- Displays detailed results and removed record IDs

---

## Solution 2: Browser Console Debug Tools

### Available Commands:

Open your browser console (F12) and run:

```javascript
// Show all mileage logs in IndexedDB
window.debugGRY.listAllMileage();

// Check for orphaned mileage (requires userId)
window.debugGRY.listOrphanedMileage('YOUR_USER_ID');

// Clean up orphaned mileage
window.debugGRY.clearOrphanedMileage('YOUR_USER_ID');

// Show IndexedDB statistics
window.debugGRY.showDBStats();

// Check specific mileage log on server
window.debugGRY.checkMileageOnServer('MILEAGE_ID');

// Get mileage from IndexedDB
window.debugGRY.getMileageFromIndexedDB('MILEAGE_ID');

// Force delete from IndexedDB (nuclear option)
window.debugGRY.forceDeleteFromIndexedDB('MILEAGE_ID');

// Full audit of IndexedDB vs Server
window.debugGRY.auditMileageSync('YOUR_USER_ID');
```

### Example Workflow:

```javascript
// 1. Check what's in IndexedDB
await window.debugGRY.showDBStats();
// Output: { trips: 10, mileage: 5, expenses: 3, trash: 2, pendingSync: 0 }

// 2. List orphaned mileage
await window.debugGRY.listOrphanedMileage('your-user-id');
// Output: Shows table of orphaned records

// 3. Clean up orphaned records
await window.debugGRY.clearOrphanedMileage('your-user-id');
// Output: Removed X orphaned records

// 4. Reload page to see changes
location.reload();
```

---

## Solution 3: Manual IndexedDB Cleanup

### Steps:

1. Open **DevTools** (F12)
2. Go to **Application** tab
3. Expand **IndexedDB** in left sidebar
4. Find **"go-route-yourself"** database
5. Click **"mileage"** object store
6. Find the orphaned record by ID
7. Right-click → **Delete**
8. Refresh the page

### Finding Orphaned Record IDs:

From your console logs, the problematic IDs appear as:

```
DELETE https://gorouteyourself.com/api/mileage/REDACTED
```

Check the network tab to see the actual ID being sent in DELETE requests.

---

## Solution 4: Nuclear Option (Clear All Local Data)

**⚠️ WARNING: This will delete ALL local data including unsaved changes.**

### Steps:

1. Open DevTools (F12)
2. Go to **Application** tab
3. Right-click **"go-route-yourself"** database
4. Select **"Delete database"**
5. Go to **Storage** → **Clear site data**
6. Refresh the page
7. Data will re-sync from server

---

## Prevention (Fixed in This Update)

### Code Changes Made:

1. **DELETE Endpoint Improvement** (`src/routes/api/mileage/[id]/+server.ts`):
   - Now logs when record doesn't exist in KV
   - Returns 204 anyway so client can clean up local copy
   - Added detailed logging for troubleshooting

2. **Orphaned Record Detection** (`src/lib/utils/cleanup-orphaned-mileage.ts`):
   - Validates each mileage log against server
   - Removes orphaned records from IndexedDB
   - Reports detailed cleanup statistics

3. **Settings UI Component** (`src/lib/components/ui/OrphanedMileageCleanup.svelte`):
   - User-friendly cleanup interface
   - Scan and remove orphaned records
   - Visual feedback and results display

4. **Debug Helpers** (`src/lib/utils/debug-helpers.ts`):
   - Browser console utilities for troubleshooting
   - Audit sync status between IndexedDB and server
   - Force delete capabilities for edge cases

---

## Logging Analysis

### What Your Logs Show:

```
DELETE https://gorouteyourself.com/api/mileage/REDACTED - Ok @ timestamp
  (info) [HOOK] session lookup { sessionId: '...', found: true }
```

**Analysis:**

- Session is valid ✅
- DELETE returns "Ok" ✅
- But record doesn't exist in KV ❌
- **New logging** will now show:
  ```
  (warn) [MILEAGE DELETE] Record not found in KV (may be orphaned in IndexedDB)
  ```

### Parent Trip Error:

```
Error: ABORT_RETRY: Server rejected request (409):
{"error":"Parent trip not found. Cannot update mileage log."}
```

**Analysis:**

- Mileage log references a `tripId` that doesn't exist
- This confirms the record is orphaned
- The mileage log was likely created before parent trip was deleted

---

## Testing the Fix

### Verify the cleanup works:

1. Before cleanup:

   ```javascript
   await window.debugGRY.showDBStats();
   // { mileage: 5 }
   ```

2. Run cleanup:

   ```javascript
   await window.debugGRY.clearOrphanedMileage('your-user-id');
   // Removed 2 orphaned mileage logs
   ```

3. After cleanup:

   ```javascript
   await window.debugGRY.showDBStats();
   // { mileage: 3 }
   ```

4. Reload page - orphaned records should not return

---

## Future Prevention

### Best Practices:

1. **Always delete mileage before deleting parent trip**
2. **Check sync status before deleting records**
3. **Monitor browser console for sync errors**
4. **Run periodic cleanup** (Settings → Data Cleanup)

### Monitoring:

Watch for these warnings in console:

- `ABORT_RETRY: Server rejected request (409)`
- `Parent trip not found`
- `[MILEAGE DELETE] Record not found in KV`

---

## Support

If orphaned records persist after cleanup:

1. Export console logs (F12 → Console → Right-click → Save as)
2. Run full audit: `window.debugGRY.auditMileageSync('your-user-id')`
3. Note specific mileage IDs causing issues
4. Contact support with logs and mileage IDs

---

## Technical Details

### How Detection Works:

```typescript
// For each mileage log in IndexedDB:
const response = await fetch(`/api/mileage/${mileage.id}`);

if (response.status === 404) {
	// Orphaned - exists locally but not on server
	orphanedRecords.push(mileage);
}
```

### How Cleanup Works:

```typescript
// Remove orphaned records from IndexedDB:
const tx = db.transaction('mileage', 'readwrite');
for (const orphan of orphanedRecords) {
	await tx.objectStore('mileage').delete(orphan.id);
}
```

### Why It's Safe:

- Only removes records that return 404 from server
- Server is source of truth
- No data loss risk (record doesn't exist on server anyway)
- Local copy is the corruption source
