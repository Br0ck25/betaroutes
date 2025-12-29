// src/lib/server/log.ts

const SENSITIVE_KEYS = new Set([
	'password',
	'token',
	'verificationToken',
	'stripeWebhookSecret',
	'stripeSignature',
	'stripeCustomerId',
	'apiKey',
	'privateKey',
	'authorization',
	'authorizationHeader',
	'secret',
	'email'
]);

function sanitizeValue(key: string, value: unknown): unknown {
	if (!key) return value;
	if (SENSITIVE_KEYS.has(key)) return '[REDACTED]';
	return value;
}

function sanitizeForLogs(obj: unknown): unknown {
	try {
		return JSON.parse(JSON.stringify(obj, (k, v) => sanitizeValue(k, v)));
	} catch {
		// Fallback: shallow redact by key presence
		if (typeof obj === 'object' && obj !== null) {
			const out: Record<string, unknown> = {};
			const rec = obj as Record<string, unknown>;
			for (const k of Object.keys(rec)) {
				out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : rec[k];
			}
			return out;
		}
		return obj;
	}
}

function logWithSanitizer(
	level: 'log' | 'info' | 'warn' | 'error',
	message: string,
	...meta: unknown[]
) {
	if (meta.length > 0) {
		try {
			let metaObj: unknown;
			if (meta.length === 1 && typeof meta[0] === 'object' && meta[0] !== null) {
				metaObj = meta[0];
			} else {
				metaObj = { args: meta };
			}
			const sanitized = sanitizeForLogs(metaObj);
			// Use console[level] to preserve callsite-level semantics
			// eslint-disable-next-line no-console
			console[level](`${message}`, sanitized);
		} catch (e) {
			// eslint-disable-next-line no-console
			console[level](`${message} [meta-redaction-failed]`, String(e));
		}
	} else {
		// eslint-disable-next-line no-console
		console[level](message);
	}
}

export const log = {
	info: (msg: string, ...meta: unknown[]) => logWithSanitizer('info', msg, ...meta),
	warn: (msg: string, ...meta: unknown[]) => logWithSanitizer('warn', msg, ...meta),
	error: (msg: string, ...meta: unknown[]) => logWithSanitizer('error', msg, ...meta),
	debug: (msg: string, ...meta: unknown[]) => logWithSanitizer('log', msg, ...meta)
};
