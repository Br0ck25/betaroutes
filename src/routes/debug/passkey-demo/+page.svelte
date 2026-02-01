<script lang="ts">
  import { asRecord, getErrorMessage } from '$lib/utils/errors';
  import { startRegistration } from '@simplewebauthn/browser';
  let message = $state('');
  let loading = $state(false);

  async function runDemo() {
    loading = true;
    message = '';
    try {
      const res = await fetch('/debug/webauthn-test');
      if (!res.ok) throw new Error('Failed to get options');
      const dataJson = await res.json().catch(() => null);
      const data = asRecord(dataJson);
      const options = asRecord(data.full);

      // Ensure challenge is string
      if (options.challenge && typeof options.challenge !== 'string') {
        const bytes = new Uint8Array(options.challenge as ArrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(Number(bytes[i] ?? 0));
        options.challenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }

      // Call startRegistration
      // Cast via unknown -> parameters to avoid `any` while matching runtime shape
      const cred = await startRegistration(
        options as unknown as Parameters<typeof startRegistration>[0]
      );
      console.log('Demo credential:', cred);

      // Normalize ArrayBuffer fields to base64url strings
      function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++)
          binary += String.fromCharCode(Number(bytes[i] ?? 0));
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }

      // Cast via unknown to avoid accidental structural conversion errors
      const normalised: Record<string, unknown> = {
        ...(cred as unknown as Record<string, unknown>)
      };
      if (
        normalised.rawId &&
        (normalised.rawId instanceof ArrayBuffer || ArrayBuffer.isView(normalised.rawId))
      ) {
        normalised.rawId = bufferToBase64Url(normalised.rawId as ArrayBuffer);
      }
      const resp = (normalised.response as Record<string, unknown>) || {};
      if (
        resp.attestationObject &&
        (resp.attestationObject instanceof ArrayBuffer ||
          ArrayBuffer.isView(resp.attestationObject))
      )
        (resp as Record<string, unknown>).attestationObject = bufferToBase64Url(
          resp.attestationObject as ArrayBuffer
        );
      if (
        resp.clientDataJSON &&
        (resp.clientDataJSON instanceof ArrayBuffer || ArrayBuffer.isView(resp.clientDataJSON))
      )
        (resp as Record<string, unknown>).clientDataJSON = bufferToBase64Url(
          resp.clientDataJSON as ArrayBuffer
        );

      // POST to verification endpoint
      try {
        // Compute device name to send to server (prefill using UA info)
        function getDeviceName() {
          const uaData = (navigator as unknown as { userAgentData?: Record<string, unknown> })
            .userAgentData;
          if (uaData && uaData.platform) {
            const brands = uaData.brands as unknown;
            const brandCandidate =
              Array.isArray(brands) && brands.length > 0 ? (brands[0] as unknown) : undefined;
            const brand =
              brandCandidate &&
              typeof (brandCandidate as Record<string, unknown>).brand === 'string'
                ? String((brandCandidate as Record<string, unknown>).brand)
                : 'Browser';

            return `${brand} on ${uaData.platform}`;
          }
          const ua = navigator.userAgent || '';
          if (/Android/i.test(ua)) return 'Android device';
          if (/Windows/i.test(ua)) return 'Windows device';
          if (/Mac|Macintosh/i.test(ua)) return 'Mac device';
          if (/iPhone|iPad/i.test(ua)) return 'iOS device';
          return 'Unknown device';
        }

        const deviceName = getDeviceName();

        const verifyRes = await fetch('/api/auth/webauthn?type=register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: normalised, deviceName })
        });

        let verifyJson: unknown = {};
        try {
          verifyJson = await verifyRes.json();
        } catch (_e) {
          /* ignore parse errors */
        }

        const verifyRec = asRecord(verifyJson);
        if (verifyRes.ok && verifyRec.verified) {
          message = 'Registered and verified by server';
        } else {
          message = 'Server verification failed: ' + (verifyRec.error || JSON.stringify(verifyRec));
        }
      } catch (err: unknown) {
        console.error('Verification POST error', getErrorMessage(err));
        message = 'Verification POST failed: ' + getErrorMessage(err);
      }
    } catch (err: unknown) {
      console.error('Demo error', getErrorMessage(err));
      message = getErrorMessage(err);
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Passkey Demo</title>
</svelte:head>

<main style="padding: 24px;">
  <h1>Passkey Demo</h1>
  <p>Fetches registration options from a debug endpoint and runs <code>startRegistration</code>.</p>
  <div style="margin-top: 16px;">
    <button onclick={runDemo} disabled={loading}
      >{loading ? 'Running...' : 'Register Demo Passkey'}</button
    >
  </div>
  {#if message}
    <div style="margin-top: 12px;">Result: {message}</div>
  {/if}
</main>
