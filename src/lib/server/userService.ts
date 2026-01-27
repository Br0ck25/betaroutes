// src/lib/server/userService.ts

import { randomUUID } from 'node:crypto';
import { log } from '$lib/server/log';

// 1. Define Split Types

// [!code ++] New Type for Passkeys/WebAuthn
export type Authenticator = {
	credentialID: string;
	credentialPublicKey: string; // Base64URL encoded
	counter: number;
	transports?: string[];
	name?: string; // Friendly display name
	createdAt?: string;
};

export type UserCore = {
	id: string;
	username: string;
	email: string;
	password: string;
	plan: 'free' | 'premium' | 'pro' | 'business';
	name: string;
	createdAt: string;
	stripeCustomerId?: string;
	authenticators?: Authenticator[]; // [!code ++] Added field
};

export type UserStats = {
	tripsThisMonth: number;
	maxTrips: number;
	resetDate: string;
};

export type User = UserCore & UserStats;

// --- KV Key Utility Functions ---

function userCoreKey(userId: string): string {
	return `user:${userId}`;
}

function userStatsKey(userId: string): string {
	return `user:stats:${userId}`;
}

function usernameKey(username: string): string {
	return `idx:username:${username.toLowerCase()}`;
}

function emailKey(email: string): string {
	return `idx:email:${email.toLowerCase()}`;
}

// [!code ++] New Index for WebAuthn Login
function credentialKey(credentialId: string): string {
	return `idx:credential:${credentialId}`;
}

// Helpers for safely reading KV records parsed as unknown
function getString(rec: Record<string, unknown>, key: string): string | undefined {
	const v = rec[key];
	return typeof v === 'string' ? v : undefined;
}

function getNumber(rec: Record<string, unknown>, key: string): number | undefined {
	const v = rec[key];
	return typeof v === 'number' ? v : undefined;
}

// --- Lookup Functions ---

export async function findUserById(kv: KVNamespace, userId: string): Promise<User | null> {
	const [coreRaw, statsRaw] = await Promise.all([
		kv.get(userCoreKey(userId)),
		kv.get(userStatsKey(userId))
	]);

	if (!coreRaw) return null;

	const core = JSON.parse(coreRaw) as UserCore;

	const stats: UserStats = statsRaw
		? JSON.parse(statsRaw)
		: {
				tripsThisMonth: 0,
				maxTrips: 10,
				resetDate: new Date().toISOString()
			};

	return {
		id: core.id,
		username: core.username,
		email: core.email,
		password: core.password,
		plan: core.plan,
		name: core.name,
		createdAt: core.createdAt,
		// Provide empty string when absent to satisfy strict optional typing in server types
		stripeCustomerId: core.stripeCustomerId ?? '',
		authenticators: core.authenticators || [], // [!code ++] Return empty array if undefined
		...stats
	};
}

export async function findUserByEmail(kv: KVNamespace, email: string): Promise<User | null> {
	const userId = await kv.get(emailKey(email));
	if (!userId) return null;
	return findUserById(kv, userId);
}

export async function findUserByUsername(kv: KVNamespace, username: string): Promise<User | null> {
	const userId = await kv.get(usernameKey(username));
	if (!userId) return null;
	return findUserById(kv, userId);
}

// [!code ++] New Lookup for Biometric Login
export async function findUserByCredentialId(
	kv: KVNamespace,
	credentialId: string
): Promise<User | null> {
	const userId = await kv.get(credentialKey(credentialId));
	if (!userId) return null;
	return findUserById(kv, userId);
}

// --- Write/Update/Delete Functions ---

export async function createUser(
	kv: KVNamespace,
	userData: Omit<User, 'id' | 'createdAt'>
): Promise<User> {
	const userId = randomUUID();
	const now = new Date().toISOString();

	const { tripsThisMonth, maxTrips, resetDate, ...coreData } = userData;

	const userCore: UserCore = {
		...coreData,
		id: userId,
		createdAt: now,
		authenticators: [] // [!code ++] Initialize empty
	};

	const userStats: UserStats = {
		tripsThisMonth: tripsThisMonth || 0,
		maxTrips: maxTrips || 10,
		resetDate: resetDate || now
	};

	await Promise.all([
		kv.put(userCoreKey(userId), JSON.stringify(userCore)),
		kv.put(userStatsKey(userId), JSON.stringify(userStats)),
		kv.put(usernameKey(userCore.username), userId),
		kv.put(emailKey(userCore.email), userId)
	]);

	return { ...userCore, ...userStats };
}

// [!code ++] New Function to Register a Passkey
export async function saveAuthenticator(
	kv: KVNamespace,
	userId: string,
	authenticator: Authenticator
) {
	const key = userCoreKey(userId);
	const raw = await kv.get(key);
	if (!raw) throw new Error('User not found');

	const core = JSON.parse(raw) as UserCore;
	const authenticators = core.authenticators || [];

	// Avoid duplicates or update existing
	const existingIndex = authenticators.findIndex(
		(a) => a.credentialID === authenticator.credentialID
	);
	if (existingIndex >= 0) {
		authenticators[existingIndex] = authenticator; // Update counter etc.
	} else {
		authenticators.push(authenticator);
	}

	core.authenticators = authenticators;

	await Promise.all([
		kv.put(key, JSON.stringify(core)),
		kv.put(credentialKey(authenticator.credentialID), userId) // Create Index
	]);
}

// FIXED: Handle index updates when email changes
export async function updateUser(
	kv: KVNamespace,
	userId: string,
	updates: Partial<Pick<UserCore, 'name' | 'email'>>
): Promise<void> {
	const key = userCoreKey(userId);
	const raw = await kv.get(key);
	if (!raw) throw new Error('User not found');

	const record = JSON.parse(raw) as UserCore;

	// Handle Email Change: Update Indexes
	if (updates.email && updates.email.toLowerCase() !== record.email.toLowerCase()) {
		const newEmail = updates.email.toLowerCase();
		const oldEmail = record.email.toLowerCase();

		// 1. Check if new email is taken
		const existingId = await kv.get(emailKey(newEmail));
		if (existingId) {
			throw new Error('Email already in use');
		}

		// 2. Create new index BEFORE deleting old one (safety)
		await kv.put(emailKey(newEmail), userId);

		// 3. Delete old index
		await kv.delete(emailKey(oldEmail));
	}

	// Merge updates into the core record
	const updatedCore = {
		...record,
		...updates
	};

	await kv.put(key, JSON.stringify(updatedCore));
}

// NEW: Upgrade User Plan (For Stripe Webhooks)
export async function updateUserPlan(
	kv: KVNamespace,
	userId: string,
	plan: 'free' | 'premium' | 'pro' | 'business',
	stripeCustomerId?: string
): Promise<void> {
	const coreKey = userCoreKey(userId);
	const statsKey = userStatsKey(userId);

	const [coreRaw, statsRaw] = await Promise.all([kv.get(coreKey), kv.get(statsKey)]);

	if (!coreRaw) throw new Error('User not found');

	// 1. Update Plan in Core
	const core = JSON.parse(coreRaw) as UserCore;
	core.plan = plan;

	if (stripeCustomerId) {
		core.stripeCustomerId = stripeCustomerId;
	}

	await kv.put(coreKey, JSON.stringify(core));

	// 2. Update Limits in Stats (Unlimited for Pro)
	if (statsRaw) {
		const stats = JSON.parse(statsRaw) as UserStats;
		if (plan === 'pro' || plan === 'business') {
			stats.maxTrips = 999999; // Effectively unlimited
		}
		await kv.put(statsKey, JSON.stringify(stats));
	}
}

export async function updatePasswordHash(kv: KVNamespace, user: User, newHash: string) {
	const key = userCoreKey(user.id);
	const statsKey = userStatsKey(user.id);

	const raw = await kv.get(key);
	if (!raw) throw new Error('User not found during password update');

	const record = JSON.parse(raw) as Record<string, unknown>;

	// Migration Check — safely read from the raw record
	if (
		record['tripsThisMonth'] !== undefined ||
		record['maxTrips'] !== undefined ||
		record['resetDate'] !== undefined
	) {
		log.debug('[MIGRATION] Moving stats to separate key for user', user.id);
		const stats: UserStats = {
			tripsThisMonth: getNumber(record, 'tripsThisMonth') ?? 0,
			maxTrips: getNumber(record, 'maxTrips') ?? 10,
			resetDate: getString(record, 'resetDate') ?? new Date().toISOString()
		};
		await kv.put(statsKey, JSON.stringify(stats));
	}

	// Build typed core record with safe reads
	const id = getString(record, 'id') ?? user.id;
	const username = getString(record, 'username') ?? '';
	const email = getString(record, 'email') ?? '';
	const name = getString(record, 'name') ?? '';
	const createdAt = getString(record, 'createdAt') ?? new Date().toISOString();
	const plan = (getString(record, 'plan') as UserCore['plan']) ?? 'free';
	const stripeCustomerId = getString(record, 'stripeCustomerId');
	const authenticators = record['authenticators'] as unknown as Authenticator[] | undefined;

	const core: UserCore = {
		id,
		username,
		email,
		password: newHash,
		plan,
		name,
		createdAt,
		stripeCustomerId,
		authenticators: authenticators || [] // Preserve authenticators
	};

	await kv.put(key, JSON.stringify(core));
}

/**
 * Completely delete a user and ALL associated data (Trips, Expenses, Mileage, Settings, Indexes, Trash)
 */
export async function deleteUser(
	kv: KVNamespace,
	userId: string,
	resources?: {
		tripsKV?: KVNamespace;
		expensesKV?: KVNamespace;
		mileageKV?: KVNamespace;
		trashKV?: KVNamespace;
		settingsKV?: KVNamespace;
		tripIndexDO?: DurableObjectNamespace;
		env?: { DO_INTERNAL_SECRET?: string };
	}
): Promise<void> {
	const user = await findUserById(kv, userId);
	if (!user) return;

	log.debug(`[UserService] 🗑️ START Account Wipe: ${userId}`);

	// 1. Delete Core User Data (Auth)
	// The following deletes remove legacy username/email indexes. These are
	// cleanup operations only and DO NOT change ownership logic which relies
	// exclusively on userId.
	const authPromises = [
		kv.delete(`user:${userId}`),
		kv.delete(`user:stats:${userId}`),

		kv.delete(`idx:username:${user.username.toLowerCase()}`),
		// eslint-disable-next-line no-restricted-syntax -- Legacy index cleanup (safe)
		kv.delete(`idx:email:${user.email.toLowerCase()}`)
	];

	// [!code ++] Delete Credential Indexes (WebAuthn)
	if (user.authenticators) {
		for (const auth of user.authenticators) {
			authPromises.push(kv.delete(credentialKey(auth.credentialID)));
		}
	}

	// 2. Delete Settings
	if (resources?.settingsKV) {
		authPromises.push(resources.settingsKV.delete(`settings:${userId}`));
	}

	// 3. WIPE SQLITE DATA in Durable Object
	if (resources?.tripIndexDO) {
		try {
			// Identify the specific DO instance for this user
			const id = resources.tripIndexDO.idFromName(userId);
			const stub = resources.tripIndexDO.get(id);

			// Call the new WIPE endpoint with internal secret
			const doSecret = resources.env?.DO_INTERNAL_SECRET ?? '';
			await stub.fetch('http://internal/admin/wipe-user', {
				method: 'POST',
				headers: { 'x-do-internal-secret': doSecret }
			});
			log.debug(`[UserService] Sent WIPE command to DO for ${userId}`);
		} catch (e) {
			log.error('[UserService] Failed to wipe DO data:', e);
		}
	}

	// 4. Delete Trips (Iterate and Destroy)
	type KVListResult = { keys: Array<{ name: string }>; list_complete?: boolean; cursor?: string };
	const wipeNamespace = async (ns: KVNamespace, prefix: string) => {
		let cursor: string | undefined = undefined;
		do {
			const list: KVListResult = (await ns.list({
				prefix,
				cursor,
				limit: 1000
			})) as unknown as KVListResult;
			if (list.keys.length > 0) {
				await Promise.all(list.keys.map((k) => ns.delete(k.name)));
			}
			cursor = list.list_complete ? undefined : list.cursor;
		} while (cursor);
	};

	const cleanupTasks: Promise<void>[] = [];

	if (resources?.tripsKV) {
		cleanupTasks.push(wipeNamespace(resources.tripsKV, `trip:${user.username}:`));
		cleanupTasks.push(wipeNamespace(resources.tripsKV, `trip:${userId}:`));
	}

	// [SECURITY] Delete all expenses for this user
	if (resources?.expensesKV) {
		cleanupTasks.push(wipeNamespace(resources.expensesKV, `expense:${user.username}:`));
		cleanupTasks.push(wipeNamespace(resources.expensesKV, `expense:${userId}:`));
		log.debug(`[UserService] Queued expense cleanup for ${userId}`);
	}

	// [SECURITY] Delete all mileage logs for this user
	if (resources?.mileageKV) {
		cleanupTasks.push(wipeNamespace(resources.mileageKV, `mileage:${user.username}:`));
		cleanupTasks.push(wipeNamespace(resources.mileageKV, `mileage:${userId}:`));
		log.debug(`[UserService] Queued mileage cleanup for ${userId}`);
	}

	// [SECURITY] Delete all trash for this user
	if (resources?.trashKV) {
		cleanupTasks.push(wipeNamespace(resources.trashKV, `trash:${user.username}:`));
		cleanupTasks.push(wipeNamespace(resources.trashKV, `trash:${userId}:`));
		log.debug(`[UserService] Queued trash cleanup for ${userId}`);
	}

	await Promise.all(authPromises);
	await Promise.all(cleanupTasks);

	log.debug(`[UserService] ✅ FINISHED Account Wipe for ${userId}`);
}
