import { test, expect } from '@playwright/test';

test('passkey demo registration flow', async ({ page }) => {
  // Log page console messages to test output
  page.on('console', msg => {
    console.log('PAGE LOG:', msg.type(), msg.text());
  });

  // Intercept the debug options request to return an options payload we control
  const options = {
    challenge: 'a1vk-2R6hIPuDxhqqch_Vt4zlTlS91Q8SRDgssaepCk',
    rp: { name: 'Test RP', id: 'localhost' },
    user: { id: 'dGVzdC11c2Vy', name: 'test@example.com', displayName: 'Test' },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }]
  };

  await page.route('**/debug/webauthn-test', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ full: options }) }));

  // Intercept registration POST and return a successful verification response, capture body for assertions
  let capturedPost: any = null;
  await page.route('**/api/auth/webauthn**', async (route) => {
    const req = route.request();
    if (req.method().toUpperCase() === 'POST' && req.url().includes('?type=register')) {
      const postData = await req.postData();
      try {
        capturedPost = JSON.parse(postData || '{}');
      } catch (e) {
        capturedPost = postData;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, verified: true }) });
      return;
    }
    await route.continue();
  });

  // Stub navigator.credentials.create to simulate a successful passkey creation
  await page.addInitScript(() => {
    // @ts-ignore
    navigator.credentials = Object.assign(navigator.credentials || {}, {
      create: async (opts: any) => {
        // Return a minimal fake credential with ArrayBuffer fields
        const buf = (s: string) => {
          const b = new Uint8Array(s.split('').map(c => c.charCodeAt(0)));
          return b.buffer;
        };

        return {
          id: 'fake-id',
          rawId: buf('raw'),
          response: {
            attestationObject: buf('att'),
            clientDataJSON: buf('client')
          },
          type: 'public-key',
          getClientExtensionResults: () => ({}),
          // some libs access transports or other fields
          transports: []
        } as any;
      }
    });
  });

  await page.goto('/debug/passkey-demo');
  await page.click('button:has-text("Register Demo Passkey")');
  // Wait for server verification and assert it was called with normalized base64url fields
  await page.waitForSelector('text=Registered and verified by server', { timeout: 10000 });
  await expect(page.locator('text=Registered and verified by server')).toBeVisible();

  // Assert the captured POST exists and contains base64url strings for attestation/clientData
  expect(capturedPost).not.toBeNull();
  // rawId may be under rawId or id
  expect(typeof capturedPost.rawId === 'string' || typeof capturedPost.id === 'string').toBe(true);
  const resp = capturedPost.response || {};
  expect(typeof resp.attestationObject === 'string' || typeof resp.clientDataJSON === 'string').toBe(true);
});