// src/lib/server/hughesnet/tripBuilder.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import type { OrderData, OrderWithMeta, Trip, TripStop, SupplyItem } from './types';
import type { MileageRecord } from '$lib/server/mileageService';
import { extractDateFromTs, parseDateOnly, parseTime, buildAddress, minutesToTime } from './utils';
import { MIN_JOB_DURATION_MINS, MAX_JOB_DURATION_MINS } from './constants';
import { log } from '$lib/server/log';

// Minimal Route leg shape used by the router helper
type RouteLeg = { duration?: number; distance?: number };

export async function createTripForDate(
	userId: string,
	date: string,
	orders: OrderData[],
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
	tripService: { put: (t: Trip) => Promise<void> },
	settingsKV: KVNamespace,
	router: {
		getRouteInfo: (origin: string, destination: string) => Promise<RouteLeg | null>;
		resolveAddress?: (
			raw: string
		) => Promise<{ lat?: number; lon?: number; formattedAddress?: string } | null>;
	},
	logger: (msg: string) => void,
	mileageService?: { put: (m: MileageRecord) => Promise<void> }
): Promise<boolean> {
	let defaultStart = '',
		defaultEnd = '',
		mpg = 25,
		gas = 3.5;

	try {
		const key = `settings:${settingsId || userId}`;
		const sRaw = await settingsKV.get(key);
		if (sRaw) {
			const d = JSON.parse(sRaw);
			const s = d.settings || d;
			defaultStart = s.defaultStartAddress || '';
			defaultEnd = s.defaultEndAddress || '';
			if (s.defaultMPG != null && s.defaultMPG !== '') mpg = parseFloat(String(s.defaultMPG));
			if (s.defaultGasPrice != null && s.defaultGasPrice !== '')
				gas = parseFloat(String(s.defaultGasPrice));
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.warn('Failed to load settings:', { message: msg });
	}

	const ordersWithMeta: OrderWithMeta[] = orders.map((o: OrderData): OrderWithMeta => {
		let effectiveArrival = o.arrivalTimestamp;
		let effectiveDepartureComplete = o.departureCompleteTimestamp;
		let effectiveDepartureIncomplete = o.departureIncompleteTimestamp;

		if (effectiveDepartureIncomplete) {
			const incompleteDate = extractDateFromTs(effectiveDepartureIncomplete);
			if (incompleteDate && incompleteDate !== date) {
				effectiveArrival = undefined;
				effectiveDepartureComplete = undefined;
				effectiveDepartureIncomplete = undefined;
			}
		}

		const calcOrder = {
			...o,
			arrivalTimestamp: effectiveArrival,
			departureCompleteTimestamp: effectiveDepartureComplete,
			departureIncompleteTimestamp: effectiveDepartureIncomplete
		};
		let sortTime = calcOrder.arrivalTimestamp || 0;
		if (!sortTime) {
			const dateObj = parseDateOnly(o.confirmScheduleDate) || parseDateOnly(date);
			if (dateObj) sortTime = dateObj.getTime() + parseTime(o.beginTime) * 60000;
		}

		const isPaid =
			!!calcOrder.departureCompleteTimestamp || !calcOrder.departureIncompleteTimestamp;
		let actualDuration: number;
		const endTs = calcOrder.departureIncompleteTimestamp || calcOrder.departureCompleteTimestamp;

		if (calcOrder.arrivalTimestamp && endTs) {
			const dur = Math.round((endTs - calcOrder.arrivalTimestamp) / 60000);
			if (dur > MIN_JOB_DURATION_MINS && dur < MAX_JOB_DURATION_MINS) actualDuration = dur;
			else actualDuration = o.type === 'Install' || o.type === 'Re-Install' ? 90 : 60;
		} else {
			actualDuration = o.type === 'Install' || o.type === 'Re-Install' ? 90 : 60;
		}
		return { ...o, _sortTime: sortTime, _isPaid: isPaid, _actualDuration: actualDuration };
	});

	ordersWithMeta.sort((a, b) => a._sortTime - b._sortTime);

	const hasPaymentUpdates = ordersWithMeta.some(
		(o) => o.lastPaymentUpdate && Date.now() - o.lastPaymentUpdate < 60000
	);
	if (hasPaymentUpdates) logger(`[Trip ${date}] Payment updates detected - recalculating earnings`);

	const anchorOrder = ordersWithMeta.find((o) => o._sortTime > 0) || ordersWithMeta[0];

	let startAddr = defaultStart?.trim() || '';
	let endAddr = defaultEnd?.trim() || '';
	if (startAddr && !endAddr) endAddr = startAddr;
	if (!startAddr && anchorOrder) {
		startAddr = buildAddress(anchorOrder);
		if (!startAddr) {
			log.warn(`[Trip ${date}] Cannot build valid start address`);
			return false;
		}
		if (!endAddr) endAddr = startAddr;
	}

	// Prefer autocompleted / geocoded formatted addresses when available
	const resolvedCache = new Map<string, string>();
	async function resolveIfPossible(raw: string) {
		if (!raw || !(router as any)?.resolveAddress) return raw;
		const key = raw.trim();
		if (resolvedCache.has(key)) return resolvedCache.get(key)!;
		try {
			const pt = await (router as any).resolveAddress(key);
			if (pt && (pt as any).formattedAddress) {
				resolvedCache.set(key, (pt as any).formattedAddress);
				return (pt as any).formattedAddress;
			}
			resolvedCache.set(key, key);
			return key;
		} catch (err: unknown) {
			const emsg = err instanceof Error ? err.message : String(err);
			if (emsg === 'REQ_LIMIT') throw err;
			logger(`[Trip ${date}] Failed to resolve address "${key}": ${emsg}`);
			resolvedCache.set(key, key);
			return key;
		}
	}

	try {
		if (startAddr) startAddr = await resolveIfPossible(startAddr);
		if (endAddr) endAddr = await resolveIfPossible(endAddr);
	} catch (err: unknown) {
		const emsg = err instanceof Error ? err.message : String(err);
		if (emsg === 'REQ_LIMIT') {
			// Propagate batching signal to caller
			log.warn(`[Trip ${date}] Hard limit reached during address resolution`);
			return false;
		}
		logger(`[Trip ${date}] Address resolution failed: ${emsg}`);
	}

	let startMins = 9 * 60;
	let commuteMins = 0;

	if (anchorOrder) {
		const eAddr = buildAddress(anchorOrder);
		if (!eAddr) {
			log.warn(`[Trip ${date}] Cannot build valid address for anchor order`);
			return false;
		}
		if (startAddr && eAddr !== startAddr) {
			try {
				const leg = await router.getRouteInfo(startAddr, eAddr as string);
				if (leg && leg.duration && isFinite(leg.duration))
					commuteMins = Math.round(leg.duration / 60);
			} catch (err: unknown) {
				const emsg =
					typeof err === 'object' && err !== null && 'message' in err
						? String((err as { message: unknown }).message)
						: String(err);
				if (emsg === 'REQ_LIMIT') {
					log.warn(`[Trip ${date}] Hard limit reached during commute calculation`);
					return false;
				}
				log.warn('Failed to get route info:', err);
			}
		}
		if (isNaN(commuteMins) || !isFinite(commuteMins) || commuteMins < 0) commuteMins = 0;

		// [!code changed] Only use arrival timestamp if it matches the trip date
		let useArrivalTimestamp = false;
		if (anchorOrder.arrivalTimestamp) {
			const arrDate = extractDateFromTs(anchorOrder.arrivalTimestamp);
			// Assuming 'date' format matches 'MM/DD/YYYY' or similar returned by extractDateFromTs
			// We do a loose check or exact check depending on format.
			// Since 'date' is passed from sync logic (which usually uses the same util), this comparison should work.
			if (arrDate === date) {
				useArrivalTimestamp = true;
			}
		}

		if (useArrivalTimestamp && anchorOrder.arrivalTimestamp) {
			const d = new Date(anchorOrder.arrivalTimestamp);
			const arrivalMins = d.getHours() * 60 + d.getMinutes();
			if (!isNaN(arrivalMins) && isFinite(arrivalMins)) {
				const calculatedStart = arrivalMins - commuteMins;
				if (!isNaN(calculatedStart) && isFinite(calculatedStart)) startMins = calculatedStart;
			}
		} else {
			// [!code changed] Fallback to scheduled time if arrival is missing OR on a different date
			const schedMins = parseTime(anchorOrder.beginTime);
			if (schedMins > 0 && isFinite(schedMins)) {
				const calculatedStart = schedMins - commuteMins;
				if (!isNaN(calculatedStart) && isFinite(calculatedStart)) startMins = calculatedStart;
			}
		}
	}
	if (isNaN(startMins) || !isFinite(startMins) || startMins < 0 || startMins > 1440)
		startMins = 9 * 60;

	const points: string[] = [startAddr];
	const orderResolvedAddrs: Record<string, string> = {};

	// Resolve order addresses (prefer geocoded / autocomplete formatted address)
	for (const o of ordersWithMeta) {
		const rawAddr = buildAddress(o);
		let resolvedAddr = rawAddr;
		if (rawAddr && (router as any)?.resolveAddress) {
			try {
				resolvedAddr = await resolveIfPossible(rawAddr);
			} catch (err: unknown) {
				const emsg = err instanceof Error ? err.message : String(err);
				if (emsg === 'REQ_LIMIT') {
					log.warn(`[Trip ${date}] Hard limit reached during address resolution`);
					return false;
				}
				// fallback to raw address on other errors
				resolvedAddr = rawAddr;
			}
		}
		if (resolvedAddr) points.push(resolvedAddr);
		orderResolvedAddrs[o.id] = resolvedAddr || rawAddr;
	}
	if (endAddr && endAddr.trim()) points.push(endAddr);

	let totalMins = 0,
		totalMeters = 0;
	for (let i = 0; i < points.length - 1; i++) {
		if (points[i] !== points[i + 1]) {
			try {
				const cur = points[i] as string;
				const next = points[i + 1] as string;
				const leg = await router.getRouteInfo(cur, next);
				if (leg && leg.duration && isFinite(leg.duration)) {
					const mins = Math.round(leg.duration / 60);
					if (isFinite(mins) && mins >= 0) totalMins += mins;
				}
				if (leg && leg.distance && isFinite(leg.distance)) {
					const meters = leg.distance;
					if (isFinite(meters) && meters >= 0) totalMeters += meters;
				}
			} catch (err: unknown) {
				const emsg =
					typeof err === 'object' && err !== null && 'message' in err
						? String((err as { message: unknown }).message)
						: String(err);
				if (emsg === 'REQ_LIMIT') {
					log.warn(`[Trip ${date}] Hard limit reached during route calculation`);
					return false;
				}
				log.warn('Failed to get route leg:', err);
			}
		}
	}
	if (isNaN(totalMins) || !isFinite(totalMins) || totalMins < 0) totalMins = 0;

	const miles = Number((totalMeters * 0.000621371).toFixed(1));
	const jobMins = ordersWithMeta.reduce((sum, o) => {
		const dur = o._actualDuration || o.jobDuration || 60;
		if (isFinite(dur) && dur > 0) return sum + dur;
		return sum;
	}, 0);

	if (isNaN(jobMins) || !isFinite(jobMins) || jobMins < 0) {
		log.warn(`[Trip ${date}] Invalid jobMins: ${jobMins}`);
		return false;
	}
	const totalWorkMins = totalMins + jobMins;
	if (isNaN(totalWorkMins) || !isFinite(totalWorkMins) || totalWorkMins < 0) {
		log.warn(`[Trip ${date}] Invalid totalWorkMins calculated: ${totalWorkMins}`);
		return false;
	}

	const hoursWorked = Number((totalWorkMins / 60).toFixed(2));
	const fuelCost = mpg > 0 ? (miles / mpg) * gas : 0;
	let totalEarnings = 0;
	let totalSuppliesCost = 0;
	const suppliesMap = new Map<string, number>();
	const applyDriveBonus = totalMins > 330;

	const stops: TripStop[] = ordersWithMeta.map((o: OrderWithMeta, i: number): TripStop => {
		let basePay = 0;
		let notes = `HNS #${o.id} (${o.type})`;
		const supplyItems: { type: string; cost: number }[] = [];

		if (!o._isPaid) {
			notes += ` [INCOMPLETE: $0]`;
		} else {
			if (o.hasPoleMount) {
				basePay = installPay + poleCharge;
				notes += ` [POLE: $${poleCharge}]`;
				if (poleCost > 0) supplyItems.push({ type: 'Pole', cost: poleCost });
				if (concreteCost > 0) supplyItems.push({ type: 'Concrete', cost: concreteCost });
			} else {
				if (o.type === 'Install' || o.type === 'Re-Install') basePay = installPay;
				else if (o.type === 'Upgrade') basePay = upgradePay;
				else basePay = repairPay;
			}
			if (o.hasWifiExtender) {
				basePay += wifiExtenderPay;
				notes += ` [WIFI: $${wifiExtenderPay}]`;
			}
			if (o.hasVoip) {
				basePay += voipPay;
				notes += ` [VOIP: $${voipPay}]`;
			}
			if (applyDriveBonus && driveTimeBonus > 0) {
				basePay += driveTimeBonus;
				notes += ` [DRIVE BONUS: $${driveTimeBonus}]`;
			}
		}
		totalEarnings += basePay;
		if (supplyItems.length > 0) {
			supplyItems.forEach((item) => {
				suppliesMap.set(item.type, (suppliesMap.get(item.type) || 0) + item.cost);
				totalSuppliesCost += item.cost;
			});
		}
		return {
			id: crypto.randomUUID(),
			address: orderResolvedAddrs[o.id] || buildAddress(o),
			order: i,
			notes,
			earnings: basePay,
			appointmentTime: o.beginTime,
			type: o.type,
			duration: o._actualDuration || o.jobDuration
		};
	});

	const tripSupplies: SupplyItem[] = Array.from(suppliesMap.entries()).map(
		([type, cost]): SupplyItem => ({ id: crypto.randomUUID(), type, cost })
	);
	const netProfit = totalEarnings - (fuelCost + totalSuppliesCost);

	const trip: Trip = {
		id: `hns_${userId}_${date}`,
		userId,
		date,
		startTime: minutesToTime(startMins),
		endTime: minutesToTime(startMins + totalWorkMins),
		estimatedTime: totalMins,
		totalTime: `${Math.floor(totalMins / 60)}h ${totalMins % 60}m`,
		hoursWorked,
		startAddress: startAddr,
		endAddress: endAddr,
		totalMiles: miles,
		mpg,
		gasPrice: gas,
		fuelCost: Number(fuelCost.toFixed(2)),
		totalEarnings,
		netProfit: Number(netProfit.toFixed(2)),
		suppliesCost: totalSuppliesCost,
		supplyItems: tripSupplies,
		stops,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		syncStatus: 'synced'
	};

	await tripService.put(trip);

	// Create corresponding mileage log if miles > 0 and mileageService is available
	// This ensures HNS trips work exactly like manually created trips
	if (mileageService && miles > 0) {
		try {
			// Fetch user settings for millageRate and vehicle
			let mileageRate: number | undefined;
			let vehicle: string | undefined;
			try {
				const key = `settings:${settingsId || userId}`;
				const sRaw = await settingsKV.get(key);
				if (sRaw) {
					const d = JSON.parse(sRaw);
					const s = d.settings || d;
					mileageRate = typeof s.mileageRate === 'number' ? s.mileageRate : undefined;
					const firstVehicle = s.vehicles?.[0];
					vehicle = firstVehicle?.id ?? firstVehicle?.name ?? undefined;
				}
			} catch {
				// Ignore settings fetch errors
			}

			// Calculate reimbursement if mileageRate is available
			const reimbursement =
				typeof mileageRate === 'number' ? Number((miles * mileageRate).toFixed(2)) : undefined;

			const now = new Date().toISOString();
			const mileageRecord: MileageRecord = {
				id: trip.id, // Use trip ID for 1:1 linking
				userId,
				tripId: trip.id,
				date: trip.date,
				startOdometer: 0,
				endOdometer: miles,
				miles,
				mileageRate,
				vehicle,
				reimbursement,
				notes: '',
				createdAt: now,
				updatedAt: now
			};
			await mileageService.put(mileageRecord);
			logger(`  ${date}: Created mileage log (${miles} mi)`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.warn(`[Trip ${date}] Failed to create mileage log: ${msg}`);
		}
	}

	logger(
		`  ${date}: $${totalEarnings} - $${(fuelCost + totalSuppliesCost).toFixed(2)} = $${netProfit.toFixed(2)} (${hoursWorked}h)`
	);
	return true;
}
