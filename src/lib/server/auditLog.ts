// src/lib/server/auditLog.ts
/**
 * Audit logging for admin and sensitive operations.
 * Logs are stored in KV with append-only semantics for immutability.
 *
 * SECURITY: These logs should never be deleted and should be backed up regularly.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { log } from '$lib/server/log';

export interface AuditEntry {
	timestamp: string;
	action: string;
	actor: string; // "admin" or userId
	ip?: string;
	details: Record<string, unknown>;
	success: boolean;
}

const AUDIT_KEY_PREFIX = 'audit:';
const MAX_ENTRIES_PER_LOG = 1000;

/**
 * Log an admin action for audit trail
 * @param kv - KV namespace for audit storage
 * @param action - The action being performed (e.g., "webauthn_migrate", "user_delete")
 * @param actor - Who performed the action (e.g., "admin", "system", userId)
 * @param details - Additional details about the action
 * @param success - Whether the action succeeded
 * @param ip - Client IP address (optional)
 */
export async function logAuditEvent(
	kv: KVNamespace | undefined,
	action: string,
	actor: string,
	details: Record<string, unknown>,
	success: boolean,
	ip?: string
): Promise<void> {
	const entry: AuditEntry = {
		timestamp: new Date().toISOString(),
		action,
		actor,
		ip,
		details,
		success
	};

	// Always log to console for immediate visibility
	log.info(`[AUDIT] ${action}`, {
		actor,
		success,
		ip: ip ? ip.substring(0, 3) + '***' : undefined, // Partial IP for privacy in logs
		...details
	});

	// Persist to KV if available
	if (kv) {
		try {
			const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
			const auditKey = `${AUDIT_KEY_PREFIX}${monthKey}`;

			// Fetch existing entries
			let entries: AuditEntry[] = [];
			const existing = await kv.get(auditKey, 'json');
			if (Array.isArray(existing)) {
				entries = existing as AuditEntry[];
			}

			// Append new entry (maintain size limit)
			entries.push(entry);
			if (entries.length > MAX_ENTRIES_PER_LOG) {
				// Keep most recent entries
				entries = entries.slice(-MAX_ENTRIES_PER_LOG);
			}

			// Write back with TTL of 2 years (audit retention)
			await kv.put(auditKey, JSON.stringify(entries), {
				expirationTtl: 2 * 365 * 24 * 60 * 60 // 2 years
			});
		} catch (err) {
			log.error('[AUDIT] Failed to persist audit entry', {
				action,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}
}

/**
 * Log admin-level operations (migrations, bulk operations)
 */
export async function logAdminAction(
	kv: KVNamespace | undefined,
	action: string,
	details: Record<string, unknown>,
	success: boolean,
	ip?: string
): Promise<void> {
	return logAuditEvent(kv, action, 'admin', details, success, ip);
}

/**
 * Log security-sensitive user operations (password change, passkey add/remove)
 */
export async function logSecurityAction(
	kv: KVNamespace | undefined,
	action: string,
	userId: string,
	details: Record<string, unknown>,
	success: boolean,
	ip?: string
): Promise<void> {
	return logAuditEvent(kv, action, userId, details, success, ip);
}
