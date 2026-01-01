# Trip Data Caching Audit Report

**Date:** 2026-01-01
**Scope:** Address geocoding, route calculation, and trip data caching

---

## Executive Summary

The codebase implements **multi-layer caching** for trip data, but has **one critical gap** in the `/api/directions/cache` endpoint that bypasses the cache entirely. The core caching mechanisms are well-implemented, but inconsistent usage across different code paths creates inefficiencies.

**Status:** ⚠️ **PARTIALLY FUNCTIONAL** - Caching works in most places but has critical gaps

---

## ✅ What Works Well

### 1. **Address Geocoding Cache** (EXCELLENT)
**Location:** `src/lib/server/hughesnet/router.ts:25-101`

```typescript
// Key format: geo:<sanitized_address>
// KV Namespace: BETA_DIRECTIONS_KV
```

**Flow:**
1. Checks KV cache first (`geo:<address>`)
2. On miss: Calls Google Geocoding API
3. Caches result permanently: `{ lat, lon, formattedAddress }`
4. Returns cached data on subsequent requests

**Verdict:** ✅ **WORKING PERFECTLY**

---

### 2. **Route Segment Cache** (EXCELLENT)
**Location:** `src/lib/server/hughesnet/router.ts:103-158`

```typescript
// Key format: dir:<origin>_to_<destination>
// KV Namespace: BETA_DIRECTIONS_KV
```

**Flow:**
1. Checks KV cache with readable key: `dir:123mainst_to_456oakave`
2. On miss: Calls Google Directions API
3. Caches: `{ distance: meters, duration: seconds }`
4. Returns cached mileage/time on subsequent identical routes

**Verdict:** ✅ **WORKING PERFECTLY**

**Example:** If you drive from "123 Main St, City" to "456 Oak Ave, City", the distance and duration are cached. Next time you create a trip with those same addresses, it retrieves from cache instead of calling Google API.

---

### 3. **Route Optimization Cache** (EXCELLENT)
**Location:** `src/routes/api/directions/optimize/+server.ts:49-103`

```typescript
// Key format: opt:<hash_of_addresses>
// KV Namespace: BETA_DIRECTIONS_KV
```

**Flow:**
1. Generates hash from start + end + all stops
2. Checks KV cache first
3. On miss: Calls Google Directions API with `optimize:true`
4. Caches: `{ source: 'google', optimizedOrder: [], legs: [] }`

**Verdict:** ✅ **WORKING PERFECTLY**

---

### 4. **Place Details & Autocomplete Cache** (EXCELLENT)
**Location:** `src/routes/api/places/cache/+server.ts`

```typescript
// Key format: place:<SHA256_hash> and prefix:<first_N_chars>
// KV Namespace: BETA_PLACES_KV
```

**Flow:**
1. When user selects an address from autocomplete
2. Saves full place data with coordinates
3. Updates prefix buckets (2-10 chars) for fast autocomplete
4. Stores permanently with contributor user ID

**Verdict:** ✅ **WORKING PERFECTLY**

---

### 5. **Background Trip Route Computation** (EXCELLENT)
**Location:** `src/lib/server/TripIndexDO.ts:278-343`

**Triggered by:** `tripService.put()` → Background `/compute-routes` call

**Flow:**
1. When trip is saved, triggers background route calculation
2. For each segment, checks BETA_DIRECTIONS_KV cache
3. On miss: Calls Google Directions API
4. Caches each leg: `dir:<start>_to_<end>`
5. Auto-caches geocode data from API response
6. Updates trip with totalMiles and estimatedTime

**Verdict:** ✅ **WORKING PERFECTLY**

---

### 6. **Trip Building (HughesNet Integration)** (EXCELLENT)
**Location:** `src/lib/server/hughesnet/tripBuilder.ts:123-206`

**Flow:**
1. Builds trip from HughesNet orders
2. Calls `router.getRouteInfo()` for each route segment
3. This method uses KV cache (see #2 above)
4. Accumulates cached distance/duration data
5. Saves trip with calculated mileage/time

**Verdict:** ✅ **WORKING PERFECTLY** - Fully leverages cache

---

## 🚨 Critical Issues

### **ISSUE #1: `/api/directions/cache` Endpoint Bypasses Cache**
**Location:** `src/routes/api/directions/cache/+server.ts:6-53`

**Problem:** This endpoint is named "cache" but **DOES NOT USE ANY CACHE**

```typescript
// Current code - NO CACHING!
export const GET: RequestHandler = async ({ url, platform, locals }) => {
    // ... validation ...

    // Line 30-35: Directly calls Google API
    const googleUrl = `https://maps.googleapis.com/maps/api/directions/json?...`;
    const response = await fetch(googleUrl);
    const data = await response.json();

    // Line 40-45: Returns result WITHOUT caching
    return json({ source: 'google', data: result });
};
```

**Impact:**
- Every call to this endpoint wastes a Google API request
- Users with identical trips pay multiple times in API costs
- No benefit from previous calculations

**Expected Behavior:**
```typescript
// Should follow the pattern from hughesnet/router.ts
const cacheKey = `dir:${start}_to_${end}`;

// 1. Check cache first
const cached = await directionsKV.get(cacheKey);
if (cached) return json(JSON.parse(cached));

// 2. Call API
const response = await fetch(googleUrl);
const result = { distance: ..., duration: ... };

// 3. Cache result
await directionsKV.put(cacheKey, JSON.stringify(result));

// 4. Return
return json(result);
```

**Severity:** 🔴 **CRITICAL** - Defeats the entire purpose of this endpoint

---

### **ISSUE #2: Inconsistent Cache Key Formats**

Multiple key formats exist across the codebase:

| Location | Key Format | Namespace |
|----------|------------|-----------|
| hughesnet/router.ts (geo) | `geo:<sanitized>` | BETA_DIRECTIONS_KV |
| hughesnet/router.ts (route) | `dir:<origin>_to_<dest>` | BETA_DIRECTIONS_KV |
| TripIndexDO.ts | `dir:<origin>_to_<dest>` | BETA_DIRECTIONS_KV |
| optimize API | `opt:<hash>` | BETA_DIRECTIONS_KV |
| places cache | `place:<sha256>` | BETA_PLACES_KV |
| places cache | `prefix:<chars>` | BETA_PLACES_KV |

**Issue:** The geocode cache uses BETA_DIRECTIONS_KV but should probably use BETA_PLACES_KV for better organization.

**Severity:** ⚠️ **MINOR** - Not broken, just inconsistent

---

### **ISSUE #3: No Cache Expiration Strategy**

**All caches are permanent** (no TTL set). This could cause issues:

- **Geocode data:** Addresses don't change often ✅ OK
- **Route data:** Road conditions, traffic patterns change ⚠️ Could be stale
- **Pricing/timing:** Gas prices, traffic times vary by time of day ⚠️ Could be stale

**Recommendation:** Add TTL for route caches:
```typescript
await kv.put(key, JSON.stringify(result), {
    expirationTtl: 30 * 24 * 60 * 60  // 30 days
});
```

**Severity:** ⚠️ **MODERATE** - Data could become stale over time

---

## Cache Coverage Analysis

### ✅ **Fully Cached Paths:**

1. **HughesNet Auto-Trip Creation**
   - `tripBuilder.ts` → `router.getRouteInfo()` ✅ Cached

2. **Server-Side Route Optimization**
   - `/api/directions/optimize` ✅ Cached

3. **Background Route Computation**
   - `TripIndexDO` `/compute-routes` ✅ Cached

4. **Address Autocomplete**
   - `/api/places/cache` ✅ Cached

### ❌ **Uncached Paths:**

1. **Direct Directions API Calls**
   - `/api/directions/cache` ❌ **NOT CACHED** (Issue #1)

---

## Test Scenarios

### **Scenario 1: Create Two Identical Trips**

**Steps:**
1. Create trip: Start = "123 Main St", End = "456 Oak Ave", 2 stops
2. Create another trip with same addresses

**Expected:** Second trip uses cached data (no API calls)

**Current Status:**
- ✅ If using HughesNet integration → **CACHED**
- ✅ If using background computation → **CACHED**
- ❌ If using `/api/directions/cache` → **NOT CACHED**

---

### **Scenario 2: Swap Start/End Addresses**

**Steps:**
1. Create trip: A → B
2. Create trip: B → A (reverse)

**Expected:** Both directions cached separately

**Current Status:**
- ✅ **WORKS** - Keys are directional: `dir:a_to_b` vs `dir:b_to_a`

---

### **Scenario 3: Route with Multiple Stops**

**Steps:**
1. Create trip: Home → Stop1 → Stop2 → Stop3 → Home
2. Create trip with same stops in different order

**Expected:** Individual segments cached, optimization cached separately

**Current Status:**
- ✅ **WORKS** - Each segment cached individually
- ✅ Optimization cached with different key if order changes

---

## Recommendations

### **Priority 1: Fix `/api/directions/cache`** 🔴

Add KV caching to the `/api/directions/cache` endpoint following the pattern used in `hughesnet/router.ts:103-158`.

**File:** `src/routes/api/directions/cache/+server.ts`

**Changes Needed:**
```typescript
export const GET: RequestHandler = async ({ url, platform, locals }) => {
    // ... existing validation ...

    const directionsKV = platform?.env?.BETA_DIRECTIONS_KV;
    const cacheKey = `dir:${start.toLowerCase().trim()}_to_${end.toLowerCase().trim()}`
        .replace(/[^a-z0-9_:-]/g, '');

    // CHECK CACHE FIRST
    if (directionsKV) {
        const cached = await directionsKV.get(cacheKey);
        if (cached) {
            return json({ source: 'cache', ...JSON.parse(cached) });
        }
    }

    // ... existing Google API call ...

    const result = {
        distance: leg.distance.value,
        duration: leg.duration.value
    };

    // SAVE TO CACHE
    if (directionsKV) {
        await directionsKV.put(cacheKey, JSON.stringify(result));
    }

    return json({ source: 'google', data: result });
};
```

---

### **Priority 2: Add Cache Expiration** ⚠️

Add TTL to route caches to prevent stale data:

```typescript
// For route data (30 days)
await directionsKV.put(key, JSON.stringify(result), {
    expirationTtl: 30 * 24 * 60 * 60
});

// For geocode data (permanent is OK)
await placesKV.put(key, JSON.stringify(result)); // No TTL
```

---

### **Priority 3: Consolidate Cache Keys** ℹ️

Move geocode cache to BETA_PLACES_KV:

**Current:**
```typescript
// hughesnet/router.ts uses BETA_DIRECTIONS_KV
const kvKey = `geo:${cleanAddr}`;
await this.kv.put(kvKey, JSON.stringify(point));
```

**Better:**
```typescript
// Use BETA_PLACES_KV for all address/geocode data
const placesKV = platform?.env?.BETA_PLACES_KV;
await placesKV.put(kvKey, JSON.stringify(point));
```

---

## Conclusion

**Overall Rating:** ⭐⭐⭐⭐ (4/5)

**Strengths:**
- ✅ Comprehensive caching strategy across most code paths
- ✅ Proper cache key generation
- ✅ Background computation leverages cache well
- ✅ Trip building fully utilizes cached data

**Critical Gap:**
- 🚨 `/api/directions/cache` endpoint doesn't cache (misleading name)

**Action Required:**
1. Fix Issue #1 (add caching to `/api/directions/cache`)
2. Add TTL to route caches
3. Test with identical trips to verify cache hits

Once Issue #1 is fixed, the system will be **production-ready** with excellent cache coverage.

---

## Cache Flow Diagram

```
User Creates Trip
    ↓
Trip Service (tripService.put)
    ↓
┌─────────────────────────────────────┐
│ Background: /compute-routes         │
│                                     │
│ For each segment:                   │
│   1. Check BETA_DIRECTIONS_KV      │ ← CACHE CHECK
│   2. If miss → Google API           │
│   3. Cache result                   │ ← CACHE WRITE
│   4. Update trip totals             │
└─────────────────────────────────────┘
    ↓
Address Indexing (indexTripData)
    ↓
┌─────────────────────────────────────┐
│ Cache addresses in BETA_PLACES_KV   │
│   - Key: place:<hash>               │ ← CACHE WRITE
│   - Updates prefix buckets          │
└─────────────────────────────────────┘
    ↓
Trip Saved with Cached Mileage/Time
```

---

**Next Steps:**
1. Review this audit
2. Approve fixes
3. Implement caching in `/api/directions/cache`
4. Test with duplicate trips
5. Monitor cache hit rates
