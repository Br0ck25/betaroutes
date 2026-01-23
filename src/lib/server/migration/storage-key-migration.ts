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
	userName: string
): Promise<MigrationResult> {
	const results: MigrationResult = {
		success: true,
		migrated: 0,
		errors: []
	};

	log.info('[MIGRATION] Starting storage key migration', { userId, userName });

	try {
		// Migrate trips
		if (env.BETA_LOGS_KV) {
			const tripCount = await migrateKeyspace(env.BETA_LOGS_KV, 'trip', userId, userName);
			results.migrated += tripCount;
			log.info('[MIGRATION] Trips migrated', { userId, count: tripCount });
		}

		// Migrate expenses
		if (env.BETA_EXPENSES_KV) {
			const expenseCount = await migrateKeyspace(env.BETA_EXPENSES_KV, 'expense', userId, userName);
			results.migrated += expenseCount;
			log.info('[MIGRATION] Expenses migrated', { userId, count: expenseCount });
		}

		// Migrate mileage
		if (env.BETA_MILLAGE_KV) {
			const mileageCount = await migrateKeyspace(env.BETA_MILLAGE_KV, 'mileage', userId, userName);
			results.migrated += mileageCount;
			log.info('[MIGRATION] Mileage records migrated', { userId, count: mileageCount });
		}

		// Migrate trash (special handling - contains references to original keys)
		if (env.BETA_TRASH_KV) {
			const trashCount = await migrateTrash(env.BETA_TRASH_KV, userId, userName);
			results.migrated += trashCount;
			log.info('[MIGRATION] Trash items migrated', { userId, count: trashCount });
		}

		// Migrate HughesNet data (special handling for multiple key patterns)
		if (env.BETA_HUGHESNET_KV && env.BETA_HUGHESNET_ORDERS_KV) {
			const hnsCount = await migrateHughesNetData(
				env.BETA_HUGHESNET_KV,
				env.BETA_HUGHESNET_ORDERS_KV,
				userId,
				userName
			);
			results.migrated += hnsCount;
			log.info('[MIGRATION] HughesNet data migrated', { userId, count: hnsCount });
		}

		log.info('[MIGRATION] User storage keys migration completed', {
			userId,
			userName,
			totalMigrated: results.migrated
		});
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
	userName: string
): Promise<number> {
	let migrated = 0;
	const legacyPrefix = `${recordType}:${userName}:`;
	const newPrefix = `${recordType}:${userId}:`;

	// List all legacy keys for this user
	let list = await kv.list({ prefix: legacyPrefix });
	let keys = list.keys;

	// Handle pagination if there are many keys
	while (!list.list_complete && list.cursor) {
		list = await kv.list({ prefix: legacyPrefix, cursor: list.cursor });
		keys = keys.concat(list.keys);
	}

	log.info(`[MIGRATION] Found ${keys.length} legacy ${recordType} records`, { userId, userName });

	for (const { name: oldKey } of keys) {
		try {
			// Read from old key
			const data = await kv.get(oldKey);
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

			// Check if new key already exists (migration already done)
			const existing = await kv.get(newKey);
			if (existing) {
				log.info('[MIGRATION] New key already exists, deleting legacy only', {
					oldKey,
					newKey
				});
				await kv.delete(oldKey);
				migrated++;
				continue;
			}

			// Get metadata if available
			const { metadata } = await kv.getWithMetadata(oldKey);

			// Write to new key (preserve metadata)
			await kv.put(newKey, data, {
				metadata: metadata || undefined
			});

			// Delete old key
			await kv.delete(oldKey);

			migrated++;

			log.info('[MIGRATION] Migrated record', {
				recordType,
				oldKey,
				newKey,
				userId
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			log.error('[MIGRATION] Failed to migrate key', {
				oldKey,
				error: errorMsg
			});
		}
	}

	return migrated;
}

/**
 * Migrates trash items and updates internal references
 * Trash items contain metadata.originalKey that needs updating
 * @param trashKV - Trash KV namespace
 * @param userId - User's UUID
 * @param userName - User's username
 * @returns Count of migrated trash items
 */
async function migrateTrash(
	trashKV: KVNamespace,
	userId: string,
	userName: string
): Promise<number> {
	let migrated = 0;

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

			// Check if this trash item belongs to this user
			if (item.userId !== userName && item.userId !== userId) {
				continue; // Not this user's trash
			}

			let modified = false;

			// Update userId from username to user ID
			if (item.userId === userName) {
				item.userId = userId;
				modified = true;
			}

			// Update originalKey references in metadata
			if (item.metadata?.originalKey) {
				const originalKey = item.metadata.originalKey;
				if (originalKey.includes(`:${userName}:`)) {
					item.metadata.originalKey = originalKey.replace(`:${userName}:`, `:${userId}:`);
					modified = true;
				}
			}

			// Write updated trash item if modified
			if (modified) {
				await trashKV.put(trashKey, JSON.stringify(item));
				migrated++;
				log.info('[MIGRATION] Updated trash item', { trashKey, userId });
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			log.error('[MIGRATION] Failed to migrate trash item', {
				trashKey,
				error: errorMsg
			});
		}
	}

	return migrated;
}

/**
 * Migrates HughesNet-specific data (settings, session, order database)
 * HughesNet uses multiple key patterns:
 * - hns:settings:{username} -> hns:settings:{userId}
 * - hns:db:{username} -> hns:db:{userId}
 * - hns:session:{username} -> hns:session:{userId}
 * - hns:order:{orderId} (updates ownerId field inside)
 *
 * @param hughesnetKV - HughesNet KV namespace
 * @param ordersKV - HughesNet orders KV namespace
 * @param userId - User's UUID
 * @param userName - User's username
 * @returns Count of migrated HughesNet items
 */
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
				log.info('[MIGRATION] Migrated HughesNet settings', { userId });
			}
			await hughesnetKV.delete(settingsKey);
			migrated++;
		}

		// Migrate HughesNet order database
		const dbKey = `hns:db:${userName}`;
		const db = await hughesnetKV.get(dbKey);
		if (db) {
			const newDbKey = `hns:db:${userId}`;
			const existing = await hughesnetKV.get(newDbKey);
			if (!existing) {
				await hughesnetKV.put(newDbKey, db);
				log.info('[MIGRATION] Migrated HughesNet database', { userId });
			}
			await hughesnetKV.delete(dbKey);
			migrated++;
		}

		// Migrate HughesNet session/credentials
		const sessionKey = `hns:session:${userName}`;
		const session = await hughesnetKV.get(sessionKey);
		if (session) {
			const newSessionKey = `hns:session:${userId}`;
			const existing = await hughesnetKV.get(newSessionKey);
			if (!existing) {
				await hughesnetKV.put(newSessionKey, session);
				log.info('[MIGRATION] Migrated HughesNet session', { userId });
			}
			await hughesnetKV.delete(sessionKey);
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

		for (const { name: orderKey } of orderKeys) {
			try {
				const raw = await ordersKV.get(orderKey);
				if (!raw) continue;

				const orderWrapper = JSON.parse(raw) as HughesNetOrderWrapper;

				// Check if this order belongs to this user and needs migration
				if (orderWrapper.ownerId === userName) {
					// Update ownerId from username to userId
					orderWrapper.ownerId = userId;
					await ordersKV.put(orderKey, JSON.stringify(orderWrapper));
					migrated++;
					log.info('[MIGRATION] Updated HughesNet order ownerId', {
						orderKey,
						userId
					});
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				log.error('[MIGRATION] Failed to migrate HughesNet order', {
					orderKey,
					error: errorMsg
				});
			}
		}

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
	}

	return migrated;
}
