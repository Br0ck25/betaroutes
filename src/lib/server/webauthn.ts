import { startRegistration } from '@simplewebauthn/browser';

async function registerPasskey() {
  // 1. Get options from server
  const res = await fetch('/api/auth/webauthn?type=register');
  if (!res.ok) {
    throw new Error('Failed to get registration options');
  }

  const optionsJSON = await res.json();

  // 2. Start WebAuthn (THIS IS THE FIX)
  const attestation = await startRegistration({
    optionsJSON
  });

  // 3. Send response back to server
  const verifyRes = await fetch('/api/auth/webauthn?type=register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attestation),
  });

  if (!verifyRes.ok) {
    throw new Error('Verification failed');
  }

  return verifyRes.json();
}
