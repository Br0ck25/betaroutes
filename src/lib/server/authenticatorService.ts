// src/lib/server/authenticatorService.ts
/**
 * Service for managing WebAuthn authenticators in Cloudflare KV
 */

export interface Authenticator {
  id: string; // Unique ID for this authenticator
  userId: string;
  credentialID: string; // base64url encoded
  credentialPublicKey: string; // base64url encoded
  counter: number;
  transports?: AuthenticatorTransport[];
  createdAt: string;
}

/**
 * Get all authenticators for a user
 */
export async function getUserAuthenticators(
  kv: KVNamespace,
  userId: string
): Promise<Authenticator[]> {
  const key = `authenticators:${userId}`;
  const data = await kv.get(key, 'json');
  
  if (!data) {
    return [];
  }
  
  return Array.isArray(data) ? data : [];
}

/**
 * Add a new authenticator for a user
 */
export async function addAuthenticator(
  kv: KVNamespace,
  userId: string,
  authenticator: Omit<Authenticator, 'id' | 'userId' | 'createdAt'>
): Promise<Authenticator> {
  const key = `authenticators:${userId}`;
  
  // Get existing authenticators
  const existing = await getUserAuthenticators(kv, userId);
  
  // Create new authenticator with metadata
  const newAuthenticator: Authenticator = {
    id: crypto.randomUUID(),
    userId,
    ...authenticator,
    createdAt: new Date().toISOString()
  };
  
  // Add to array
  const updated = [...existing, newAuthenticator];
  
  // Save back to KV
  await kv.put(key, JSON.stringify(updated));
  
  return newAuthenticator;
}

/**
 * Update an authenticator's counter (for replay attack prevention)
 */
export async function updateAuthenticatorCounter(
  kv: KVNamespace,
  userId: string,
  credentialID: string,
  newCounter: number
): Promise<void> {
  const key = `authenticators:${userId}`;
  const authenticators = await getUserAuthenticators(kv, userId);
  
  const updated = authenticators.map(auth => 
    auth.credentialID === credentialID 
      ? { ...auth, counter: newCounter }
      : auth
  );
  
  await kv.put(key, JSON.stringify(updated));
}

/**
 * Delete a specific authenticator
 */
export async function deleteAuthenticator(
  kv: KVNamespace,
  userId: string,
  credentialID: string
): Promise<void> {
  const key = `authenticators:${userId}`;
  const authenticators = await getUserAuthenticators(kv, userId);
  
  const filtered = authenticators.filter(
    auth => auth.credentialID !== credentialID
  );
  
  if (filtered.length === 0) {
    // No authenticators left, delete the key
    await kv.delete(key);
  } else {
    await kv.put(key, JSON.stringify(filtered));
  }
}

/**
 * Delete all authenticators for a user (used during account deletion)
 */
export async function deleteAllUserAuthenticators(
  kv: KVNamespace,
  userId: string
): Promise<void> {
  const key = `authenticators:${userId}`;
  await kv.delete(key);
}