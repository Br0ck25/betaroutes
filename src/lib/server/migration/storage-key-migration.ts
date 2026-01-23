/**
 * Storage Key Migration Utility
 *
 * Migrates user data from username-based storage keys to user ID-based keys.
 * This fixes the P0 account takeover vulnerability where usernames could collide.
 *
 * SECURITY: This migration is critical. Keys were previously:
 *   - OLD: `trip:{username}:{recordId}`
 *   - NEW: `trip:{userId}:{recordId}`
 *
 * @see STORAGE_KEY_MIGRATION.md for full migration strategy
 */

import { log } from '$lib/server/log';

interface MigrationResult {
	success: boolean;
	migrated: number;
	errors: string[];
}

interface TrashItem {
	id: string;
	userId: string;
	deleted: boolean;
	deletedAt: string;
	metadata?: {
		originalKey?: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

interface HughesNetOrderWrapper {
	ownerId: string;
	[key: string]: unknown;
}

/**
 * Main migration function - migrates all user data from username-based keys to user ID-based keys
 * @param env - Cloudflare environment with KV namespaces
 * @param userId - User's UUID (new key format)
 * @param userName - User's username (legacy key format)
 * @returns Migration result with success status, count, and any errors
 */
export async function migrateUserStorageKeys(
	env: {
		BETA_LOGS_KV?: KVNamespace;
		BETA_EXPENSES_KV?: KVNamespace;
		BETA_MILLAGE_KV?: KVNamespace; // Note: typo in original KV name
		BETA_TRASH_KV?: KVNamespace;
		BETA_HUGHESNET_KV?: KVNamespace;
		BETA_HUGHESNET_ORDERS_KV?: KVNamespace;
	},
	userId: string,
	userName: string,
	options?: { mode?: 'move' | 'rebuild'; force?: boolean }
): Promise<MigrationResult> {
	// Lazy-import HughesNet helper implementation to avoid forward-declare ordering
	async function migrateHughesNetData(
		hughesnetKV: KVNamespace,
		ordersKV: KVNamespace,
		userId: string,
		userName: string,
		options?: { mode?: 'move' | 'rebuild' }
	): Promise<{ migrated: number; errors: string[] }> {
		// Implementation moved inline to guarantee availability and avoid hoisting issues
		const mode = options?.mode ?? 'move';
		let migrated = 0;
		const errors: string[] = [];

		try {
			// Migrate HughesNet settings
			// Helper to try multiple casing variants for hughesnet keys
			async function tryHnsKeyVariants(kv: KVNamespace, keyBase: string) {
				// Attempt variants focused on the username suffix only (safer than general-case transformations)
				const lastColon = keyBase.lastIndexOf(':');
				const prefix = lastColon !== -1 ? keyBase.slice(0, lastColon + 1) : keyBase;
				const namePart = lastColon !== -1 ? keyBase.slice(lastColon + 1) : '';

				function capitalize(s: string) {
					return s.length ? s[0].toUpperCase() + s.slice(1) : s;
				}

				const variants = [
					`${prefix}${namePart}`,
					`${prefix}${namePart.toLowerCase()}`,
					`${prefix}${namePart.toUpperCase()}`,
					`${prefix}${capitalize(namePart)}`
				].filter(Boolean);

				for (const k of variants) {
					try {
						const v = await kv.get(k);
						if (v) return { key: k, value: v };
					} catch {
						// ignore
					}
				}
				return null;
			}

			// Migrate HughesNet settings
			const settingsRes = await tryHnsKeyVariants(hughesnetKV, `hns:settings:${userName}`);
			if (settingsRes) {
				const { key: settingsKey, value: settings } = settingsRes;
				const newSettingsKey = `hns:settings:${userId}`;
				const existing = await hughesnetKV.get(newSettingsKey);
				if (!existing) {
					await hughesnetKV.put(newSettingsKey, settings);
					log.info('[MIGRATION] Migrated HughesNet settings', { userId, mode, settingsKey });
				}
				if (mode === 'move') {
					await hughesnetKV.delete(settingsKey);
				}
				migrated++;
			}

			// Migrate HughesNet order database
			const dbRes = await tryHnsKeyVariants(hughesnetKV, `hns:db:${userName}`);
			if (dbRes) {
				const { key: dbKey, value: db } = dbRes;
				const newDbKey = `hns:db:${userId}`;
				const existing = await hughesnetKV.get(newDbKey);
				if (!existing) {
					await hughesnetKV.put(newDbKey, db);
					log.info('[MIGRATION] Migrated HughesNet database', { userId, mode, dbKey });
				}
				if (mode === 'move') {
					await hughesnetKV.delete(dbKey);
				}
				migrated++;
			}

			// Migrate HughesNet session/credentials
			const sessionRes = await tryHnsKeyVariants(hughesnetKV, `hns:session:${userName}`);
			if (sessionRes) {
				const { key: sessionKey, value: session } = sessionRes;
				const newSessionKey = `hns:session:${userId}`;
				const existing = await hughesnetKV.get(newSessionKey);
				if (!existing) {
					await hughesnetKV.put(newSessionKey, session);
					log.info('[MIGRATION] Migrated HughesNet session', { userId, mode, sessionKey });
				}
				migrated++;
			}

			// Migrate individual HughesNet orders
			// Orders are keyed as `hns:order:{orderId}` with ownerId field in the value
			let list = await ordersKV.list({ prefix: 'hns:order:' });
			let orderKeys = list.keys;

			// Handle pagination
			while (!list.list_complete && list.cursor) {
				list = await ordersKV.list({ prefix: 'hns:order:', cursor: list.cursor });
				orderKeys = orderKeys.concat(list.keys);
			}

			// Robust, case-insensitive processing for HughesNet orders (handles ownerId with different casing)
			const normalizedUsername = userName.toLowerCase();
			for (const { name: orderKey } of orderKeys) {
				try {
					const raw = await ordersKV.get(orderKey);
					if (!raw) continue;

					const orderWrapper = JSON.parse(raw) as HughesNetOrderWrapper;
					if (String(orderWrapper.ownerId).toLowerCase() === normalizedUsername) {
						if (mode === 'rebuild') {
							const newKey = `${orderKey}:rebuild:${userId}`;
							orderWrapper.ownerId = userId;
							await ordersKV.put(newKey, JSON.stringify(orderWrapper));
							log.info('[MIGRATION] Rebuilt HughesNet order (copy)', { orderKey, newKey, userId });
						} else {
							orderWrapper.ownerId = userId;
							await ordersKV.put(orderKey, JSON.stringify(orderWrapper));
							log.info('[MIGRATION] Updated HughesNet order ownerId', { orderKey, userId });
						}
						migrated++;
					}
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					log.error('[MIGRATION] Failed to migrate HughesNet order (robust)', {
						orderKey,
						error: errorMsg
					});
					errors.push(`error:${orderKey}:${errorMsg}`);
				}
			}

			// Prevent the older loop below from running again over the same keys
			orderKeys = [];

			log.info('[MIGRATION] HughesNet data migration completed', {
				userId,
				userName,
				migratedItems: migrated
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			log.error('[MIGRATION] Failed to migrate HughesNet data', {
				userId,
				userName,
				error: errorMsg
			});
			errors.push(`error:hughesnet:${errorMsg}`);
		}

		return { migrated, errors };
	}

	const mode = options?.mode ?? 'move';
	const force = options?.force ?? false;
	const results: MigrationResult = {
		success: true,
		migrated: 0,
		errors: []
	};

	log.info('[MIGRATION] Starting storage key migration', { userId, userName });

	// Skip if migration already completed for this user (unless forced)
	const migrationMarkerKey = `migration:username_to_id:completed:${userId}`;
	if (!force && env.BETA_LOGS_KV) {
		const already = await env.BETA_LOGS_KV.get(migrationMarkerKey);
		if (already) {
			log.info('[MIGRATION] Already completed for user, skipping', { userId });
			return results;
		}
	}

	try {
		// Migrate trips
		if (env.BETA_LOGS_KV) {
			const { migrated: tripCount, errors: tripErrors } = await migrateKeyspace(
				env.BETA_LOGS_KV as any,
				'trip',
				userId,
				userName,
				{ mode }
			);
			results.migrated += tripCount;
			results.errors.push(...tripErrors);
			log.info('[MIGRATION] Trips migrated', { userId, count: tripCount });
		}

		// Migrate expenses
		if (env.BETA_EXPENSES_KV) {
			const { migrated: expenseCount, errors: expenseErrors } = await migrateKeyspace(
				env.BETA_EXPENSES_KV as any,
				'expense',
				userId,
				userName,
				{ mode }
			);
			results.migrated += expenseCount;
			results.errors.push(...expenseErrors);
			log.info('[MIGRATION] Expenses migrated', { userId, count: expenseCount });
		}

		// Migrate mileage
		if (env.BETA_MILLAGE_KV) {
			const { migrated: mileageCount, errors: mileageErrors } = await migrateKeyspace(
				env.BETA_MILLAGE_KV as any,
				'mileage',
				userId,
				userName,
				{ mode }
			);
			results.migrated += mileageCount;
			results.errors.push(...mileageErrors);
			log.info('[MIGRATION] Mileage records migrated', { userId, count: mileageCount });
		}

		// Migrate trash (special handling - contains references to original keys)
		if (env.BETA_TRASH_KV) {
			const { migrated: trashCount, errors: trashErrors } = await migrateTrash(
				env.BETA_TRASH_KV as any,
				userId,
				userName,
				{ mode }
			);
			results.migrated += trashCount;
			results.errors.push(...trashErrors);
			log.info('[MIGRATION] Trash items migrated', { userId, count: trashCount });
		}

		// Migrate HughesNet data (special handling for multiple key patterns)
		if (env.BETA_HUGHESNET_KV && env.BETA_HUGHESNET_ORDERS_KV) {
			const { migrated: hnsCount, errors: hnsErrors } = await migrateHughesNetData(
				env.BETA_HUGHESNET_KV as any,
				env.BETA_HUGHESNET_ORDERS_KV as any,
				userId,
				userName,
				{ mode }
			);
			results.migrated += hnsCount;
			results.errors.push(...hnsErrors);
			log.info('[MIGRATION] HughesNet data migrated', { userId, count: hnsCount });
		}

		log.info('[MIGRATION] User storage keys migration completed', {
			userId,
			userName,
			totalMigrated: results.migrated
		});

		// If the migration succeeded with no logged errors, mark it as completed so
		// we don't re-run this work on subsequent logins.
		if (results.success && results.errors.length === 0) {
			if (env.BETA_LOGS_KV) {
				await env.BETA_LOGS_KV.put(
					migrationMarkerKey,
					JSON.stringify({ completedAt: new Date().toISOString(), migrated: results.migrated })
				);
			}
		}
	} catch (error) {
		results.success = false;
		const errorMsg = error instanceof Error ? error.message : String(error);
		results.errors.push(errorMsg);
		log.error('[MIGRATION] Failed to migrate user storage keys', {
			userId,
			userName,
			error: errorMsg
		});
	}

	return results;
}

function escapeRegExp(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize known owner/user fields inside stored JSON values.
 * - If top-level `userId` or `ownerId` matches the legacy username (case-insensitive), replace with UUID
 * - Also try to fix metadata.originalKey occurrences
 */
function normalizeStoredRecord(
	raw: string,
	userId: string,
	userName: string
): { data: string; changed: boolean } {
	try {
		const obj = JSON.parse(raw);
		let changed = false;
		const normalizedUsername = String(userName).toLowerCase();

		if (obj && typeof obj === 'object') {
			if (obj.userId && String(obj.userId).toLowerCase() === normalizedUsername) {
				obj.userId = userId;
				changed = true;
			}
			if (obj.ownerId && String(obj.ownerId).toLowerCase() === normalizedUsername) {
				obj.ownerId = userId;
				changed = true;
			}
			if (obj.metadata && typeof obj.metadata === 'object' && obj.metadata.originalKey) {
				obj.metadata.originalKey = String(obj.metadata.originalKey).replace(
					new RegExp(`:${escapeRegExp(userName)}:`, 'gi'),
					`:${userId}:`
				);
				changed = true;
			}

			return { data: JSON.stringify(obj), changed };
		}
		return { data: raw, changed: false };
	} catch {
		// Not JSON or parse failed - leave as-is
		return { data: raw, changed: false };
	}
}

/**
 * Migrates a single keyspace (trips, expenses, or mileage)
 * @param kv - KV namespace to migrate
 * @param recordType - Type of record (trip, expense, mileage)
 * @param userId - User's UUID
 * @param userName - User's username
 * @returns Count of migrated records
 */
async function migrateKeyspace(
	kv: KVNamespace,
	recordType: string,
	userId: string,
	userName: string,
	options?: { mode?: 'move' | 'rebuild' }
): Promise<{ migrated: number; errors: string[] }> {
	const mode = options?.mode ?? 'move';
	const errors: string[] = [];
	let migrated = 0;
	const newPrefix = `${recordType}:${userId}:`;

	// Helper: try listing by several username variants to avoid missing case differences
	function usernameVariants(name: string) {
		const variants = new Set<string>();
		variants.add(name);
		variants.add(name.toLowerCase());
		variants.add(name.toUpperCase());
		// Capitalize first letter variant
		if (name.length > 0) {
			variants.add(name[0].toUpperCase() + name.slice(1));
		}
		return Array.from(variants);
	}

	// First attempt: try common casing variants to avoid listing full keyspace
	let keys: Array<{ name: string }> = [];
	for (const variant of usernameVariants(userName)) {
		const prefix = `${recordType}:${variant}:`;
		let list = await kv.list({ prefix });
		let found = list.keys;
		while (!list.list_complete && list.cursor) {
			list = await kv.list({ prefix, cursor: list.cursor });
			found = found.concat(list.keys);
		}
		if (found.length > 0) {
			keys = found;
			break; // found matching-cased keys
		}
	}

	// Fallback: scan the entire keyspace for this recordType and filter case-insensitively
	if (keys.length === 0) {
		log.info(
			'[MIGRATION] No keys found with prefixed username variants, falling back to full scan (case-insensitive match)',
			{
				userId,
				userName
			}
		);
		let list = await kv.list({ prefix: `${recordType}:` });
		let all = list.keys;
		while (!list.list_complete && list.cursor) {
			list = await kv.list({ prefix: `${recordType}:`, cursor: list.cursor });
			all = all.concat(list.keys);
		}
		keys = all.filter((k) => {
			const parts = k.name.split(':');
			return parts[1] && parts[1].toLowerCase() === userName.toLowerCase();
		});
	}

	log.info(`[MIGRATION] Found ${keys.length} legacy ${recordType} records`, { userId, userName });

	for (const { name: oldKey } of keys) {
		try {
			// Read from old key
			const data = (await kv.get(oldKey)) as string | null;
			if (!data) {
				log.warn('[MIGRATION] Legacy key has no data, skipping', { oldKey });
				continue;
			}

			// Extract the record ID (everything after second colon)
			const parts = oldKey.split(':');
			if (parts.length < 3) {
				log.warn('[MIGRATION] Invalid legacy key format, skipping', { oldKey });
				continue;
			}
			const recordId = parts.slice(2).join(':'); // Handle IDs that might contain colons
			const newKey = `${newPrefix}${recordId}`;

			// Get metadata if available (some KVs don't support getWithMetadata in test mocks)
			let metadata: Record<string, unknown> | undefined = undefined;
			if (typeof (kv as any).getWithMetadata === 'function') {
				const metaRes = await (kv as any).getWithMetadata(oldKey);
				metadata = (metaRes as any)?.metadata;
			}

			// Normalize stored JSON value (if it's JSON and contains username)
			const { data: normalizedData, changed: normalizedChanged } = normalizeStoredRecord(
				data,
				userId,
				userName
			);

			// Check if new key already exists
			const existing = (await kv.get(newKey)) as string | null;
			if (existing) {
				// If identical to the legacy raw data
				if (existing === data) {
					// If normalization changed the value, write normalized result either as rebuilt copy or overwrite
					if (normalizedChanged) {
						if (mode === 'rebuild') {
							const altKey = `${newKey}:rebuild:${userId}`;
							log.info(
								'[MIGRATION] New key existed (identical) but value normalized - creating rebuilt copy',
								{
									oldKey,
									newKey: altKey
								}
							);
							if (metadata) {
								await kv.put(altKey, normalizedData, { metadata });
							} else {
								await kv.put(altKey, normalizedData);
							}
							migrated++;
							continue;
						} else {
							// move mode: overwrite existing with normalized data
							if (metadata) {
								await kv.put(newKey, normalizedData, { metadata });
							} else {
								await kv.put(newKey, normalizedData);
							}
							if (mode === 'move') await kv.delete(oldKey);
							migrated++;
							log.info('[MIGRATION] New key existed and was updated (overwrite normalized value)', {
								oldKey,
								newKey
							});
							continue;
						}
					} else {
						log.info('[MIGRATION] New key already exists and identical, skipping legacy delete', {
							oldKey,
							newKey
						});
						migrated++;
						if (mode === 'move') {
							await kv.delete(oldKey);
						}
						continue;
					}
				} else if (mode === 'rebuild') {
					// Create a rebuilt copy to avoid overwriting differing data. Prefer normalized content if available.
					const altKey = `${newKey}:rebuild:${userId}`;
					const payloadToWrite = normalizedChanged ? normalizedData : data;
					log.info('[MIGRATION] New key exists with different data - creating rebuilt copy', {
						oldKey,
						newKey: altKey
					});
					// Preserve metadata when available
					if (metadata) {
						await kv.put(altKey, payloadToWrite, { metadata });
					} else {
						await kv.put(altKey, payloadToWrite);
					}
					migrated++;
					continue;
				} else {
					log.warn('[MIGRATION] Conflict: new key exists with different data - skipping', {
						oldKey,
						newKey
					});
					errors.push(`conflict:${oldKey}`);
					continue;
				}
			}

			// Write to new key (preserve metadata when available)
			if (metadata) {
				await kv.put(newKey, normalizedData, { metadata });
			} else {
				await kv.put(newKey, normalizedData);
			}

			// Only delete old key if we're in 'move' mode
			if (mode === 'move') {
				await kv.delete(oldKey);
			}

			migrated++;

			if (normalizedChanged) {
				log.info('[MIGRATION] Migrated record and normalized userId in value', {
					recordType,
					oldKey,
					newKey,
					userId,
					mode
				});
			} else {
				log.info('[MIGRATION] Migrated record', {
					recordType,
					oldKey,
					newKey,
					userId,
					mode
				});
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			log.error('[MIGRATION] Failed to migrate key', {
				oldKey,
				error: errorMsg
			});
			errors.push(`error:${oldKey}:${errorMsg}`);
		}
	}

	return { migrated, errors };
}

/**
 * Trash items contain metadata.originalKey that needs updating
 * @param trashKV - Trash KV namespace
 * @param userId - User's UUID
 * @param userName - User's username
 * @returns Count of migrated trash items
 */
async function migrateTrash(
	trashKV: KVNamespace,
	userId: string,
	userName: string,
	options?: { mode?: 'move' | 'rebuild' }
): Promise<{ migrated: number; errors: string[] }> {
	const mode = options?.mode ?? 'move';
	let migrated = 0;
	const errors: string[] = [];

	// List all trash items (trash keys are not user-prefixed, so we need to check each one)
	let list = await trashKV.list({ prefix: 'trash:' });
	let keys = list.keys;

	// Handle pagination
	while (!list.list_complete && list.cursor) {
		list = await trashKV.list({ prefix: 'trash:', cursor: list.cursor });
		keys = keys.concat(list.keys);
	}

	for (const { name: trashKey } of keys) {
		try {
			const raw = await trashKV.get(trashKey);
			if (!raw) continue;

			const item = JSON.parse(raw) as TrashItem;

			// Check if this trash item belongs to this user (case-insensitive match on username)
			if (String(item.userId).toLowerCase() !== userName.toLowerCase() && item.userId !== userId) {
				continue; // Not this user's trash
			}

			// Update userId from username to user ID - but in 'rebuild' mode we create a new copy
			const originalId = item.id;
			if (String(item.userId).toLowerCase() === userName.toLowerCase()) {
				if (mode === 'rebuild') {
					// Create a copy with userId set to UUID and a reproducible key so it can be found later
					const newItem: TrashItem = {
						...item,
						id: `${originalId}-rebuild-${userId}`,
						userId: userId,
						deletedAt: item.deletedAt,
						deleted: item.deleted
					};

					if (newItem.metadata?.originalKey) {
						newItem.metadata.originalKey = newItem.metadata.originalKey.replace(
							new RegExp(`:${escapeRegExp(userName)}:`, 'gi'),
							`:${userId}:`
						);
					}

					await trashKV.put(`trash:${newItem.id}`, JSON.stringify(newItem));
					migrated++;
					log.info('[MIGRATION] Created rebuilt trash item', {
						oldId: originalId,
						newId: newItem.id,
						userId
					});
				} else {
					// move mode: update in place
					item.userId = userId;
					if (item.metadata?.originalKey) {
						item.metadata.originalKey = item.metadata.originalKey.replace(
							new RegExp(`:${escapeRegExp(userName)}:`, 'gi'),
							`:${userId}:`
						);
					}
					await trashKV.put(trashKey, JSON.stringify(item));
					migrated++;
					log.info('[MIGRATION] Updated trash item', { trashKey, userId });
				}
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			log.error('[MIGRATION] Failed to migrate trash item', {
				trashKey,
				error: errorMsg
			});
			errors.push(`error:${trashKey}:${errorMsg}`);
		}
	}

	return { migrated, errors };
}
