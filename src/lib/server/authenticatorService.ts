/**
 * Service for managing WebAuthn authenticators in Cloudflare KV
 */

export interface Authenticator {
  id: string;
  userId: string;
  credentialID: string;
  credentialPublicKey: string;
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
  
  const existing = await getUserAuthenticators(kv, userId);
  
  const newAuthenticator: Authenticator = {
    id: crypto.randomUUID(),
    userId,
    ...authenticator,
    createdAt: new Date().toISOString()
  };
  
  const updated = [...existing, newAuthenticator];
  
  await kv.put(key, JSON.stringify(updated));
  
  // Create credential index for authentication lookups
  await kv.put(`credential:${authenticator.credentialID}`, userId);
  
  console.log('[AuthService] Authenticator saved and indexed');
  
  return newAuthenticator;
}

/**
 * Find user ID by credential ID
 */
export async function getUserIdByCredentialID(
  kv: KVNamespace,
  credentialID: string
): Promise<string | null> {
  const userId = await kv.get(`credential:${credentialID}`);
  return userId;
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
    await kv.delete(key);
  } else {
    await kv.put(key, JSON.stringify(filtered));
  }
  
  // Delete credential index
  await kv.delete(`credential:${credentialID}`);
}

/**
 * Delete all authenticators for a user (used during account deletion)
 */
export async function deleteAllUserAuthenticators(
  kv: KVNamespace,
  userId: string
): Promise<void> {
  const key = `authenticators:${userId}`;
  const authenticators = await getUserAuthenticators(kv, userId);
  
  // Delete all credential indexes
  for (const auth of authenticators) {
    await kv.delete(`credential:${auth.credentialID}`);
  }
  
  await kv.delete(key);
}