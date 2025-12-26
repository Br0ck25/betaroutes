/**
 * Service for managing WebAuthn authenticators in Cloudflare KV
 */

export interface StoredAuthenticator {
  credentialID: string;
  credentialPublicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  name?: string; // Friendly display name (e.g., "Windows laptop")
  createdAt?: string;
}

/**
 * Get all authenticators for a user
 */
export async function getUserAuthenticators(
  kv: KVNamespace,
  userId: string
): Promise<StoredAuthenticator[]> {
  const key = `authenticators:${userId}`;
  const data = await kv.get(key, 'json');
  
  if (!data || !Array.isArray(data)) {
    return [];
  }
  
  return data as StoredAuthenticator[];
}

/**
 * Add a new authenticator for a user
 * CRITICAL: Also creates credential index for authentication lookups
 */
export async function addAuthenticator(
  kv: KVNamespace,
  userId: string,
  authenticator: {
    credentialID: string;
    credentialPublicKey: string;
    counter: number;
    transports?: AuthenticatorTransport[];
    name?: string;
    createdAt?: string;
  }
): Promise<void> {
  // Get existing authenticators
  const existing = await getUserAuthenticators(kv, userId);
  
  // Check if credential already exists
  const duplicate = existing.find(
    auth => auth.credentialID === authenticator.credentialID
  );
  
  if (duplicate) {
    console.warn('[AuthenticatorService] Duplicate credential, skipping:', authenticator.credentialID);
    return;
  }
  
  // Add new authenticator
  const updated = [...existing, authenticator];
  
  // Save to user's authenticators list
  await kv.put(`authenticators:${userId}`, JSON.stringify(updated));
  
  // ✅ CREATE CREDENTIAL INDEX - Maps credential → user for login lookups
  // This is CRITICAL for authentication to work!
  await kv.put(`credential:${authenticator.credentialID}`, userId);
  
  console.log('[AuthenticatorService] Added authenticator for user:', userId);
  console.log('[AuthenticatorService] Created credential index:', `credential:${authenticator.credentialID}`, '→', userId);
}

/**
 * Update the counter for an authenticator
 */
export async function updateAuthenticatorCounter(
  kv: KVNamespace,
  userId: string,
  credentialID: string,
  newCounter: number
): Promise<void> {
  const authenticators = await getUserAuthenticators(kv, userId);
  
  const updated = authenticators.map(auth => {
    if (auth.credentialID === credentialID) {
      return { ...auth, counter: newCounter };
    }
    return auth;
  });
  
  await kv.put(`authenticators:${userId}`, JSON.stringify(updated));
  
  console.log('[AuthenticatorService] Updated counter for credential:', credentialID, 'to', newCounter);
}

/**
 * Update authenticator metadata (e.g., name, createdAt) for a user.
 */
export async function updateAuthenticator(
  kv: KVNamespace,
  userId: string,
  credentialID: string,
  updates: Partial<Pick<StoredAuthenticator, 'name' | 'createdAt' | 'transports'>>
): Promise<void> {
  const authenticators = await getUserAuthenticators(kv, userId);

  const updated = authenticators.map(auth => {
    if (auth.credentialID === credentialID) {
      return { ...auth, ...updates };
    }
    return auth;
  });

  await kv.put(`authenticators:${userId}`, JSON.stringify(updated));
  console.log('[AuthenticatorService] Updated authenticator metadata:', credentialID, updates);
}

/**
 * Get user ID by credential ID (for authentication)
 * This uses the credential index created during registration
 */
export async function getUserIdByCredentialID(
  kv: KVNamespace,
  credentialID: string
): Promise<string | null> {
  const key = `credential:${credentialID}`;
  const userId = await kv.get(key);
  
  if (!userId) {
    console.warn('[AuthenticatorService] No user found for credential:', credentialID);
    return null;
  }
  
  console.log('[AuthenticatorService] Found user for credential:', credentialID, '→', userId);
  return userId;
}

/**
 * Remove an authenticator from a user
 */
export async function removeAuthenticator(
  kv: KVNamespace,
  userId: string,
  credentialID: string
): Promise<void> {
  const authenticators = await getUserAuthenticators(kv, userId);
  
  const updated = authenticators.filter(
    auth => auth.credentialID !== credentialID
  );
  
  await kv.put(`authenticators:${userId}`, JSON.stringify(updated));
  
  // Also remove from credential index
  await kv.delete(`credential:${credentialID}`);
  
  console.log('[AuthenticatorService] Removed authenticator:', credentialID);
}

/**
 * Remove all authenticators for a user (e.g., on account deletion)
 */
export async function removeAllAuthenticators(
  kv: KVNamespace,
  userId: string
): Promise<void> {
  const authenticators = await getUserAuthenticators(kv, userId);
  
  // Remove credential indexes
  for (const auth of authenticators) {
    await kv.delete(`credential:${auth.credentialID}`);
  }
  
  // Remove authenticators list
  await kv.delete(`authenticators:${userId}`);
  
  console.log('[AuthenticatorService] Removed all authenticators for user:', userId);
}