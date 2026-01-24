# Storage Key Migration Strategy

**Goal:** Transition from `user.name`-based storage keys to `user.id`-based keys without breaking existing user data.

**Status:** Planning Phase  
**Priority:** P0 - Critical Security Fix (Account Takeover Prevention)

---

## Problem Statement

Currently, `getStorageId()` returns keys in this priority:

1. `user.name` (username) - **DANGEROUS** - allows account takeover
2. `user.id` (UUID) - **CORRECT**
3. `user.token` (session token) - **DANGEROUS** - session-based keys

All user data (trips, expenses, mileage, trash) is keyed by the result of `getStorageId()`, meaning:

- Old users have data keyed by **username** (`trip:johndoe:uuid`)
- New users (if any) might have data keyed by **user ID** (`trip:550e8400-e29b-41d4-a716-446655440000:uuid`)

**The critical flaw:** If two users have the same username (or a malicious user can change their username), they gain access to each other's data.

### HughesNet Integration Also Affected

**CRITICAL:** The HughesNet sync API (`src/routes/api/hughesnet/+server.ts`) has the **SAME vulnerability**:

```typescript
const userId = user?.name || user?.token || user?.id || 'default_user';
```

This means:

- All HughesNet-synced trips are stored with username-based keys
- HughesNet trip IDs follow format: `hns_{username}_{date}`
- HughesNet settings stored as: `hns:settings:{username}`
- HughesNet order database stored as: `hns:db:{username}`
- Trip creation calls `tripService.put()` with the vulnerable `userId`

**Impact:** Same account takeover vulnerability applies to all HughesNet functionality.

---

## Migration Phases

### Phase 1: Dual-Read Support (Immediate - THIS WEEK)

**Goal:** Allow system to read from BOTH old (username) and new (user ID) keys without breaking existing users.

#### Changes Required:

**1. Update `getStorageId()` to return ONLY user ID:**

```typescript
// src/lib/server/user.ts
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	// SECURITY FIX: Only use user.id, never fallback to name or token
	return user.id || '';
}
```

**2. Add `getLegacyStorageId()` for backward compatibility:**

```typescript
// src/lib/server/user.ts
/**
 * @deprecated Used only during migration to read old username-based keys.
 * Will be removed once all users have been migrated.
 */
export function getLegacyStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	// Return the OLD format for reading legacy data
	return user.name || user.id || user.token || '';
}
```

**3. Update all service read operations to check both keys:**

Example for `tripService.ts`:

```typescript
async getTrip(userId: string, tripId: string, userName?: string) {
	// Try new key format first (user ID based)
	const newKey = `trip:${userId}:${tripId}`;
	let trip = await kv.get<TripRecord>(newKey, { type: 'json' });

	// If not found and we have a username, try legacy key
	if (!trip && userName) {
		const legacyKey = `trip:${userName}:${tripId}`;
		trip = await kv.get<TripRecord>(legacyKey, { type: 'json' });

		// If found via legacy key, trigger migration (see Phase 2)
		if (trip) {
			log.info('[MIGRATION] Found trip via legacy key', { userId, tripId, legacyKey });
			// Mark for migration (flag or queue)
		}
	}

	return trip;
}
```

**4. Update all list operations to query BOTH prefixes:**

```typescript
async listTrips(userId: string, userName?: string) {
	const newPrefix = `trip:${userId}:`;
	const results = await kv.list({ prefix: newPrefix });

	// Also check legacy prefix if username exists
	if (userName) {
		const legacyPrefix = `trip:${userName}:`;
		const legacyResults = await kv.list({ prefix: legacyPrefix });

		if (legacyResults.keys.length > 0) {
			log.info('[MIGRATION] Found legacy trips', {
				userId,
				userName,
				count: legacyResults.keys.length
			});
		}

		// Combine and deduplicate results
		results.keys.push(...legacyResults.keys);
	}

	return results;
}
```

**5. Update `hooks.server.ts` to pass username to locals:**

```typescript
event.locals.user = {
	id: session.id,
	token: sessionId,
	name: session.name, // ✅ Keep this for backward compat during migration
	email: session.email
	// ... other fields
};
```

**6. Fix HughesNet API to use user.id:**

```typescript
// src/routes/api/hughesnet/+server.ts (lines 24-25)
const user = locals.user as SessionUser | undefined;
const userId = user?.id || ''; // ✅ SECURITY FIX: Only use user.id
const userName = user?.name; // For legacy reads during migration
const settingsId = user?.id;
```

**7. Update HughesNet service to accept both userId and userName:**

```typescript
// Pass userName to sync operations for dual-read support
const result = await service.sync(
	userId, // Primary (user ID)
	userName, // Legacy (for migration period)
	settingsId
	// ... other params
);
```

## **Impact:** Users can continue using the app while we prepare for migration. No data loss.

### PRECONDITION: DO NOT change `getStorageId()` alone — Atomic deploy REQUIRED

**DO NOT** deploy a change that makes `getStorageId()` return `user.id` in production without deploying the following items in the _same_ release (or gating `getStorageId()` behind a feature flag). Changing the helper in isolation will make all runtime reads only look under `trip:{uuid}:*` and will immediately cause users with legacy `trip:{username}:*` data to see empty dashboards.

Required items (must be implemented and tested before switching canonical `getStorageId()`):

1. HughesNet hardcoded fix (manual)

- File: `src/routes/api/hughesnet/+server.ts`
- Replace constructs like `const userId = user?.name || user?.token || user?.id || 'default_user'` with:

```ts
const userId = user?.id || '';
const legacyName = user?.name; // pass to service calls for dual-read
if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
```

2. Service dual-read (trip/expense/mileage)

- Files: `src/lib/server/tripService.ts`, `expenseService.ts`, `mileageService.ts`
- Update signatures to accept an optional `legacyName?: string` and implement the dual-read fallback (check `trip:{userId}:` first, then `trip:{legacyName}:`), enqueue migration for legacy keys found, and deduplicate by record id.

3. API call sites must pass `legacyName`

- Files: `src/routes/api/trips/*`, `src/routes/api/trash/*`, `src/routes/api/expenses/*`, `src/routes/api/mileage/*`, `src/routes/api/hughesnet/*`, etc.
- Use `const storageId = getStorageId(user)` and `const legacyName = user?.name` and pass both into service calls: `tripService.list(storageId, legacyName)`.

4. Defensive restore (server-side)

- File: `src/lib/server/tripService.ts`
- Update `restore(userId, itemId, legacyName?)` to attempt tombstone lookup on both `trip:{userId}:{itemId}` and `trip:{legacyName}:{itemId}` (if provided). Sanitize restored payload prior to persisting: force `backup.userId = userId` and rewrite any `hns_{legacyName}_` ids to `hns_{userId}_`.

## Add unit/integration tests that simulate legacy-keyed records/tombstones and ensure migration + restore results in items only under the UUID-based keyspace.

### Phase 2: Background Migration on Login (Next - WITHIN 2 WEEKS)

**Goal:** Automatically migrate user data from username-based keys to user ID-based keys when they log in.

#### Implementation:

**1. Create migration utility:**

```typescript
// src/lib/server/migration/storage-key-migration.ts

export async function migrateUserStorageKeys(
	env: {
		BETA_LOGS_KV: KVNamespace;
		BETA_EXPENSES_KV: KVNamespace;
		BETA_MILEAGE_KV: KVNamespace;
		BETA_TRASH_KV: KVNamespace;
	},
	userId: string,
	userName: string
): Promise<{ success: boolean; migrated: number; errors: string[] }> {
	const results = {
		success: true,
		migrated: 0,
		errors: [] as string[]
	};

	try {
		// Migrate trips
		const tripCount = await migrateKeyspace(env.BETA_LOGS_KV, 'trip', userId, userName);
		results.migrated += tripCount;

		// Migrate expenses
		const expenseCount = await migrateKeyspace(env.BETA_EXPENSES_KV, 'expense', userId, userName);
		results.migrated += expenseCount;

		// Migrate mileage
		const mileageCount = await migrateKeyspace(env.BETA_MILEAGE_KV, 'mileage', userId, userName);
		results.migrated += mileageCount;

		// Migrate trash (special handling - contains references)
		const trashCount = await migrateTrash(env.BETA_TRASH_KV, userId, userName);
		results.migrated += trashCount;

		// Migrate HughesNet data (special handling)
		const hnsCount = await migrateHughesNetData(
			env.BETA_HUGHESNET_KV,
			env.BETA_HUGHESNET_ORDERS_KV,
			userId,
			userName
		);
		results.migrated += hnsCount;

		// Migrate Settings (Critical for User Preferences)
		if (env.BETA_USER_SETTINGS_KV) {
			const settingsCount = await migrateSingleKey(
				env.BETA_USER_SETTINGS_KV,
				`settings:${userName}`,
				`settings:${userId}`
			);
			results.migrated += settingsCount;
		}

		// Migrate Authenticators (Critical for Passkey Login)
		if (env.BETA_USERS_KV) {
			const authCount = await migrateSingleKey(
				env.BETA_USERS_KV, // or the proper auth KV binding
				`authenticators:${userName}`,
				`authenticators:${userId}`
			);
			results.migrated += authCount;
		}

		// Migrate Dashboard Counters (Fixes "Empty Dashboard")
		const metaCount = await migrateSingleKey(
			env.BETA_LOGS_KV,
			`meta:user:${userName}:trip_count`,
			`meta:user:${userId}:trip_count`
		);
		results.migrated += metaCount;

		// Backfill Stripe Customer Mapping (Fixes Webhook Timeouts)
		try {
			const userRaw = await env.BETA_USERS_KV.get(userId);
			if (userRaw) {
				const user = JSON.parse(userRaw as string);
				if (user.stripeCustomerId) {
					await env.BETA_USERS_KV.put(`stripe:customer:${user.stripeCustomerId}`, userId);
				}
			}
		} catch (e) {
			log.warn('[MIGRATION] Failed to backfill stripe mapping', { userId, error: e });
		}

		log.info('[MIGRATION] User storage keys migrated', {
			userId,
			userName,
			migrated: results.migrated
		});
	} catch (error) {
		results.success = false;
		results.errors.push(error.message);
		log.error('[MIGRATION] Failed to migrate user storage keys', {
			userId,
			userName,
			error
		});
	}

	return results;
}

async function migrateKeyspace(
	kv: KVNamespace,
	recordType: string,
	userId: string,
	userName: string
): Promise<number> {
	let migrated = 0;
	const legacyPrefix = `${recordType}:${userName}:`;
	const newPrefix = `${recordType}:${userId}:`;

	// List all legacy keys
	const { keys } = await kv.list({ prefix: legacyPrefix });

	for (const { name: oldKey } of keys) {
		try {
			// 1. Read Data
			const data = await kv.get(oldKey, { type: 'json' });
			if (!data) continue;

			// 2. Extract & RENAME Record ID (Fixes HughesNet Duplicates)
			let recordId = oldKey.split(':')[2];
			if (recordId.startsWith(`hns_${userName}_`)) {
				recordId = recordId.replace(`hns_${userName}_`, `hns_${userId}_`);
			}

			const newKey = `${newPrefix}${recordId}`;

			// 3. Check Existence
			const existing = await kv.get(newKey);
			if (existing) {
				// Log warning but continue
				log.warn('[MIGRATION] New key already exists, skipping', { oldKey, newKey });
				continue;
			}

			// 4. MODIFY PAYLOAD (Fixes Reversion Loop & Tombstone Time Bomb)
			const record = data as any;
			let modified = false;

			// A. Fix top-level userId
			if (record.userId === userName) {
				record.userId = userId;
				modified = true;
			}

			// B. Fix internal ID if we renamed the key (HughesNet)
			if (record.id && recordId !== oldKey.split(':')[2]) {
				record.id = recordId;
				modified = true;
			}

			// C. Fix "Tombstone Time Bomb" (Soft Deletes)
			if (record.deleted && record.backup) {
				if (record.backup.userId === userName) {
					record.backup.userId = userId;
					modified = true;
				}
				if (record.backup.id && recordId !== oldKey.split(':')[2]) {
					record.backup.id = recordId;
					modified = true;
				}
			}

			// 5. Write to New Key (preserve metadata)
			const { metadata } = await kv.getWithMetadata(oldKey);
			await kv.put(newKey, JSON.stringify(record), { metadata: metadata });

			// 6. Delete Old Key
			await kv.delete(oldKey);

			migrated++;
		} catch (error) {
			log.error('[MIGRATION] Failed to migrate key', { oldKey, error });
		}
	}

	return migrated;
}

async function migrateTrash(
	trashKV: KVNamespace,
	userId: string,
	userName: string
): Promise<number> {
	let migrated = 0;

	// Trash items might reference old keys in their metadata
	const { keys } = await trashKV.list({ prefix: 'trash:' });

	for (const { name: trashKey } of keys) {
		try {
			const item = await trashKV.get<TrashItem>(trashKey, { type: 'json' });
			if (!item) continue;

			// Check if this trash item belongs to this user
			if (item.userId !== userName && item.userId !== userId) {
				continue;
			}

			// Update userId to use ID instead of name
			if (item.userId === userName) {
				item.userId = userId;
			}

			// Update originalKey references
			if (item.metadata?.originalKey) {
				const originalKey = item.metadata.originalKey;
				if (originalKey.includes(`:${userName}:`)) {
					item.metadata.originalKey = originalKey.replace(`:${userName}:`, `:${userId}:`);
				}
			}

			// Write updated trash item
			await trashKV.put(trashKey, JSON.stringify(item));
			migrated++;
		} catch (error) {
			log.error('[MIGRATION] Failed to migrate trash item', {
				trashKey,
				error
			});
		}
	}

	return migrated;
}

async function migrateHughesNetData(
	hughesnetKV: KVNamespace,
	ordersKV: KVNamespace,
	userId: string,
	userName: string
): Promise<number> {
	let migrated = 0;

	try {
		// Migrate HughesNet settings
		const settingsKey = `hns:settings:${userName}`;
		const settings = await hughesnetKV.get(settingsKey);
		if (settings) {
			const newSettingsKey = `hns:settings:${userId}`;
			const existing = await hughesnetKV.get(newSettingsKey);
			if (!existing) {
				await hughesnetKV.put(newSettingsKey, settings);
				await hughesnetKV.delete(settingsKey);
				migrated++;
			}
		}

		// Migrate HughesNet order database
		const dbKey = `hns:db:${userName}`;
		const db = await hughesnetKV.get(dbKey);
		if (db) {
			const newDbKey = `hns:db:${userId}`;
			const existing = await hughesnetKV.get(newDbKey);
			if (!existing) {
				await hughesnetKV.put(newDbKey, db);
				await hughesnetKV.delete(dbKey);
				migrated++;
			}
		}

		// Migrate HughesNet session/credentials
		const sessionKey = `hns:session:${userName}`;
		const session = await hughesnetKV.get(sessionKey);
		if (session) {
			const newSessionKey = `hns:session:${userId}`;
			const existing = await hughesnetKV.get(newSessionKey);
			if (!existing) {
				await hughesnetKV.put(newSessionKey, session);
				await hughesnetKV.delete(sessionKey);
				migrated++;
			}
		}

		// Migrate individual HughesNet orders (if stored per-order)
		// Note: These are keyed as `hns:order:{orderId}` with ownerId in the value
		// We need to update the ownerId field from userName to userId
		const { keys: orderKeys } = await ordersKV.list({ prefix: 'hns:order:' });
		for (const { name: orderKey } of orderKeys) {
			try {
				const orderWrapper = await ordersKV.get(orderKey, { type: 'json' });
				if (orderWrapper && orderWrapper.ownerId === userName) {
					// Update ownerId to userId
					orderWrapper.ownerId = userId;
					await ordersKV.put(orderKey, JSON.stringify(orderWrapper));
					migrated++;
				}
			} catch (error) {
				log.error('[MIGRATION] Failed to migrate HughesNet order', {
					orderKey,
					error
				});
			}
		}

		log.info('[MIGRATION] HughesNet data migrated', {
			userId,
			userName,
			migratedItems: migrated
		});
	} catch (error) {
		log.error('[MIGRATION] Failed to migrate HughesNet data', {
			userId,
			userName,
			error
		});
	}

	return migrated;
}
```

**2. Add migration trigger to login handler:**

```typescript
// src/routes/login/+server.ts

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	// ... existing auth logic ...

	if (authSuccess) {
		// ... create session ...

		// TRIGGER MIGRATION in background (non-blocking)
		if (platform?.context?.waitUntil && user.name) {
			platform.context.waitUntil(
				migrateUserStorageKeys(platform.env, user.id, user.name).catch((err) => {
					log.error('[MIGRATION] Background migration failed', {
						userId: user.id,
						error: err
					});
				})
			);
		}

		return json({ success: true });
	}
};
```

**3. Add migration status tracking:**

```typescript
// Store in BETA_USERS_KV
interface UserRecord {
	// ... existing fields ...
	migrationStatus?: {
		storageKeysMigrated: boolean;
		migratedAt?: string;
		recordsMigrated?: number;
	};
}
```

**Impact:** Over time, as users log in, their data will be automatically migrated. No user action required.

---

### Phase 3: Cleanup Legacy Reads (After 90 Days)

**Goal:** Remove dual-read logic once migration is complete.

#### Criteria for Moving to Phase 3:

- ✅ 95%+ of active users have logged in (check analytics)
- ✅ Migration script has run successfully for active accounts
- ✅ Zero critical bugs reported from Phase 1 or 2
- ✅ Manual migration script available for dormant accounts

#### Actions:

1. **Remove `getLegacyStorageId()` function**
2. **Remove dual-read logic from all services**
3. **Update services to only read from user ID keys**
4. **Add monitoring to detect any remaining legacy keys**

```typescript
// After cleanup, services look like this:
async getTrip(userId: string, tripId: string) {
	const key = `trip:${userId}:${tripId}`;
	return await kv.get<TripRecord>(key, { type: 'json' });
}
```

**5. Run cleanup script to remove remaining legacy keys:**

```typescript
// tools/cleanup-legacy-storage-keys.ts
// Only run after confirming all active users migrated
```

---

## Files That Need Changes

### Phase 1 (Immediate):

- ✅ `src/lib/server/user.ts` - Update `getStorageId()`, add `getLegacyStorageId()`
- ✅ `src/lib/server/tripService.ts` - Add dual-read logic
- ✅ `src/lib/server/expenseService.ts` - Add dual-read logic
- ✅ `src/lib/server/mileageService.ts` - Add dual-read logic
- ✅ `src/routes/api/trash/[id]/+server.ts` - Add dual-read logic
- ✅ `src/routes/api/hughesnet/+server.ts` - Fix userId extraction (use `user.id` only)
- ✅ `src/routes/api/hughesnet/archived/+server.ts` - Fix userId extraction
- ✅ `src/lib/server/hughesnet/service.ts` - Add dual-read support for HNS data
- ✅ `src/hooks.server.ts` - Ensure `user.name` is available in `locals.user`

### Phase 2 (Within 2 Weeks):

- ✅ `src/lib/server/migration/storage-key-migration.ts` - New file (COMPLETED)
- ✅ `src/routes/login/+server.ts` - Add migration trigger (COMPLETED)
- ✅ `src/lib/types/index.ts` - Add migration status tracking (COMPLETED)
- ✅ `src/lib/types/index.d.ts` - Add migration status to type definitions (COMPLETED)

### Phase 3 (After 90 Days):

- ✅ Remove legacy code from all Phase 1 files
- ✅ `tools/cleanup-legacy-storage-keys.ts` - New cleanup script

---

## Testing Strategy

### Phase 1 Tests:

1. **Create test user with username-based data**
2. **Verify they can read their data after `getStorageId()` change**
3. **Verify new data writes to user ID keys**
4. **Verify list operations return both old and new records**

### Phase 2 Tests:

1. **Simulate login with legacy data**
2. **Verify migration runs in background**
3. **Verify user can access data during migration**
4. **Verify data integrity after migration**
5. **Test migration idempotence (safe to run multiple times)**

### Phase 3 Tests:

1. **Verify no legacy keys remain for active users**
2. **Verify all services read from new keys only**
3. **Performance testing (no dual-read overhead)**

---

## Rollback Plan

If issues arise during Phase 1:

1. Revert `getStorageId()` to original implementation
2. All user data remains accessible via username keys
3. No data loss (reads were non-destructive)

If issues arise during Phase 2:

1. Disable migration trigger in login handler
2. Legacy data still readable via Phase 1 dual-read logic
3. Roll forward with fixes, not backward (data may be in transition state)

---

## Monitoring & Alerts

**Metrics to Track:**

- `migration.users_migrated` - Count of users successfully migrated
- `migration.records_migrated` - Total records migrated
- `migration.legacy_reads` - Count of legacy key reads (should trend to zero)
- `migration.errors` - Migration failures

**Alerts:**

- Alert if migration error rate > 1%
- Alert if legacy reads increase (suggests regression)
- Alert if dual-read timeout (performance issue)

---

## Timeline

| Phase   | Timeline      | Status                      |
| ------- | ------------- | --------------------------- |
| Phase 1 | Week 1        | ✅ COMPLETED (Jan 22, 2026) |
| Phase 2 | Week 2-3      | ✅ COMPLETED (Jan 22, 2026) |
| Phase 3 | After 90 days | Not Started                 |

---

## Questions & Decisions

**Q: What about users who never log in again?**  
**A:** Their data remains in legacy format. After 90 days, run manual migration script or accept that dormant accounts use legacy keys.

**Q: What if a user has both username and user ID keys?**  
**A:** Phase 2 migration checks for existing keys and skips if found. User ID keys take precedence in Phase 1 dual-read.

**Q: How do we handle trash restoration with mixed key formats?**  
**A:** Trash metadata's `originalKey` field gets updated during Phase 2 migration. Restoration uses the current key format.

**Q: Performance impact of dual-read?**  
**A:** Minimal - legacy read only happens if primary (user ID) read returns null. Monitor with metrics.

**Q: Can we speed up Phase 3?**  
**A:** Yes, if migration adoption is high (>95%) in 30 days, can proceed early. Check `migration.legacy_reads` metric.

---

## Security Benefits

✅ **Fixes Critical P0 Account Takeover vulnerability**  
✅ **Eliminates username-based key guessing**  
✅ **Prevents session token-based key access**  
✅ **Enforces user ID as single source of truth**  
✅ **Maintains SECURITY.md compliance**

---

## Next Steps

1. **Review this migration plan with team**
2. **Get approval for Phase 1 changes**
3. **Implement Phase 1 in feature branch**
4. **Test Phase 1 thoroughly in staging**
5. **Deploy Phase 1 to production**
6. **Monitor metrics for 1 week**
7. **Proceed to Phase 2 if Phase 1 is stable**
