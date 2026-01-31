<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import CollapsibleCard from '$lib/components/ui/CollapsibleCard.svelte';
  import { auth, user } from '$lib/stores/auth';
  import { toasts } from '$lib/stores/toast';
  import { csrfFetch } from '$lib/utils/csrf';
  import { startRegistration } from '@simplewebauthn/browser';

  // Callback style pattern is preferred — use toasts for local success messages
  // and expose callbacks via $props() if consumers need them.
  const { onSuccess }: { onSuccess?: (msg: string) => void } = $props();

  // Password State
  let showPasswordChange = $state(false);
  let passwordData = $state({ current: '', new: '', confirm: '' });
  let passwordError = $state('');

  // Delete State
  let showDeleteConfirm = $state(false);
  let deletePassword = $state('');
  let deleteError = $state('');
  let isDeleting = $state(false);

  // WebAuthn State
  let registering = $state(false);
  let authenticatorsList: Array<Record<string, unknown>> = [];
  let deviceRegistered = $state(false);
  let deviceCredentialID: string | null = $state(null);
  let deviceName = $state('');
  let unregistering = $state(false);
  let sessionExpired = $state(false);
  let rememberThisDevice = $state(false);

  // Passkey Removal State (Sudo Mode)
  let showPasskeyRemoveConfirm = $state(false);
  let passkeyRemovePassword = $state('');
  let passkeyRemoveError = $state('');
  let pendingRemoveCredentialID: string | null = null;

  async function changePassword() {
    if (passwordData.new !== passwordData.confirm) {
      passwordError = 'Passwords do not match';
      return;
    }
    if (passwordData.new.length < 8) {
      passwordError = 'Password must be at least 8 characters';
      return;
    }

    try {
      const response = await csrfFetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordData.current,
          newPassword: passwordData.new
        })
      });
      let result: Record<string, unknown> = {};
      try {
        result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      } catch (_e) {
        result = {};
      }

      if (!response.ok) {
        passwordError =
          typeof result?.message === 'string'
            ? (result.message as string)
            : 'Failed to update password';
        return;
      }

      passwordError = '';
      showPasswordChange = false;
      passwordData = { current: '', new: '', confirm: '' };
      toasts.success('Password changed successfully');
      onSuccess?.('Password changed successfully');
    } catch (_e) {
      console.error(_e);
      passwordError = 'An unexpected network error occurred.';
    }
  }

  async function handleDeleteAccount() {
    if (!deletePassword) {
      deleteError = 'Please enter your password to confirm.';
      return;
    }

    if (
      !confirm(
        'FINAL WARNING: This will permanently delete your account and all data. This cannot be undone.'
      )
    ) {
      return;
    }

    isDeleting = true;
    try {
      const result = await auth.deleteAccount($user?.id || '', deletePassword);
      if (result.success) {
        await goto(resolve('/'));
      } else {
        deleteError = result.error || 'Failed to delete account';
        isDeleting = false;
      }
    } catch (_err) {
      deleteError = 'An unexpected error occurred';
      isDeleting = false;
    }
  }

  async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      await csrfFetch('/api/logout', { method: 'POST' });
      await auth.logout();
      await goto(resolve('/login'));
    }
  }

  // --- WebAuthn Logic ---

  function getDeviceName() {
    const uaData = (navigator as unknown as Record<string, unknown>)['userAgentData'] as
      | Record<string, unknown>
      | undefined;
    if (uaData && uaData.platform) {
      const brands = uaData['brands'] as Array<Record<string, unknown>> | undefined;
      const brand = (brands && brands[0] && (brands[0]['brand'] as string)) || 'Browser';
      return `${brand} on ${String(uaData.platform)}`;
    }
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'Android device';
    if (/Windows/i.test(ua)) return 'Windows device';
    if (/Mac|Macintosh/i.test(ua)) return 'Mac device';
    if (/iPhone|iPad/i.test(ua)) return 'iOS device';
    return 'Unknown device';
  }

  async function loadAuthenticators(opts: { silent?: boolean } = { silent: false }) {
    const silent = !!opts.silent;
    const maxAttempts = 5;
    let attempt = 0;

    const attemptFetch = async (): Promise<boolean> => {
      attempt += 1;
      try {
        const res = await fetch('/api/auth/webauthn/list', { credentials: 'same-origin' });
        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          const auths = (json?.authenticators ?? []) as Record<string, unknown>[];
          authenticatorsList = auths;
          const match = auths.find(
            (a) => String((a as Record<string, unknown>)['name']) === deviceName
          );
          if (match) {
            deviceRegistered = true;
            deviceCredentialID = (match as Record<string, unknown>)['credentialID'] as
              | string
              | null;
            try {
              const raw = localStorage.getItem('passkey:preferred');
              rememberThisDevice = raw
                ? JSON.parse(raw).credentialID === deviceCredentialID
                : false;
            } catch {
              rememberThisDevice = false;
            }
          } else {
            deviceRegistered = false;
            deviceCredentialID = null;
            rememberThisDevice = false;
          }
          sessionExpired = false;
          return true;
        }

        if (res.status === 401) {
          try {
            const s = await fetch('/api/auth/session', { credentials: 'same-origin' });
            if (s.ok) console.debug('[Passkey] Session endpoint OK; will retry list fetch');
          } catch {
            // ignore
          }
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 200 * attempt));
            return attemptFetch();
          }

          authenticatorsList = [];
          deviceRegistered = false;
          deviceCredentialID = null;
          if (!silent) sessionExpired = true;
          return false;
        }
        return false;
      } catch {
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 200 * attempt));
          return attemptFetch();
        }
        authenticatorsList = [];
        deviceRegistered = false;
        deviceCredentialID = null;
        if (!silent) sessionExpired = true;
        return false;
      }
    };
    await attemptFetch();
  }

  async function unregisterThisDevice() {
    if (!deviceCredentialID) return;
    // Show sudo mode confirmation dialog instead of browser confirm
    pendingRemoveCredentialID = deviceCredentialID;
    passkeyRemovePassword = '';
    passkeyRemoveError = '';
    showPasskeyRemoveConfirm = true;
  }

  async function confirmPasskeyRemoval() {
    if (!pendingRemoveCredentialID) return;
    if (!passkeyRemovePassword) {
      passkeyRemoveError = 'Please enter your password to confirm.';
      return;
    }

    unregistering = true;
    passkeyRemoveError = '';
    try {
      const res = await csrfFetch('/api/auth/webauthn/delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentialID: pendingRemoveCredentialID,
          password: passkeyRemovePassword
        })
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        if (res.status === 401) {
          if (json?.error === 'Invalid password') {
            passkeyRemoveError = 'Incorrect password. Please try again.';
            return;
          }
          sessionExpired = true;
          toasts.error('Session expired. Please reload or sign in again.');
          return;
        }
        if (res.status === 403 && json?.requiresPassword) {
          passkeyRemoveError = 'Password is required to remove passkeys.';
          return;
        }
        const errMsg =
          typeof (json as Record<string, unknown>)?.error === 'string'
            ? (json as Record<string, unknown>).error
            : 'Failed to unregister';
        throw new Error(String(errMsg));
      }

      sessionExpired = false;
      showPasskeyRemoveConfirm = false;
      passkeyRemovePassword = '';
      pendingRemoveCredentialID = null;
      toasts.success('This device was unregistered');
      onSuccess?.('This device was unregistered');

      try {
        const raw = localStorage.getItem('passkey:preferred');
        if (raw && JSON.parse(raw).credentialID === deviceCredentialID) {
          localStorage.removeItem('passkey:preferred');
          rememberThisDevice = false;
          toasts.info('Quick sign-in preference removed for this device');
        }
      } catch (_e) {
        void _e; // ignore localStorage errors
      }

      deviceRegistered = false;
      deviceCredentialID = null;
      await loadAuthenticators();
    } catch (err) {
      console.error('[Passkey] Unregister failed', err);
      passkeyRemoveError = 'Failed to unregister this device.';
    } finally {
      unregistering = false;
    }
  }

  function cancelPasskeyRemoval() {
    showPasskeyRemoveConfirm = false;
    passkeyRemovePassword = '';
    passkeyRemoveError = '';
    pendingRemoveCredentialID = null;
  }

  async function registerPasskey() {
    registering = true;
    try {
      await loadAuthenticators({ silent: true });
      const optionsRes = await fetch('/api/auth/webauthn?type=register', {
        credentials: 'same-origin'
      });
      if (optionsRes.status === 401) {
        sessionExpired = true;
        throw new Error('Session expired while fetching registration options');
      } else {
        sessionExpired = false;
      }

      const rawText = await optionsRes.text();
      let optionsJson: unknown;
      try {
        optionsJson = JSON.parse(rawText);
      } catch (_e) {
        throw new Error('Invalid registration options response');
      }
      if (!optionsRes.ok)
        throw new Error(
          ((optionsJson as Record<string, unknown>)?.error as string) ||
            'Failed to get registration options'
        );

      const options = optionsJson as Record<string, unknown>;
      // Keep compatibility for older platforms that might send buffers
      if (
        options.user &&
        (options.user as Record<string, unknown>).id &&
        typeof (options.user as Record<string, unknown>).id !== 'string'
      ) {
        // Convert buffer to base64url if needed
      }

      // Cast to a minimal runtime-compatible shape for startRegistration; validate at runtime where necessary
      type PKCreOptionsLike = {
        rp: { name: string } & Record<string, unknown>;
        user: { id: string | number | unknown; name?: string; displayName?: string } & Record<
          string,
          unknown
        >;
        challenge: unknown;
        pubKeyCredParams: unknown[];
      } & Record<string, unknown>;

      // Use an unknown-typed alias to avoid tight external lib typings until runtime validation is enforced
      const _startRegistration = startRegistration as unknown as (
        opts: unknown
      ) => Promise<unknown>;
      const credential = await _startRegistration({ optionsJSON: options as unknown });

      const verifyRes = await csrfFetch('/api/auth/webauthn?type=register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, deviceName })
      });

      const verifyResult = (await verifyRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!verifyRes.ok) throw new Error((verifyResult.error as string) || 'Registration failed');

      toasts.success(
        'Passkey registered successfully! You can now sign in with your fingerprint or face.'
      );
      onSuccess?.(
        'Passkey registered successfully! You can now sign in with your fingerprint or face.'
      );

      if (verifyResult?.authenticator && typeof verifyResult.authenticator === 'object') {
        const authObj = verifyResult.authenticator as Record<string, unknown>;
        authenticatorsList = [...(authenticatorsList || []), authObj];
        if (typeof authObj.name === 'string' && authObj.name === deviceName) {
          deviceRegistered = true;
          deviceCredentialID = (authObj.credentialID as string) || null;
        }
      } else {
        await loadAuthenticators();
      }
    } catch (error: unknown) {
      console.error('[Passkey] Registration error:', error);
      let message = 'Failed to register passkey';
      if (typeof error === 'object' && error !== null) {
        const e = error as { name?: unknown; message?: unknown };
        if (typeof e.name === 'string') {
          if (e.name === 'NotAllowedError') message = 'Registration was cancelled or timed out';
          else if (e.name === 'NotSupportedError')
            message = 'Your device does not support passkeys';
        }
        if (typeof e.message === 'string') message = e.message;
      }
      toasts.error(message);
    } finally {
      registering = false;
    }
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    void (async () => {
      deviceName = getDeviceName();
      // Simple session check before loading
      try {
        const s = await fetch('/api/auth/session', { credentials: 'same-origin' });
        if (s.ok) await loadAuthenticators();
        else sessionExpired = true;
      } catch {
        // Network error during session check — mark session expired so UI can prompt re-auth
        sessionExpired = true;
      }
    })();
  });
</script>

<div class="card-stack">
  <CollapsibleCard
    title="Security"
    subtitle="Password and authentication"
    storageKey="settings:security"
  >
    {#snippet icon()}
      <span>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M15 7H14V5C14 3.67392 13.4732 2.40215 12.5355 1.46447C11.5979 0.526784 10.3261 0 9 0C7.67392 0 6.40215 0.526784 5.46447 1.46447C4.52678 2.40215 4 3.67392 4 5V7H3C2.46957 7 1.96086 7.21071 1.58579 7.58579C1.21071 7.96086 1 8.46957 1 9V17C1 17.5304 1.21071 18.0391 1.58579 18.4142C1.96086 18.7893 2.46957 19 3 19H15C15.5304 19 16.0391 18.7893 16.4142 18.4142C16.7893 18.0391 17 17.5304 17 17V9C17 8.46957 16.7893 7.96086 16.4142 7.58579C16.0391 7.21071 15.5304 7 15 7ZM6 5C6 4.20435 6.31607 3.44129 6.87868 2.87868C7.44129 2.31607 8.20435 2 9 2C9.79565 2 10.5587 2.31607 11.1213 2.87868C11.6839 3.44129 12 4.20435 12 5V7H6V5Z"
            fill="currentColor"
          />
        </svg>
      </span>
    {/snippet}

    {#if !showPasswordChange}
      <button class="btn-secondary" onclick={() => (showPasswordChange = true)}
        >Change Password</button
      >
    {:else}
      <div class="password-change">
        {#if passwordError}<div class="alert error">{passwordError}</div>{/if}
        <div class="form-group">
          <label for="curr-pass">Current Password</label><input
            id="curr-pass"
            type="password"
            bind:value={passwordData.current}
          />
        </div>
        <div class="form-group">
          <label for="new-pass">New Password</label><input
            id="new-pass"
            type="password"
            bind:value={passwordData.new}
          />
        </div>
        <div class="form-group">
          <label for="confirm-pass">Confirm New Password</label><input
            id="confirm-pass"
            type="password"
            bind:value={passwordData.confirm}
          />
        </div>
        <div class="button-group">
          <button class="btn-primary" onclick={changePassword}>Update</button>
          <button class="btn-secondary" onclick={() => (showPasswordChange = false)}>Cancel</button>
        </div>
      </div>
    {/if}

    <div class="divider"></div>

    <div class="passkey-section">
      <div>
        <h3 style="font-size: 15px; font-weight: 600; color: #111827; margin-bottom: 4px;">
          Biometric Login
        </h3>
        <p style="font-size: 13px; color: #6B7280; margin-bottom: 12px;">
          Enable Face ID or Touch ID for faster login.
        </p>
        <p style="font-size: 12px; color: #6B7280; margin-top: 6px;">
          This device: <strong>{deviceName}</strong>{#if deviceRegistered}
            — <em>Registered</em>{/if}
        </p>
        {#if sessionExpired}
          <div class="alert warning" style="margin-top:8px;">
            Your session may have expired. <button class="linkish" onclick={() => location.reload()}
              >Reload</button
            >
            or <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- using local resolve() helper (base-aware) -->
            <a href={resolve('/logout')}>sign in</a> again to manage passkeys.
          </div>
        {/if}
      </div>

      {#if deviceRegistered}
        <button
          class="btn-secondary"
          onclick={unregisterThisDevice}
          disabled={unregistering || showPasskeyRemoveConfirm}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            style="margin-right: 8px;"
          >
            <path d="M3 6h18M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 11v6M14 11v6M9 6V4h6v2" />
          </svg>
          {unregistering ? 'Unregistering...' : 'Unregister This Device'}
        </button>

        {#if showPasskeyRemoveConfirm}
          <div class="delete-confirmation" style="margin-top: 12px;">
            <p class="delete-warning">To confirm passkey removal, please enter your password:</p>
            <input
              type="password"
              bind:value={passkeyRemovePassword}
              placeholder="Enter your password"
              class="delete-input"
            />
            {#if passkeyRemoveError}<p class="error-text">{passkeyRemoveError}</p>{/if}

            <div class="button-group">
              <button
                class="btn-delete-confirm"
                onclick={confirmPasskeyRemoval}
                disabled={unregistering}
              >
                {unregistering ? 'Removing...' : 'Confirm Removal'}
              </button>
              <button class="btn-secondary" onclick={cancelPasskeyRemoval} disabled={unregistering}
                >Cancel</button
              >
            </div>
          </div>
        {/if}

        <div style="margin-top: 8px; display:flex; align-items:center; gap:10px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#374151;">
            <input
              type="checkbox"
              bind:checked={rememberThisDevice}
              onchange={() => {
                if (rememberThisDevice && deviceCredentialID) {
                  localStorage.setItem(
                    'passkey:preferred',
                    JSON.stringify({ credentialID: deviceCredentialID, name: deviceName })
                  );
                  toasts.success('Quick sign-in enabled on this device');
                } else {
                  localStorage.removeItem('passkey:preferred');
                  toasts.success('Quick sign-in disabled on this device');
                }
              }}
            />
            Remember this device for quick sign-in
          </label>
        </div>
      {:else}
        <button class="btn-secondary" onclick={registerPasskey} disabled={registering}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            style="margin-right: 8px;"
          >
            <path
              d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
            />
          </svg>
          {registering ? 'Registering...' : 'Register Device'}
        </button>
      {/if}
    </div>
  </CollapsibleCard>

  <CollapsibleCard
    title="Account Actions"
    subtitle="Sign out or delete account"
    storageKey="settings:account-actions"
  >
    {#snippet icon()}
      <span>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M7 17H3C2.46957 17 1.96086 16.7893 1.58579 16.4142C1.21071 16.0391 1 15.5304 1 15V3C1 2.46957 1.21071 1.96086 1.58579 1.58579C1.96086 1.21071 2.46957 1 3 1H7M13 13L17 9M17 9L13 5M17 9H7"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    {/snippet}
    <div>
      <h2 class="card-title">Account Actions</h2>
      <p class="card-subtitle">Sign out or delete account</p>
    </div>

    <div class="danger-actions">
      <button class="btn-logout" onclick={handleLogout}>Logout</button>

      {#if !showDeleteConfirm}
        <button class="btn-delete" onclick={() => (showDeleteConfirm = true)}>Delete Account</button
        >
      {:else}
        <div class="delete-confirmation">
          <p class="delete-warning">To verify, please enter your password:</p>
          <input
            type="password"
            bind:value={deletePassword}
            placeholder="Enter your password"
            class="delete-input"
          />
          {#if deleteError}<p class="error-text">{deleteError}</p>{/if}

          <div class="button-group">
            <button class="btn-delete-confirm" onclick={handleDeleteAccount} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Permanently Delete Account'}
            </button>
            <button
              class="btn-secondary"
              onclick={() => {
                showDeleteConfirm = false;
                deletePassword = '';
                deleteError = '';
              }}>Cancel</button
            >
          </div>
        </div>
      {/if}
    </div>
  </CollapsibleCard>
</div>

<style>
  .card-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 4px;
  }
  .card-subtitle {
    font-size: 14px;
    color: #6b7280;
  }
  .form-group {
    margin-bottom: 20px;
  }
  .form-group label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 8px;
  }
  .form-group input {
    width: 100%;
    max-width: 450px;
    padding: 12px 16px;
    border: 2px solid #e5e7eb;
    border-radius: 10px;
    font-size: 16px;
    display: block;
    box-sizing: border-box;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--orange, #ff6a3d) 0%, #ff6a3d 100%);
    color: white;
    border: none;
    width: 100%;
    padding: 14px;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-secondary {
    background: white;
    color: #374151;
    border: 2px solid #e5e7eb;
    width: 100%;
    padding: 14px;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-logout {
    background: white;
    color: #dc2626;
    border: 2px solid #fee2e2;
    width: 100%;
    padding: 14px;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-delete {
    background: transparent;
    color: #dc2626;
    border: none;
    margin-top: 12px;
    font-size: 14px;
    text-decoration: underline;
    cursor: pointer;
  }
  .delete-confirmation {
    margin-top: 16px;
    padding: 16px;
    background: white;
    border-radius: 10px;
    border: 1px solid #fecaca;
  }
  .delete-input {
    width: 100%;
    padding: 10px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .btn-delete-confirm {
    background: #dc2626;
    color: white;
    border: none;
    margin-bottom: 8px;
    width: 100%;
    padding: 14px;
    border-radius: 10px;
    font-weight: 600;
  }
  .alert {
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 24px;
  }
  .alert.error {
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }
  .alert.warning {
    background: #fff7ed;
    color: #c2410c;
    border: 1px solid #fed7aa;
  }
  .card-stack {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .divider {
    height: 1px;
    background: #e5e7eb;
    margin: 24px 0;
  }
  .button-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .linkish {
    background: none;
    border: none;
    color: var(--orange, #ff6a3d);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    font: inherit;
  }
</style>
