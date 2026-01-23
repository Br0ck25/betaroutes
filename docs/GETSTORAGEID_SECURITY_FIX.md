# getStorageId() Security Fix - Complete Documentation

**Date:** 2026-01-23  
**Status:** In Progress  
**Priority:** P0 - CRITICAL SECURITY FIX  
**Related:** SECURITY_AUDIT_MASTER.md Item #1

---

## ⚠️ IMPORTANT: This Document Serves As Rollback Reference

If the security fix causes data access issues, this document contains the ORIGINAL code patterns needed to revert all changes. See [Rollback Section](#rollback-instructions) at the bottom.

---

## Table of Contents

1. [Problem Description](#problem-description)
2. [How The OLD System Worked](#how-the-old-system-worked)
3. [The Security Vulnerability](#the-security-vulnerability)
4. [The Fix](#the-fix)
5. [Files That Must Be Changed](#files-that-must-be-changed)
6. [Migration Strategy](#migration-strategy)
7. [Rollback Instructions](#rollback-instructions)

---

## Problem Description

The application stores user data in Cloudflare KV using keys like:

```
trip:{userId}:{tripId}
expense:{userId}:{expenseId}
mileage:{userId}:{mileageId}
```

The `{userId}` portion was historically the user's **username** (e.g., "James"), not their UUID.

---

## How The OLD System Worked

### Original getStorageId() Function

**File:** `src/lib/server/user.ts`

The ORIGINAL function returned the first truthy value:

```typescript
// ⚠️ OLD CODE - VULNERABLE - FOR REFERENCE ONLY
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	return user?.name || user?.token || user?.id || '';
}
```

**Fallback Order:**

1. `user.name` (username like "James") - **USED MOST OFTEN**
2. `user.token` (session token) - **SOMETIMES USED**
3. `user.id` (UUID) - **RARELY USED** (was last in chain)

### Where Storage Keys Were Generated

Many endpoints didn't even use `getStorageId()` - they inlined the pattern directly:

```typescript
// Pattern found in src/routes/api/trips/+server.ts (lines 161, 297, 614)
const storageId = userSafe?.name || userSafe?.token || '';

// Pattern found in src/routes/api/hughesnet/+server.ts (lines 24, 135)
const userId = user?.name || user?.token || user?.id || 'default_user';
```

### Resulting KV Key Format

For user "James" with UUID `abc-123`:

| Record Type        | Actual KV Key                                        |
| ------------------ | ---------------------------------------------------- |
| Trip               | `trip:James:550e8400-e29b-41d4-a716-446655440000`    |
| Expense            | `expense:James:660e9500-f30c-52e5-b827-557766551111` |
| Mileage            | `mileage:James:770f0600-g41d-63f6-c938-668877662222` |
| HughesNet Settings | `hns:settings:James`                                 |
| HughesNet Orders   | `hns:order:WO123` with `ownerId: "James"` inside     |

**Key insight:** ALL existing user data is keyed by username, not UUID.

---

## The Security Vulnerability

### Attack Scenario

1. User "victim" creates account with username "john"
2. User "victim" has trips stored as `trip:john:uuid1`
3. Attacker creates account with username "john" (if system allows duplicate usernames after victim deletes account, or through race condition)
4. Attacker logs in and requests `trip:john:*`
5. Attacker sees victim's trip data

### Risk Level: CRITICAL

- Full access to another user's trips, expenses, mileage
- Financial data exposure (earnings, costs)
- Location data exposure (addresses)
- HughesNet credentials exposure

---

## The Fix

### Step 1: Fix getStorageId() ✅ COMPLETED

**File:** `src/lib/server/user.ts`

```typescript
// NEW CODE - SECURE
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	// SECURITY: Only return the user's UUID, never name or token
	return user?.id || '';
}
```

### Step 2: Replace All Inline Vulnerable Patterns ⚠️ IN PROGRESS

Files that inline the vulnerable pattern must be updated to use `getStorageId()`:

| File                                                  | Lines              | Status       |
| ----------------------------------------------------- | ------------------ | ------------ |
| `src/routes/api/trips/+server.ts`                     | 161, 297, 549, 614 | ❌ NOT FIXED |
| `src/routes/api/trips/[id]/+server.ts`                | 93, 160, 267       | ❌ NOT FIXED |
| `src/routes/api/hughesnet/+server.ts`                 | 24, 135            | ❌ NOT FIXED |
| `src/routes/api/hughesnet/archived/+server.ts`        | 18, 127            | ❌ NOT FIXED |
| `src/routes/api/hughesnet/archived/import/+server.ts` | 23                 | ❌ NOT FIXED |

### Step 3: Migrate Existing Data ✅ IMPLEMENTED

**File:** `src/lib/server/migration/storage-key-migration.ts`

Migration function moves data from username-keys to UUID-keys on login.

---

## Files That Must Be Changed

### Server-Side API Endpoints (CRITICAL)

#### 1. `src/routes/api/trips/+server.ts`

**Current (VULNERABLE):**

```typescript
// Line 161 (GET handler)
const storageId = userSafe?.name || userSafe?.token || '';

// Line 297 (POST handler)
const storageId = sessionUserSafe?.name || sessionUserSafe?.token || '';

// Line 549 (POST handler - counter)
await svc.incrementUserCounter(sessionUserSafe?.token || '', 1);

// Line 614 (PUT handler)
const storageId = sessionUserSafe?.name || sessionUserSafe?.token || '';
```

**Required Fix:**

```typescript
import { getStorageId } from '$lib/server/user';

// All occurrences become:
const storageId = getStorageId(user);
```

#### 2. `src/routes/api/trips/[id]/+server.ts`

**Current (VULNERABLE):**

```typescript
// Line 93 (GET handler)
const storageId = userSafe?.name || userSafe?.token || '';

// Line 160 (PUT handler)
const storageId = userSafe?.name || userSafe?.token || '';

// Line 267 (DELETE handler)
const storageId = userSafe?.name || userSafe?.token || '';
```

#### 3. `src/routes/api/hughesnet/+server.ts`

**Current (VULNERABLE):**

```typescript
// Line 24 (GET handler)
const userId = user?.name || user?.token || user?.id || 'default_user';

// Line 135 (POST handler)
const userId = user?.name || user?.token || user?.id || 'default_user';
```

**Note:** These have `user?.id` but it's LAST in the chain, so `user?.name` is always used first.

#### 4. `src/routes/api/hughesnet/archived/+server.ts`

**Current (VULNERABLE):**

```typescript
// Line 18
const userId = user?.name || user?.token || user?.id || 'default_user';

// Line 127
const userId = user?.name || user?.token || user?.id || 'default_user';
```

#### 5. `src/routes/api/hughesnet/archived/import/+server.ts`

**Current (VULNERABLE):**

```typescript
// Line 23
const userId = user?.name || user?.token || user?.id || 'default_user';
```

### Already Fixed (Using getStorageId)

These files already use `getStorageId()` correctly:

- ✅ `src/routes/api/expenses/+server.ts`
- ✅ `src/routes/api/expenses/[id]/+server.ts`
- ✅ `src/routes/api/mileage/+server.ts`
- ✅ `src/routes/api/mileage/[id]/+server.ts`
- ✅ `src/routes/api/trash/+server.ts`
- ✅ `src/routes/api/trash/[id]/+server.ts`

---

## Migration Strategy

### Overview

When a user logs in, the migration function:

1. Lists all KV keys matching `{type}:{username}:*`
2. For each key, reads the data
3. Writes data to new key `{type}:{userId}:*`
4. Deletes the old key

### Migration Function Location

**File:** `src/lib/server/migration/storage-key-migration.ts`

### Trigger Point

**File:** `src/routes/login/+server.ts`

Migration is triggered in the background after successful login using `platform.context.waitUntil()`.

### Safety Features

1. **Idempotent:** If new key exists, skips that record
2. **Non-blocking:** Runs in background after response sent
3. **Error-tolerant:** Continues if individual records fail
4. **Logged:** All operations logged with `[MIGRATION]` prefix

---

## Rollback Instructions

### If Data Becomes Inaccessible

If users report they cannot see their data after this fix, you have two options:

#### Option A: Revert getStorageId() (Quick Fix)

**File:** `src/lib/server/user.ts`

Change back to:

```typescript
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	// ROLLBACK: Revert to original behavior
	return user?.name || user?.token || user?.id || '';
}
```

This will immediately restore access to username-keyed data.

#### Option B: Revert Individual Endpoint Changes

For each file changed, revert the pattern back to:

```typescript
// trips/+server.ts - Revert line 161
const storageId = userSafe?.name || userSafe?.token || '';

// hughesnet/+server.ts - Revert line 24
const userId = user?.name || user?.token || user?.id || 'default_user';
```

### To Verify Data Exists

Check KV directly for a known user:

```bash
# List trips for username "James"
wrangler kv:key list --prefix "trip:James:" --binding BETA_LOGS_KV

# List trips for UUID "abc-123-def"
wrangler kv:key list --prefix "trip:abc-123-def:" --binding BETA_LOGS_KV
```

If username-keyed data exists but UUID-keyed doesn't, migration hasn't run yet.

### Emergency Contact

If data issues persist, check:

1. Migration logs for errors
2. User has logged in since deployment (triggers migration)
3. KV bindings are correctly configured in `wrangler.toml`

---

## Change Log

| Date       | Change                            | Author   |
| ---------- | --------------------------------- | -------- |
| 2026-01-23 | Created documentation             | AI Agent |
| 2026-01-23 | Fixed getStorageId()              | AI Agent |
| 2026-01-23 | Integrated migration on login     | AI Agent |
| 2026-01-23 | (Pending) Fix trips endpoints     | -        |
| 2026-01-23 | (Pending) Fix hughesnet endpoints | -        |

---

## Verification Checklist

After all changes:

- [ ] `npm run check` passes (0 errors)
- [ ] `npm run lint` passes
- [ ] Login still works
- [ ] Existing trips appear on dashboard
- [ ] New trips can be created
- [ ] Expenses work correctly
- [ ] Mileage works correctly
- [ ] HughesNet sync works (if used)
- [ ] Migration logs show in console

---

## Security Consideration

This fix is MANDATORY for production. The vulnerability allows:

- Account takeover via username collision
- Data theft between users
- Privacy violations

Do NOT leave the original vulnerable pattern in production code.
