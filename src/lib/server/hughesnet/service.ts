// src/lib/server/hughesnet/service.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { makeTripService } from '../tripService';
import { makeMileageService } from '../mileageService';
import { HughesNetFetcher } from './fetcher';
import { HughesNetAuth } from './auth';
import { HughesNetRouter } from './router';
import * as parser from './parser';
import type { OrderData, SyncResult, DistributedLock, ConflictInfo, SyncConfig } from './types';
import { log } from '$lib/server/log';

import {
	DISCOVERY_GAP_MAX_SIZE,
	DISCOVERY_MAX_FAILURES,
	DISCOVERY_MAX_CHECKS,
	DELAY_BETWEEN_SCANS_MS,
	DELAY_BETWEEN_GAP_FILLS_MS,
	DELAY_BETWEEN_BACKWARD_SCANS_MS,
	DELAY_BETWEEN_DOWNLOADS_MS,
	LOCK_TTL_MS,
	LOCK_RETRY_DELAY_MS,
	LOCK_MAX_RETRIES,
	MAX_ROLLBACK_SIZE_BYTES
} from './constants';

import {
	parseDateOnly,
	toIsoDate,
	extractDateFromTs,
	formatTimestamp,
	validateSyncConfig,
	isValidAddress,
	determineOrderSyncStatus,
	checkIncompleteToComplete
} from './utils';

import { createTripForDate } from './tripBuilder';

export class HughesNetService {
	public logs: string[] = [];
	private fetcher: HughesNetFetcher;
	private auth: HughesNetAuth;
	private router: HughesNetRouter;
	private lastSessionRefresh: number = 0;
	private sessionRefreshInterval: number = 10 * 60 * 1000;
	private requestsSinceRefresh: number = 0;
	private requestsBeforeRefresh: number = 20;

	constructor(
		private kv: KVNamespace,
		encryptionKey: string,
		private _logsKV: KVNamespace,
		private trashKV: KVNamespace | undefined,
		private settingsKV: KVNamespace,
		googleApiKey: string | undefined,
		directionsKV: KVNamespace | undefined,
		private ordersKV: KVNamespace,
		private tripKV: KVNamespace,
		private tripIndexDO: DurableObjectNamespace,
		private mileageKV?: KVNamespace
	) {
		this.fetcher = new HughesNetFetcher();
		this.auth = new HughesNetAuth(kv, encryptionKey, this.fetcher);
		this.router = new HughesNetRouter(directionsKV, googleApiKey, this.fetcher);
		// Read unused binding to satisfy lint in dev (placeholder for future logs integration)
		void this._logsKV;
	}

	// [!code fix] SECURITY: Limit log array size to prevent OOM during long syncs
	private static readonly MAX_LOGS = 1000;

	private pushLog(msg: string) {
		if (this.logs.length >= HughesNetService.MAX_LOGS) {
			// Remove oldest entries to make room
			this.logs.splice(0, 100);
			this.logs.push('... [older logs trimmed] ...');
		}
		this.logs.push(msg);
	}

	private log(msg: string) {
		log.debug(msg);
		this.pushLog(msg);
	}
	private warn(msg: string) {
		log.warn(msg);
		this.pushLog(`⚠️ ${msg}`);
	}
	private error(msg: string, e?: unknown) {
		log.error(msg, e as Error | undefined);
		this.pushLog(`❌ ${msg}`);
	}

	// --- Locking Logic ---
	private async acquireLock(lockKey: string, ownerId: string): Promise<boolean> {
		const expiresAt = Date.now() + LOCK_TTL_MS;
		const lock: DistributedLock = { lockId: lockKey, ownerId, expiresAt };
		try {
			await this.kv.put(lockKey, JSON.stringify(lock), {
				expirationTtl: Math.ceil(LOCK_TTL_MS / 1000)
			});
			const stored = await this.kv.get(lockKey);
			if (!stored) return false;
			const storedLock = JSON.parse(stored) as DistributedLock;
			return storedLock.ownerId === ownerId;
		} catch (e) {
			log.error('Failed to acquire lock:', e);
			return false;
		}
	}

	private async releaseLock(lockKey: string, ownerId: string): Promise<void> {
		try {
			const stored = await this.kv.get(lockKey);
			if (!stored) return;
			const lock = JSON.parse(stored) as DistributedLock;
			if (lock.ownerId === ownerId) await this.kv.delete(lockKey);
		} catch (e) {
			log.error('Failed to release lock:', e);
		}
	}

	private async waitForLock(lockKey: string, ownerId: string): Promise<boolean> {
		for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
			const acquired = await this.acquireLock(lockKey, ownerId);
			if (acquired) return true;
			try {
				const stored = await this.kv.get(lockKey);
				if (stored) {
					const lock = JSON.parse(stored) as DistributedLock;
					if (lock.expiresAt < Date.now()) {
						await this.kv.delete(lockKey);
						continue;
					}
				}
			} catch (e) {
				log.warn('Failed to check lock expiry:', e);
			}
			this.log(`[Lock] Waiting for lock... (attempt ${i + 1}/${LOCK_MAX_RETRIES})`);
			await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
		}
		return false;
	}

	// --- Session Management ---
	private async refreshSessionIfNeeded(userId: string): Promise<string | null> {
		this.log('[Session] Verifying session...');
		const cookie = await this.auth.ensureSessionCookie(userId);
		if (!cookie) throw new Error('Session expired. Please reconnect.');
		try {
			const testUrl = `${parser.BASE_URL}/start/Home.jsp`;
			const res = await this.fetcher.safeFetch(testUrl, { headers: { Cookie: cookie ?? '' } });
			const html = await res.text();
			if (html.includes('name="Password"') || html.includes('login.jsp')) {
				this.error('[Session] Session expired during sync');
				throw new Error('Session expired. Please reconnect.');
			}
			this.log('[Session] Session valid');
			this.lastSessionRefresh = Date.now();
			this.requestsSinceRefresh = 0;
			return cookie;
		} catch (e: unknown) {
			const emsg =
				typeof e === 'object' && e !== null && 'message' in e
					? String((e as { message: unknown }).message)
					: String(e);
			if (emsg === 'REQ_LIMIT') throw e as Error;
			if (emsg.includes('Session expired')) throw e as Error;
			this.error('[Session] Failed to verify session', e);
			throw new Error('Session validation failed. Please reconnect.');
		}
	}

	private shouldRefreshSession(): boolean {
		const timeSinceRefresh = Date.now() - this.lastSessionRefresh;
		const timeExpired = timeSinceRefresh > this.sessionRefreshInterval;
		const requestsExpired = this.requestsSinceRefresh >= this.requestsBeforeRefresh;
		return timeExpired || requestsExpired;
	}

	private async maybeRefreshSession(
		userId: string,
		currentCookie: string | null
	): Promise<string | null> {
		if (this.shouldRefreshSession()) {
			this.log(
				`[Session] Proactive refresh (${Math.round((Date.now() - this.lastSessionRefresh) / 1000)}s elapsed, ${this.requestsSinceRefresh} requests)`
			);
			try {
				const newCookie = await this.refreshSessionIfNeeded(userId);
				return newCookie || currentCookie;
			} catch (e) {
				void e;
				this.warn('[Session] Refresh failed, continuing with current cookie');
				return currentCookie;
			}
		}
		this.requestsSinceRefresh++;
		return currentCookie;
	}

	// --- Public API ---
	async connect(userId: string, u: string, p: string) {
		this.log(`[HNS] Connecting user ${userId}...`);
		return this.auth.connect(userId, u, p);
	}

	async disconnect(userId: string) {
		return this.auth.disconnect(userId);
	}

	async getOrders(userId: string) {
		const dbRaw = await this.kv.get(`hns:db:${userId}`);
		return dbRaw ? JSON.parse(dbRaw) : {};
	}

	async clearAllTrips(userId: string) {
		const tripService = makeTripService(
			this.tripKV,
			this.trashKV,
			undefined,
			this.tripIndexDO,
			this.tripIndexDO
		);
		const allTrips = await tripService.list(userId);
		let count = 0;
		for (const trip of allTrips) {
			const notes = (trip as Record<string, unknown>)['notes'];
			if (trip.id.startsWith('hns_') || (typeof notes === 'string' && notes.includes('HNS'))) {
				await tripService.delete(userId, trip.id);
				count++;
			}
		}
		await this.kv.delete(`hns:db:${userId}`);
		return count;
	}

	async getSettings(userId: string) {
		try {
			const raw = await this.kv.get(`hns:settings:${userId}`);
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			this.error('Failed to retrieve settings', e);
			return null;
		}
	}

	async saveSettings(userId: string, settings: SyncConfig) {
		try {
			validateSyncConfig({
				installPay: settings.installPay,
				repairPay: settings.repairPay,
				upgradePay: settings.upgradePay,
				poleCost: settings.poleCost,
				concreteCost: settings.concreteCost,
				poleCharge: settings.poleCharge,
				wifiExtenderPay: settings.wifiExtenderPay,
				voipPay: settings.voipPay,
				driveTimeBonus: settings.driveTimeBonus
			});
			if ((settings.installTime ?? 0) < 0 || (settings.repairTime ?? 0) < 0)
				throw new Error('Job times cannot be negative');
			await this.kv.put(`hns:settings:${userId}`, JSON.stringify(settings));
			return true;
		} catch (e) {
			this.error('Failed to save settings', e);
			throw e;
		}
	}

	async sync(
		userId: string,
		settingsId: string | undefined,
		installPay: number,
		repairPay: number,
		upgradePay: number,
		poleCost: number,
		concreteCost: number,
		poleCharge: number,
		wifiExtenderPay: number,
		voipPay: number,
		driveTimeBonus: number,
		skipScan: boolean,
		recentOnly: boolean = false,
		forceDates: string[] = []
	): Promise<SyncResult> {
		validateSyncConfig({
			installPay,
			repairPay,
			upgradePay,
			poleCost,
			concreteCost,
			poleCharge,
			wifiExtenderPay,
			voipPay,
			driveTimeBonus
		});
		const lockKey = `lock:sync:${userId}`;
		// [SECURITY FIX #53] Use cryptographically secure random instead of Math.random()
		const ownerId = `${userId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
		let lockAcquired = false;
		try {
			lockAcquired = await this.waitForLock(lockKey, ownerId);
			if (!lockAcquired)
				throw new Error('Could not acquire sync lock. Another sync may be in progress.');
			const result = await this.performSync(
				userId,
				settingsId,
				installPay,
				repairPay,
				upgradePay,
				poleCost,
				concreteCost,
				poleCharge,
				wifiExtenderPay,
				voipPay,
				driveTimeBonus,
				skipScan,
				recentOnly,
				forceDates
			);
			return result;
		} finally {
			if (lockAcquired) await this.releaseLock(lockKey, ownerId);
		}
	}

	private async performSync(
		userId: string,
		settingsId: string | undefined,
		installPay: number,
		repairPay: number,
		upgradePay: number,
		poleCost: number,
		concreteCost: number,
		poleCharge: number,
		wifiExtenderPay: number,
		voipPay: number,
		driveTimeBonus: number,
		skipScan: boolean,
		recentOnly: boolean,
		forceDates: string[]
	): Promise<SyncResult> {
		this.fetcher.resetCount();
		this.lastSessionRefresh = Date.now();
		this.requestsSinceRefresh = 0;
		this.log(
			`[Config] Install: $${installPay} | Repair: $${repairPay} | Upgrade: $${upgradePay} | WiFi: $${wifiExtenderPay} | Phone: $${voipPay} | Drive Bonus: $${driveTimeBonus}`
		);

		let cookie = await this.auth.ensureSessionCookie(userId);
		if (!cookie) throw new Error('Could not login. Please reconnect.');

		let orderDb: Record<string, OrderData> = {};
		const dbRaw = await this.kv.get(`hns:db:${userId}`);
		if (dbRaw) {
			try {
				orderDb = JSON.parse(dbRaw);
			} catch (e: unknown) {
				this.error('[Sync] Failed to parse existing order database, starting fresh', e);
				orderDb = {};
			}
		}

		let originalDbState: string | null = null;
		const dbString = JSON.stringify(orderDb);
		if (dbString.length < MAX_ROLLBACK_SIZE_BYTES) originalDbState = dbString;
		else
			this.warn(
				`[Sync] Order database too large (${(dbString.length / 1024 / 1024).toFixed(2)}MB), rollback disabled`
			);

		let dbDirty = false;
		let incomplete = false;
		const conflicts: ConflictInfo[] = [];

		// Restore missing order details from the persistent Orders KV when possible
		if (this.ordersKV) {
			for (const id of Object.keys(orderDb)) {
				const o = orderDb[id];
				if (o && !o.address) {
					try {
						const raw = await this.ordersKV.get(`hns:order:${id}`);
						if (raw) {
							const wrapper = JSON.parse(raw);
							if (wrapper && wrapper.ownerId === userId && wrapper.order) {
								orderDb[id] = { ...wrapper.order, lastSyncTimestamp: Date.now() };
								dbDirty = true;
								this.log(`[OrdersKV] Restored order ${id} from orders KV`);
							}
						}
					} catch (e: unknown) {
						const emsg =
							typeof e === 'object' && e !== null && 'message' in e
								? String((e as { message: unknown }).message)
								: String(e);
						this.warn(`[OrdersKV] Failed to read order ${id}: ${emsg}`);
					}
				}
			}
			if (dbDirty) {
				await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
				dbDirty = false;
			}
		}

		try {
			// STAGE 1: SCANNING
			if (!skipScan) {
				this.log('[Scan] Starting scan phase...');
				try {
					const res = await this.fetcher.safeFetch(parser.BASE_URL + '/start/Home.jsp', {
						headers: { Cookie: cookie ?? '' }
					});
					const html = await res.text();
					if (html.includes('name="Password"')) throw new Error('Session expired.');
					parser.extractIds(html).forEach((id) => {
						if (!orderDb[id]) {
							orderDb[id] = {
								id,
								address: '',
								city: '',
								state: '',
								zip: '',
								confirmScheduleDate: '',
								beginTime: '',
								type: '',
								jobDuration: 0,
								_status: 'pending'
							};
							dbDirty = true;
						}
					});

					if (this.fetcher.shouldBatch()) {
						this.log(
							`[Scan] Soft limit reached (${this.fetcher.getRequestCount()}/${this.fetcher.getSoftLimit()}), will batch`
						);
						if (dbDirty) await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
						return { orders: Object.values(orderDb), incomplete: true };
					}

					const links = parser
						.extractMenuLinks(html)
						.filter((l) => l.url.includes('SoSearch') || l.url.includes('forms/'));
					links.push({
						url: 'https://dwayinstalls.hns.com/CROF/SoSearch.jsp?action=submit',
						text: 'Manual Search'
					});
					this.log(`[Scan] Found ${links.length} menu links to scan...`);

					for (const link of links) {
						if (this.fetcher.shouldBatch()) {
							this.log(`[Scan] Soft limit reached, saving progress and batching`);
							break;
						}
						cookie = await this.maybeRefreshSession(userId, cookie);
						try {
							await this.scanUrl(link.url, cookie, (id) => {
								if (!orderDb[id]) {
									orderDb[id] = {
										id,
										address: '',
										city: '',
										state: '',
										zip: '',
										confirmScheduleDate: '',
										beginTime: '',
										type: '',
										jobDuration: 0,
										_status: 'pending'
									};
									dbDirty = true;
								}
							});
							await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SCANS_MS));
						} catch (e: unknown) {
							const emsg =
								typeof e === 'object' && e !== null && 'message' in e
									? String((e as { message: unknown }).message)
									: String(e);
							if (emsg === 'REQ_LIMIT') {
								this.warn('[Scan] Hard limit reached');
								break;
							}
							this.warn(`[Scan] Failed to scan ${link.url}: ${emsg}`);
						}
					}
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					if (msg === 'REQ_LIMIT') this.warn('[Scan] Hard limit reached during initial scan');
					else if (msg !== 'Session expired.') this.error('[Scan] Error', err);
					else throw err;
				}
				if (dbDirty) {
					await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
					dbDirty = false;
				}
				if (this.fetcher.shouldBatch()) {
					this.log(`[Scan] Completed with ${this.fetcher.getRequestCount()} requests, batching`);
					return { orders: Object.values(orderDb), incomplete: true };
				}
			}

			// STAGE 1.5: SMART DISCOVERY
			const knownIds = Object.keys(orderDb)
				.map((id) => parseInt(id))
				.filter((n) => !isNaN(n))
				.sort((a, b) => a - b);
			if (knownIds.length > 0 && !skipScan) {
				this.log('[Discovery] Starting discovery phase...');
				if (this.fetcher.shouldBatch()) {
					this.log(`[Discovery] Soft limit reached before discovery, batching`);
					return { orders: Object.values(orderDb), incomplete: true };
				}
				try {
					cookie = await this.refreshSessionIfNeeded(userId);
				} catch (err: unknown) {
					this.error('[Discovery] Session refresh failed', err);
					throw err;
				}

				const minId = knownIds[0]!;
				const tryFetchId = async (targetId: number) => {
					if (orderDb[String(targetId)]) return false;
					if (this.fetcher.shouldBatch()) return false;
					cookie = await this.maybeRefreshSession(userId, cookie);
					try {
						const orderUrl = `${parser.BASE_URL}/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${targetId}`;
						const res = await this.fetcher.safeFetch(orderUrl, {
							headers: { Cookie: cookie ?? '' }
						});
						const html = await res.text();
						const parsed = parser.parseOrderPage(html, String(targetId));
						if (parsed.address) {
							delete parsed._status;
							orderDb[String(targetId)] = parsed;
							dbDirty = true;
							try {
								if (this.ordersKV) {
									await this.ordersKV.put(
										`hns:order:${targetId}`,
										JSON.stringify({
											ownerId: userId,
											storedAt: Date.now(),
											order: parsed
										})
									);
									this.log(`[OrdersKV] Persisted order ${targetId} for ${userId}`);
								}
							} catch (err: unknown) {
								const msg = err instanceof Error ? err.message : String(err);
								this.warn(`[OrdersKV] Failed to persist order ${targetId}: ${msg}`);
							}
							return true;
						}
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err);
						if (msg === 'REQ_LIMIT') return false;
						log.warn(`Failed to fetch order ${targetId}:`, err);
					}
					return false;
				};

				try {
					this.log('[Discovery] Filling gaps...');
					for (let i = 0; i < knownIds.length - 1; i++) {
						if (this.fetcher.shouldBatch()) {
							this.log('[Discovery] Soft limit reached during gap filling');
							break;
						}
						const current = knownIds[i];
						const next = knownIds[i + 1];
						if (typeof current === 'undefined' || typeof next === 'undefined') continue;
						if (next - current > 1 && next - current < DISCOVERY_GAP_MAX_SIZE) {
							for (let j = current + 1; j < next; j++) {
								const found = await tryFetchId(j);
								if (!found && this.fetcher.shouldBatch()) break;
								await new Promise((r) => setTimeout(r, DELAY_BETWEEN_GAP_FILLS_MS));
							}
						}
					}
					if (!this.fetcher.shouldBatch() && !recentOnly) {
						this.log('[Discovery] Scanning backward...');
						let failures = 0,
							current = minId - 1,
							checks = 0;
						while (failures < DISCOVERY_MAX_FAILURES && checks < DISCOVERY_MAX_CHECKS) {
							if (this.fetcher.shouldBatch()) {
								this.log('[Discovery] Soft limit reached during backward scan');
								break;
							}
							const found = await tryFetchId(current);
							if (found) failures = 0;
							else failures++;
							current--;
							checks++;
							await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BACKWARD_SCANS_MS));
						}
					} else if (recentOnly) {
						this.log('[Discovery] Skipping backward scan (Quick Sync active)');
					}
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					if (msg === 'REQ_LIMIT') this.warn('[Discovery] Hard limit reached');
					else this.error('[Discovery] Unexpected error', err);
				}
				if (dbDirty) {
					await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
					dbDirty = false;
				}
				if (this.fetcher.shouldBatch()) {
					this.log(
						`[Discovery] Completed with ${this.fetcher.getRequestCount()} requests, batching`
					);
					return { orders: Object.values(orderDb), incomplete: true };
				}
			}

			// STAGE 2: DOWNLOADS
			let resyncCount = 0;
			for (const order of Object.values(orderDb)) {
				if (order._status === 'pending' || order._status === 'failed') continue;
				if (!order.address) continue;
				const { needsResync } = determineOrderSyncStatus(order);
				if (needsResync && !order.needsResync) {
					order.needsResync = true;
					dbDirty = true;
					resyncCount++;
				}
			}
			if (resyncCount > 0) {
				this.log(`[Resync] Flagged ${resyncCount} orders for resync`);
				if (dbDirty) {
					await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
					dbDirty = false;
				}
			}

			const missingDataIds = Object.values(orderDb)
				.filter((o: OrderData) => {
					if (o._status === 'failed') return false;
					if (o._status === 'pending' || !o.address) return true;
					if (o.needsResync) return true;
					return false;
				})
				.map((o: OrderData) => o.id);

			if (missingDataIds.length > 0) {
				this.log(`[Download] Starting download of ${missingDataIds.length} orders...`);
				if (this.fetcher.shouldBatch()) {
					this.log(`[Download] Soft limit reached before downloads, batching`);
					return { orders: Object.values(orderDb), incomplete: true };
				}
				try {
					cookie = await this.refreshSessionIfNeeded(userId);
				} catch (err: unknown) {
					this.error('[Download] Session refresh failed', err);
					throw err;
				}

				for (const id of missingDataIds) {
					if (this.fetcher.shouldBatch()) {
						this.log(
							`[Download] Soft limit reached, ${missingDataIds.length - missingDataIds.indexOf(id)} orders remaining`
						);
						incomplete = true;
						break;
					}
					cookie = await this.maybeRefreshSession(userId, cookie);
					try {
						const orderUrl = `${parser.BASE_URL}/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
						const res = await this.fetcher.safeFetch(orderUrl, {
							headers: { Cookie: cookie ?? '' }
						});
						const html = await res.text();
						if (html.includes('name="Password"') || html.includes('login.jsp')) {
							this.error('[Download] Session expired, attempting refresh...');
							cookie = await this.refreshSessionIfNeeded(userId);
							const retryRes = await this.fetcher.safeFetch(orderUrl, {
								headers: { Cookie: cookie ?? '' }
							});
							const retryHtml = await retryRes.text();
							if (retryHtml.includes('name="Password"'))
								throw new Error('Session expired. Please reconnect.');
							const parsed = parser.parseOrderPage(retryHtml, id);
							if (parsed.address && (parsed.confirmScheduleDate || parsed.arrivalTimestamp)) {
								const changed = await this.processOrderData(orderDb, id, parsed, userId);
								dbDirty = changed || dbDirty;
							}
						} else {
							const parsed = parser.parseOrderPage(html, id);
							if (parsed.address && (parsed.confirmScheduleDate || parsed.arrivalTimestamp)) {
								const changed = await this.processOrderData(orderDb, id, parsed, userId);
								dbDirty = changed || dbDirty;
							} else if (!parsed.address) {
								if (orderDb[id]) {
									orderDb[id]._status = 'failed';
								}
								dbDirty = true;
							}
						}
						await new Promise((r) => setTimeout(r, DELAY_BETWEEN_DOWNLOADS_MS));
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err);
						if (msg === 'REQ_LIMIT') {
							this.warn('[Download] Hard limit reached');
							incomplete = true;
							break;
						}
						if (msg.includes('Session expired')) throw err;
						log.warn(`Failed to download order ${id}:`, err);
					}
				}
				if (dbDirty) {
					await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
					dbDirty = false;
				}
			}
			if (incomplete) {
				this.log(`[Download] Batching with ${this.fetcher.getRequestCount()} requests used`);
				return { orders: Object.values(orderDb), incomplete: true };
			}

			// STAGE 3: CREATE TRIPS
			const ordersByDate = this.groupOrdersByDate(orderDb);
			let sortedDates = Object.keys(ordersByDate).sort();

			if (recentOnly) {
				const cutoffDate = new Date();
				cutoffDate.setDate(cutoffDate.getDate() - 7);
				cutoffDate.setHours(0, 0, 0, 0);
				const totalDates = sortedDates.length;
				sortedDates = sortedDates.filter((dateStr) => {
					if (forceDates.includes(dateStr)) return true;
					const d = parseDateOnly(dateStr);
					return d && d >= cutoffDate;
				});
				this.log(
					`[Trips] Quick Sync: Filtered from ${totalDates} dates to ${sortedDates.length} recent dates.`
				);
			}

			if (sortedDates.length > 0) {
				this.log(`[Trips] Building routes for ${sortedDates.length} dates...`);
				if (this.fetcher.shouldBatch()) {
					this.log(`[Trips] Soft limit reached before trip creation, batching`);
					return { orders: Object.values(orderDb), incomplete: true };
				}
				try {
					cookie = await this.refreshSessionIfNeeded(userId);
				} catch (err: unknown) {
					this.error('[Trips] Session refresh failed', err);
					throw err;
				}
			}

			const tripService = makeTripService(
				this.tripKV,
				this.trashKV,
				undefined,
				this.tripIndexDO,
				this.tripIndexDO
			);

			// Create mileage service if mileageKV is available (for HNS trips to work like manual trips)
			const mileageService = this.mileageKV
				? makeMileageService(this.mileageKV, this.tripIndexDO, this.tripKV)
				: undefined;

			for (const date of sortedDates) {
				if (this.fetcher.shouldBatch()) {
					this.log(
						`[Trips] Soft limit reached, ${sortedDates.length - sortedDates.indexOf(date)} trips remaining`
					);
					incomplete = true;
					break;
				}

				const tripId = `hns_${userId}_${date}`;
				const existingTrip = await tripService.get(userId, tripId);

				if (existingTrip) {
					// Conflict Detection: Check if user has manually edited this trip
					// HughesNet-created trips don't have lastModified set
					// Only user edits via the UI/API set lastModified
					if (existingTrip['lastModified']) {
						// Check if it's within the last 7 days
						const dateObj = parseDateOnly(date);
						if (dateObj) {
							const now = new Date();
							now.setHours(0, 0, 0, 0);
							const targetDate = new Date(dateObj);
							targetDate.setHours(0, 0, 0, 0);
							const diffDays = Math.floor(
								(now.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24)
							);

							if (diffDays <= 7) {
								if (forceDates.includes(date)) {
									this.log(`  ${date}: ✓ Force overwriting user modifications (User Approved)`);
								} else {
									this.log(
										`  ${date}: ⚠️ CONFLICT - User edited at ${new Date(existingTrip['lastModified']).toLocaleString()}`
									);

									// Calculate what HughesNet would sync
									const ordersForDate = ordersByDate[date] || [];
									let hnsEarnings = 0;
									const hnsStops = ordersForDate.length;

									for (const order of ordersForDate) {
										const isPaid =
											!!order.departureCompleteTimestamp || !order.departureIncompleteTimestamp;
										if (!isPaid) continue;

										let basePay = 0;
										if (order.hasPoleMount) {
											basePay = installPay + poleCharge;
										} else {
											if (order.type === 'Install' || order.type === 'Re-Install')
												basePay = installPay;
											else if (order.type === 'Upgrade') basePay = upgradePay;
											else basePay = repairPay;
										}
										if (order.hasWifiExtender) basePay += wifiExtenderPay;
										if (order.hasVoip) basePay += voipPay;
										hnsEarnings += basePay;
									}

									conflicts.push({
										date,
										address: existingTrip['startAddress'] || 'No address',
										earnings: existingTrip['totalEarnings'] || 0,
										stops: existingTrip['stops']?.length || 0,
										lastModified: existingTrip['lastModified'],
										hnsEarnings,
										hnsStops,
										hnsAddress:
											ordersForDate[0]?.address || existingTrip['startAddress'] || 'Unknown'
									});
									continue;
								}
							} else {
								this.log(`  ${date}: ⏭️ Skipped (user modified, older than 7 days)`);
								continue;
							}
						}
					}
				}

				const created = await createTripForDate(
					userId,
					date,
					ordersByDate[date] || [],
					settingsId,
					installPay,
					repairPay,
					upgradePay,
					poleCost,
					concreteCost,
					poleCharge,
					wifiExtenderPay,
					voipPay,
					driveTimeBonus,
					tripService,
					this.settingsKV,
					this.router,
					(msg) => this.log(msg),
					mileageService
				);

				if (!created) {
					this.log(`[Trips] Trip creation failed for ${date}, will retry in next batch`);
					incomplete = true;
					break;
				}
			}

			if (incomplete) {
				this.log(`[Trips] Batching with ${this.fetcher.getRequestCount()} requests used`);
			}

			return { orders: Object.values(orderDb), incomplete, conflicts };
		} catch (error) {
			if (originalDbState) {
				this.error('[Sync] Critical error occurred, attempting rollback', error);
				try {
					JSON.parse(originalDbState);
					await this.kv.put(`hns:db:${userId}`, originalDbState);
					this.log('[Sync] Rollback successful');
				} catch (rollbackError) {
					this.error('[Sync] Rollback failed - original state may be corrupt', rollbackError);
				}
			} else {
				this.error('[Sync] Critical error occurred, rollback not available', error);
			}
			throw error;
		}
	}

	private groupOrdersByDate(orderDb: Record<string, OrderData>): Record<string, OrderData[]> {
		const ordersByDate: Record<string, OrderData[]> = {};
		for (const order of Object.values(orderDb)) {
			if (!isValidAddress(order)) {
				this.warn(`[Trips] Skipping order ${order.id} - invalid address`);
				continue;
			}
			let isoDate = toIsoDate(order.confirmScheduleDate);
			if (!isoDate && order.arrivalTimestamp) isoDate = extractDateFromTs(order.arrivalTimestamp);
			if (isoDate) {
				const list = ordersByDate[isoDate] || [];
				list.push(order);
				ordersByDate[isoDate] = list;
			}
		}
		return ordersByDate;
	}

	private async processOrderData(
		orderDb: Record<string, OrderData>,
		id: string,
		parsed: OrderData,
		ownerId?: string
	): Promise<boolean> {
		const existingOrder = orderDb[id];
		const { syncStatus, needsResync } = determineOrderSyncStatus(parsed);
		const wasIncompleteNowComplete = checkIncompleteToComplete(existingOrder, parsed);
		const wasResync = existingOrder?.needsResync === true;
		const nowComplete = syncStatus === 'complete';

		delete parsed._status;
		const updatedOrder: OrderData = {
			...parsed,
			syncStatus,
			needsResync,
			lastSyncTimestamp: Date.now()
		};

		if (wasIncompleteNowComplete) {
			updatedOrder.lastPaymentUpdate = Date.now();
			this.log(`  ${id} [INCOMPLETE→COMPLETE] Payment update needed`);
		}
		if (wasResync && nowComplete) this.log(`  ${id} [RESYNC SUCCESS] Timestamps updated`);
		else if (wasResync && !nowComplete) this.log(`  ${id} [RESYNC] Still incomplete/future`);

		orderDb[id] = updatedOrder;
		try {
			if (this.ordersKV) {
				await this.ordersKV.put(
					`hns:order:${id}`,
					JSON.stringify({ ownerId: ownerId || null, storedAt: Date.now(), order: updatedOrder })
				);
				this.log(`[OrdersKV] Persisted order ${id} for ${ownerId || 'unknown'}`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.warn(`[OrdersKV] Failed to persist order ${id}: ${msg}`);
		}

		const ts = parsed.arrivalTimestamp ? `Arr:${formatTimestamp(parsed.arrivalTimestamp)}` : '';
		const pole = parsed.hasPoleMount ? '+POLE' : '';
		const wifi = parsed.hasWifiExtender ? '+WIFI' : '';
		const voip = parsed.hasVoip ? '+VOIP' : '';
		const status =
			syncStatus === 'future' ? '[FUTURE]' : syncStatus === 'incomplete' ? '[INCOMPLETE]' : '';
		this.log(`  ${id} ${ts} ${pole} ${wifi} ${voip} ${status}`.trim());
		return true;
	}

	private async scanUrl(url: string, cookie: string | null, cb: (id: string) => void) {
		let current = url;
		let page = 0;
		while (current && page < 5) {
			if (this.fetcher.shouldBatch()) break;
			try {
				const res = await this.fetcher.safeFetch(current, { headers: { Cookie: cookie ?? '' } });
				const html = await res.text();
				parser.extractIds(html).forEach(cb);
				current = parser.extractNextLink(html, current) || '';
				page++;
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg === 'REQ_LIMIT') break;
				log.warn('Failed to scan URL:', url, err);
				break;
			}
		}
	}
}
