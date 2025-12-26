<script lang="ts">
  import { startRegistration } from '@simplewebauthn/browser';
  let message = '';
  let loading = false;

  async function runDemo() {
    loading = true;
    message = '';
    try {
      const res = await fetch('/debug/webauthn-test');
      if (!res.ok) throw new Error('Failed to get options');
      const data = await res.json();
      const options = data.full;

      // Ensure challenge is string
      if (options.challenge && typeof options.challenge !== 'string') {
        const bytes = new Uint8Array(options.challenge);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(Number(bytes[i] ?? 0));
        options.challenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }

      // Call startRegistration
      const cred = await startRegistration({ optionsJSON: options as any });
      console.log('Demo credential:', cred);

      // Normalize ArrayBuffer fields to base64url strings
      function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(Number(bytes[i] ?? 0));
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }

      const normalised: any = { ...cred } as any;
      if (normalised.rawId && (normalised.rawId instanceof ArrayBuffer || ArrayBuffer.isView(normalised.rawId))) {
        normalised.rawId = bufferToBase64Url(normalised.rawId as ArrayBuffer);
      }
      const resp = normalised.response || {};
      if (resp.attestationObject && (resp.attestationObject instanceof ArrayBuffer || ArrayBuffer.isView(resp.attestationObject))) resp.attestationObject = bufferToBase64Url(resp.attestationObject);
      if (resp.clientDataJSON && (resp.clientDataJSON instanceof ArrayBuffer || ArrayBuffer.isView(resp.clientDataJSON))) resp.clientDataJSON = bufferToBase64Url(resp.clientDataJSON);

      // POST to verification endpoint
      try {
// Compute device name to send to server (prefill using UA info)
      function getDeviceName() {
        const uaData = (navigator as any).userAgentData;
        if (uaData && uaData.platform) {
          const brand = (uaData.brands && uaData.brands[0] && uaData.brands[0].brand) || 'Browser';
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

        const verifyJson = await verifyRes.json();
        if (verifyRes.ok && verifyJson.verified) {
          message = 'Registered and verified by server';
        } else {
          message = 'Server verification failed: ' + (verifyJson.error || JSON.stringify(verifyJson));
        }
      } catch (err: any) {
        console.error('Verification POST error', err);
        message = 'Verification POST failed: ' + (err?.message || String(err));
      }
    } catch (err: any) {
      console.error('Demo error', err);
      message = err?.message || String(err);
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
    <button on:click={runDemo} disabled={loading}>{loading ? 'Running...' : 'Register Demo Passkey'}</button>
  </div>
  {#if message}
    <div style="margin-top: 12px;">Result: {message}</div>
  {/if}
</main>