# Storage Key Migration - Login Integration

**Date:** 2026-01-23  
**Author:** AI Agent  
**Status:** Implementation Phase  
**Related Issue:** SECURITY_AUDIT_MASTER.md Item #1 (P0 Account Takeover Fix)

---

## Executive Summary

This document describes the integration of the storage key migration function with the login flow. The purpose is to automatically migrate user data from legacy username-based storage keys to secure user ID-based keys when users log in.

---

## Problem Statement

### What Was The Security Issue?

The `getStorageId()` function previously returned keys in this order:

1. `user.name` (username) - **DANGEROUS**
2. `user.id` (UUID) - **CORRECT**
3. `user.token` (session token) - **DANGEROUS**

This allowed Account Takeover (ATO) attacks:

- If User A has username "john" and data stored as `trip:john:uuid123`
- Attacker could potentially create account with same username "john"
- Attacker would gain access to User A's data

### What Was Fixed?

`getStorageId()` now returns **ONLY** `user?.id || ''` (never falls back to name/token).

**File:** `src/lib/server/user.ts`

```typescript
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	return user?.id || '';
}
```

### What Is The Problem Now?

Existing users have data stored under username-based keys:

- `trip:{username}:{tripId}`
- `expense:{username}:{expenseId}`
- `mileage:{username}:{mileageId}`

After the security fix, the system looks for data using:

- `trip:{userId}:{tripId}`

**Result:** Existing users will see an empty dashboard because their data is orphaned.

---

## Solution: Auto-Migration on Login

When a user logs in, we automatically migrate their data from username-based keys to user ID-based keys in the background using `platform.context.waitUntil()`.

### Why On Login?

1. **User is authenticated** - We know who they are and can safely migrate their data
2. **Background operation** - Doesn't slow down login response
3. **Lazy migration** - Only migrates users who actually log in
4. **Self-healing** - Each user's data is migrated when they need it

---

## Current State Analysis

### What Exists

| Component          | Location                                            | Status         |
| ------------------ | --------------------------------------------------- | -------------- |
| Migration Function | `src/lib/server/migration/storage-key-migration.ts` | ✅ Complete    |
| Login Handler      | `src/routes/login/+server.ts`                       | ⚠️ Broken call |
| getStorageId Fix   | `src/lib/server/user.ts`                            | ✅ Complete    |

### What's Broken in Login

The login handler (lines 118-145) currently has this code:

```typescript
// 9. AUTO-MIGRATION
if (platform?.context && safeKV(env, 'BETA_LOGS_KV') && ...) {
    const userId = authResult.id;
    const username = authResult.username;

    platform.context.waitUntil(
        (async () => {
            try {
                const svc = makeTripService(...);

                // THIS FUNCTION DOES NOT EXIST!
                await (svc as any).migrateUser?.(username, userId);
            } catch (e) {
                log.error('[Auto-Migration] Failed', { username, message: msg });
            }
        })()
    );
}
```

**Problem:** `svc.migrateUser` does not exist in `tripService.ts`. The optional chaining (`?.`) prevents a crash, but the migration silently never happens.

---

## Implementation Plan

### Changes to Make

**File:** `src/routes/login/+server.ts`

1. **Add import** for `migrateUserStorageKeys` function
2. **Replace broken code** (lines 118-145) with working migration call
3. **Add proper error handling** and logging

### Before (Broken Code)

```typescript
// Lines 118-145 in login/+server.ts
if (
    platform?.context &&
    safeKV(env, 'BETA_LOGS_KV') &&
    (safeDO(env, 'TRIP_INDEX_DO') || (env as unknown as Record<string, unknown>)['TRIP_INDEX_DO'])
) {
    const userId = authResult.id;
    const username = authResult.username;

    platform.context.waitUntil(
        (async () => {
            try {
                const tripIndexDO = ...;
                const placesIndexDO = ...;
                const svc = makeTripService(...);

                // BROKEN: This function doesn't exist
                await (svc as any).migrateUser?.(username, userId);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                log.error('[Auto-Migration] Failed', { username, message: msg });
            }
        })()
    );
}
```

### After (Fixed Code)

```typescript
// STEP 1: Add import at top of file
import { migrateUserStorageKeys } from '$lib/server/migration/storage-key-migration';

// STEP 2: Replace broken migration block
if (platform?.context && authResult.username) {
	const userId = authResult.id;
	const username = authResult.username;

	// Run migration in background (doesn't block login response)
	platform.context.waitUntil(
		migrateUserStorageKeys(
			{
				BETA_LOGS_KV: safeKV(env, 'BETA_LOGS_KV'),
				BETA_EXPENSES_KV: safeKV(env, 'BETA_EXPENSES_KV'),
				BETA_MILLAGE_KV: safeKV(env, 'BETA_MILLAGE_KV'),
				BETA_HUGHESNET_KV: safeKV(env, 'BETA_HUGHESNET_KV'),
				BETA_HUGHESNET_ORDERS_KV: safeKV(env, 'BETA_HUGHESNET_ORDERS_KV')
				// BETA_TRASH_KV - Not in wrangler.toml, will be undefined (OK)
			},
			userId,
			username
		).catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			log.error('[Auto-Migration] Failed', { userId, username, message: msg });
		})
	);
}
```

---

## What The Migration Does

When `migrateUserStorageKeys()` runs, it:

### 1. Migrates Trips

- Scans for keys matching `trip:{username}:*`
- Copies data to `trip:{userId}:*`
- Deletes old keys

### 2. Migrates Expenses

- Scans for keys matching `expense:{username}:*`
- Copies data to `expense:{userId}:*`
- Deletes old keys

### 3. Migrates Mileage

- Scans for keys matching `mileage:{username}:*`
- Copies data to `mileage:{userId}:*`
- Deletes old keys

### 4. Migrates Trash (if BETA_TRASH_KV exists)

- Updates `userId` field in trash items from username to UUID
- Updates `metadata.originalKey` references

### 5. Migrates HughesNet Data

- Settings: `hns:settings:{username}` → `hns:settings:{userId}`
- Database: `hns:db:{username}` → `hns:db:{userId}`
- Session: `hns:session:{username}` → `hns:session:{userId}`
- Orders: Updates `ownerId` field from username to userId

---

## Safety Features

### 1. Idempotent

- If new key already exists, migration skips that record
- Safe to run multiple times

### 2. Background Execution

- Uses `platform.context.waitUntil()` (Cloudflare Workers pattern)
- Doesn't block login response
- Continues after response is sent

### 3. Error Handling

- Each record migration is try/catch wrapped
- Errors are logged but don't fail entire migration
- Migration continues even if some records fail

### 4. Optional KV Bindings

- All KV bindings are marked optional (`?`)
- Missing bindings are safely skipped

---

## Risk Assessment

### Low Risk

- Migration runs in background
- Errors don't affect login
- Idempotent (safe to retry)

### Medium Risk

- First login after deployment will migrate data
- Large users may have many records to migrate
- KV list operations have performance implications

### Mitigations

- Detailed logging tracks all migrations
- Pagination handles large data sets
- Old data is only deleted after new data is written

---

## Verification Steps

After implementing, verify:

1. **npm run check** - No TypeScript errors
2. **npm run lint** - No linting errors
3. **Login works** - Login still returns success
4. **Data visible** - Existing data appears on dashboard
5. **Logs show migration** - Check for `[MIGRATION]` log entries

---

## Rollback Plan

If migration causes issues:

1. **Revert login/+server.ts** to remove migration call
2. **Data is preserved** - Old keys still exist until migration succeeds
3. **Can re-attempt** - Migration is idempotent

---

## Files Changed

| File                                  | Change Type | Purpose            |
| ------------------------------------- | ----------- | ------------------ |
| `src/routes/login/+server.ts`         | Modified    | Add migration call |
| `docs/MIGRATION_LOGIN_INTEGRATION.md` | Created     | This documentation |

---

## Verification Checklist

- [ ] Import statement added correctly
- [ ] Old broken migration code removed
- [ ] New migration call uses correct function
- [ ] All KV bindings passed correctly
- [ ] Error handling in place
- [ ] `npm run check` passes
- [ ] `npm run lint` passes
- [ ] Login still works in dev
