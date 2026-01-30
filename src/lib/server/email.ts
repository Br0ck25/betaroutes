// src/lib/server/email.ts
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';

// --- Security Helpers ---

/**
 * Escape HTML special characters to prevent XSS
 * SECURITY: Always use this when interpolating user input into HTML
 */
function escapeHtml(unsafe: string | undefined | null): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Email Template Helpers ---

/**
 * Generate plaintext version of verification email
 * DELIVERABILITY: Helps avoid spam filters that flag HTML-only emails
 */
function getVerificationPlaintext(verifyUrl: string): string {
  return `Verify your email address

Thanks for starting your registration with Go Route Yourself! We just need to verify that this email address belongs to you to activate your account.

Click the link below to verify your email:
${verifyUrl}

If you didn't create an account, you can safely ignore this email.

© ${new Date().getFullYear()} Go Route Yourself
`;
}

function getVerificationHtml(verifyUrl: string, logoUrl: string) {
  const brandColor = '#FF7F50';
  const accentColor = '#FF6A3D';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify your email</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f9fafb; color: #111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f9fafb; width: 100%; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 500px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <tr>
                        <td style="padding: 30px 40px; text-align: center; border-bottom: 1px solid #f3f4f6;">
                            <img src="${logoUrl}" alt="Go Route Yourself" width="180" style="display: block; margin: 0 auto; max-width: 100%; height: auto; border: 0;" />
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px 40px 30px 40px;">
                            <h2 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #111827;">
                                Verify your email address
                            </h2>
                            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #4b5563;">
                                Thanks for starting your registration! We just need to verify that this email address belongs to you to activate your account.
                            </p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td align="center" style="padding: 12px 0 32px 0;">
                                        <a href="${verifyUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; background: ${brandColor}; background: linear-gradient(135deg, ${brandColor} 0%, ${accentColor} 100%); border-radius: 8px; box-shadow: 0 2px 4px rgba(255, 127, 80, 0.2);">
                                            Verify Email
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0; font-size: 14px; line-height: 22px; color: #6b7280;">
                                <span style="display: block; font-weight: 600; color: #374151; margin-bottom: 4px;">Link not working?</span>
                                Copy and paste this URL into your browser:
                                <br/>
                                <a href="${verifyUrl}" style="color: ${brandColor}; text-decoration: underline; word-break: break-all; font-size: 13px;">${verifyUrl}</a>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #f3f4f6;">
                            <p style="margin: 0; font-size: 12px; line-height: 18px; color: #9ca3af;">
                                If you didn't create an account, you can safely ignore this email.
                                <br/><br/>
                                © ${new Date().getFullYear()} Go Route Yourself
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}

/**
 * Generate plaintext version of password reset email
 * DELIVERABILITY: Helps avoid spam filters that flag HTML-only emails
 */
function getPasswordResetPlaintext(resetUrl: string): string {
  return `Reset your password

You requested to reset your password for Go Route Yourself. Click the link below to set a new one:

${resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email.

© ${new Date().getFullYear()} Go Route Yourself
`;
}

function getPasswordResetHtml(resetUrl: string, logoUrl: string) {
  const brandColor = '#FF7F50';
  const accentColor = '#FF6A3D';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset your password</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f9fafb; color: #111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f9fafb; width: 100%; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 500px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <tr>
                        <td style="padding: 30px 40px; text-align: center; border-bottom: 1px solid #f3f4f6;">
                            <img src="${logoUrl}" alt="Go Route Yourself" width="180" style="display: block; margin: 0 auto; max-width: 100%; height: auto; border: 0;" />
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px 40px 30px 40px;">
                            <h2 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #111827;">
                                Reset your password
                            </h2>
                            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #4b5563;">
                                You requested to reset your password. Click the button below to set a new one.
                            </p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td align="center" style="padding: 12px 0 32px 0;">
                                        <a href="${resetUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; background: ${brandColor}; background: linear-gradient(135deg, ${brandColor} 0%, ${accentColor} 100%); border-radius: 8px; box-shadow: 0 2px 4px rgba(255, 127, 80, 0.2);">
                                            Reset Password
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0; font-size: 14px; line-height: 22px; color: #6b7280;">
                                <span style="display: block; font-weight: 600; color: #374151; margin-bottom: 4px;">Link not working?</span>
                                Copy and paste this URL into your browser:
                                <br/>
                                <a href="${resetUrl}" style="color: ${brandColor}; text-decoration: underline; word-break: break-all; font-size: 13px;">${resetUrl}</a>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #f3f4f6;">
                            <p style="margin: 0; font-size: 12px; line-height: 18px; color: #9ca3af;">
                                If you didn't request a password reset, you can safely ignore this email.
                                <br/><br/>
                                © ${new Date().getFullYear()} Go Route Yourself
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}

/**
 * Generate plaintext version of contact inquiry email
 * DELIVERABILITY: Helps avoid spam filters that flag HTML-only emails
 */
function getContactInquiryPlaintext(data: {
  name: string;
  email: string;
  company?: string;
  message: string;
}): string {
  return `New Sales Inquiry

Name: ${data.name}
Email: ${data.email}
Company: ${data.company || 'N/A'}

Message:
${data.message}

---
This inquiry was submitted via the Go Route Yourself contact form.
`;
}

function getContactInquiryHtml(data: {
  name: string;
  email: string;
  company?: string;
  message: string;
}) {
  const brandColor = '#FF7F50';

  // SECURITY: Escape all user-provided data to prevent XSS
  const safeName = escapeHtml(data.name);
  const safeEmail = escapeHtml(data.email);
  const safeCompany = escapeHtml(data.company);
  const safeMessage = escapeHtml(data.message);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>New Sales Inquiry</title>
</head>
<body style="font-family: sans-serif; padding: 20px; color: #333;">
    <h1 style="color: ${brandColor};">New Sales Inquiry</h1>
    <p><strong>Name:</strong> ${safeName}</p>
    <p><strong>Email:</strong> ${safeEmail}</p>
    <p><strong>Company:</strong> ${safeCompany || 'N/A'}</p>
    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
    <h3 style="margin-bottom: 10px;">Message:</h3>
    <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-radius: 5px;">${safeMessage}</p>
</body>
</html>
    `;
}

// --- Main Send Functions ---

/**
 * Send verification email
 * @param email - Recipient email address
 * @param token - Verification token
 * @param baseUrl - Base URL for verification link
 * @param apiKey - Resend API key (REQUIRED in Cloudflare Workers - pass from platform.env)
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
  baseUrl: string,
  apiKey?: string
) {
  const verifyUrl = `${baseUrl}/api/verify?token=${token}`;
  const logoUrl = `${baseUrl}/180x75.avif`;

  // 1. Dev Mode: Skip actual sending to save API credits and ease debugging
  if (dev) {
    log.debug('\n================ [DEV EMAIL] ================');
    log.debug('dev-email:verify', { email, verifyUrl, logoUrl });
    log.debug('=============================================');
    return true;
  }

  // 2. Check for API key (from parameter in production, or env in traditional deployments)
  const resolvedApiKey = apiKey || env['RESEND_API_KEY'];

  if (!resolvedApiKey) {
    log.error('Missing RESEND_API_KEY - email service not configured');
    throw new Error('Email service not configured - RESEND_API_KEY missing');
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`
      },
      body: JSON.stringify({
        from: 'Go Route Yourself <noreply@gorouteyourself.com>',
        to: email,
        subject: 'Verify your account',
        html: getVerificationHtml(verifyUrl, logoUrl),
        text: getVerificationPlaintext(verifyUrl) // DELIVERABILITY: Plaintext alternative
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      log.error('❌ Resend API Error', { status: res.status, errorText });
      throw new Error(`Resend API error: ${res.status} - ${errorText}`);
    }

    log.debug('✅ Verification email sent successfully to', email);
    return true;
  } catch (e: unknown) {
    log.error('❌ Email send failed', { message: createSafeErrorMessage(e) });
    throw e; // Re-throw so caller can handle
  }
}

/**
 * Send password reset email
 * @param email - Recipient email address
 * @param token - Reset token
 * @param baseUrl - Base URL for reset link
 * @param apiKey - Resend API key (REQUIRED in Cloudflare Workers - pass from platform.env)
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string,
  baseUrl: string,
  apiKey?: string
) {
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  const logoUrl = `${baseUrl}/180x75.avif`;

  // 1. Dev Mode: Skip actual sending
  if (dev) {
    log.debug('\n================ [DEV EMAIL] ================');
    log.debug('dev-email:reset', { email, resetUrl, logoUrl });
    log.debug('=============================================\n');
    return true;
  }

  // 2. Check for API key
  const resolvedApiKey = apiKey || env['RESEND_API_KEY'];

  if (!resolvedApiKey) {
    log.error('❌ Missing RESEND_API_KEY - must be passed as parameter or in env');
    throw new Error('Email service not configured - RESEND_API_KEY missing');
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`
      },
      body: JSON.stringify({
        from: 'Go Route Yourself <noreply@gorouteyourself.com>',
        to: email,
        subject: 'Reset your password',
        html: getPasswordResetHtml(resetUrl, logoUrl),
        text: getPasswordResetPlaintext(resetUrl) // DELIVERABILITY: Plaintext alternative
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      log.error('Resend API error', { status: res.status, errorText });
      throw new Error(`Resend API error: ${res.status} - ${errorText}`);
    }

    log.info('Password reset email sent', { email });
    return true;
  } catch (e: unknown) {
    log.error('❌ Email send failed', { message: createSafeErrorMessage(e) });
    throw e; // Re-throw so caller can handle
  }
}

/**
 * Send contact form inquiry to sales
 * @param data - The form data object
 * @param apiKey - Resend API key
 */
export async function sendContactInquiryEmail(
  data: { name: string; email: string; company?: string; message: string },
  apiKey?: string
) {
  // 1. Dev Mode
  if (dev) {
    log.debug('\n================ [DEV EMAIL] ================');
    log.debug('dev-email:contact', {
      to: 'sales@gorouteyourself.com',
      replyTo: data.email,
      subject: `New Inquiry: ${data.company || data.name}`,
      message: data.message
    });
    log.debug('=============================================\n');
    return true;
  }

  // 2. Check for API key
  const resolvedApiKey = apiKey || env['RESEND_API_KEY'];

  if (!resolvedApiKey) {
    log.error('Missing RESEND_API_KEY - email service not configured');
    throw new Error('Email service not configured');
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`
      },
      body: JSON.stringify({
        from: 'Go Route Yourself Contact <noreply@gorouteyourself.com>',
        to: 'sales@gorouteyourself.com',
        reply_to: data.email,
        subject: `Inquiry from ${data.name} ${data.company ? `(${data.company})` : ''}`,
        html: getContactInquiryHtml(data),
        text: getContactInquiryPlaintext(data) // DELIVERABILITY: Plaintext alternative
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      log.error('❌ Resend API Error:', res.status, errorText);
      throw new Error(`Resend API error: ${res.status} - ${errorText}`);
    }

    return true;
  } catch (e) {
    log.error('❌ Contact email send failed:', e);
    throw e;
  }
}

// --- Security Alert Email ---

type SecurityAlertType = 'password_changed' | 'passkey_added' | 'passkey_removed' | 'email_changed';

function getSecurityAlertSubject(alertType: SecurityAlertType): string {
  switch (alertType) {
    case 'password_changed':
      return 'Your password was changed';
    case 'passkey_added':
      return 'A new passkey was added to your account';
    case 'passkey_removed':
      return 'A passkey was removed from your account';
    case 'email_changed':
      return 'Your email address was changed';
  }
}

function getSecurityAlertMessage(alertType: SecurityAlertType): string {
  switch (alertType) {
    case 'password_changed':
      return 'Your password was successfully changed.';
    case 'passkey_added':
      return 'A new passkey was added to your account.';
    case 'passkey_removed':
      return 'A passkey was removed from your account.';
    case 'email_changed':
      return 'Your email address was changed.';
  }
}

function getSecurityAlertPlaintext(alertType: SecurityAlertType, timestamp: string): string {
  const subject = getSecurityAlertSubject(alertType);
  const message = getSecurityAlertMessage(alertType);

  return `Security Alert: ${subject}

${message}

This change was made on ${timestamp}.

If you did not make this change, please take immediate action:
1. Change your password immediately
2. Review your account security settings
3. Contact support if you need assistance

If you made this change, you can ignore this email.

© ${new Date().getFullYear()} Go Route Yourself
`;
}

function getSecurityAlertHtml(alertType: SecurityAlertType, timestamp: string, logoUrl: string) {
  const subject = getSecurityAlertSubject(alertType);
  const message = getSecurityAlertMessage(alertType);
  const warningColor = '#dc2626';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Alert</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f9fafb; color: #111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f9fafb; width: 100%; padding: 40px 0;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 500px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <tr>
                        <td style="padding: 30px 40px; text-align: center; border-bottom: 1px solid #f3f4f6;">
                            <img src="${logoUrl}" alt="Go Route Yourself" width="180" style="display: block; margin: 0 auto; max-width: 100%; height: auto; border: 0;" />
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px 40px 30px 40px;">
                            <h2 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #111827;">
                                🔒 Security Alert
                            </h2>
                            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 24px; color: #111827; font-weight: 600;">
                                ${escapeHtml(subject)}
                            </p>
                            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #4b5563;">
                                ${escapeHtml(message)}
                            </p>
                            <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 22px; color: #6b7280;">
                                This change was made on <strong>${escapeHtml(timestamp)}</strong>.
                            </p>
                            <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                                <p style="margin: 0; font-size: 14px; line-height: 22px; color: ${warningColor};">
                                    <strong>If you did not make this change:</strong>
                                </p>
                                <ol style="margin: 12px 0 0 0; padding-left: 20px; font-size: 14px; line-height: 22px; color: #7f1d1d;">
                                    <li>Change your password immediately</li>
                                    <li>Review your account security settings</li>
                                    <li>Contact support if you need assistance</li>
                                </ol>
                            </div>
                            <p style="margin: 0; font-size: 14px; line-height: 22px; color: #6b7280;">
                                If you made this change, you can safely ignore this email.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #f3f4f6;">
                            <p style="margin: 0; font-size: 12px; line-height: 18px; color: #9ca3af;">
                                This is an automated security notification.
                                <br/><br/>
                                © ${new Date().getFullYear()} Go Route Yourself
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;
}

/**
 * Send a security alert email when sensitive account changes occur
 * SECURITY: Notifies users of password/passkey/email changes to detect unauthorized access
 *
 * @param email - The user's email address
 * @param alertType - The type of security event
 * @param apiKey - Optional Resend API key override
 * @returns boolean indicating success
 */
export async function sendSecurityAlertEmail(
  email: string,
  alertType: SecurityAlertType,
  apiKey?: string
): Promise<boolean> {
  const timestamp = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const logoUrl = 'https://gorouteyourself.com/optimized/logo-192.avif';
  const subject = `Security Alert: ${getSecurityAlertSubject(alertType)}`;

  // 1. Dev Mode
  if (dev) {
    log.debug('\n================ [DEV EMAIL] ================');
    log.debug('dev-email:security-alert', {
      to: email,
      subject,
      alertType,
      timestamp
    });
    log.debug('=============================================\n');
    return true;
  }

  // 2. Check for API key
  const resolvedApiKey = apiKey || env['RESEND_API_KEY'];

  if (!resolvedApiKey) {
    log.error('Missing RESEND_API_KEY - email service not configured');
    // Don't throw - security alerts are best-effort, shouldn't block the action
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`
      },
      body: JSON.stringify({
        from: 'Go Route Yourself Security <noreply@gorouteyourself.com>',
        to: email,
        subject,
        html: getSecurityAlertHtml(alertType, timestamp, logoUrl),
        text: getSecurityAlertPlaintext(alertType, timestamp)
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      log.error('❌ Security alert email failed:', res.status, errorText);
      // Don't throw - security alerts are best-effort
      return false;
    }

    log.info('[SecurityAlert] Email sent', { alertType, email: email.slice(0, 3) + '***' });
    return true;
  } catch (e) {
    log.error('❌ Security alert email send failed:', e);
    // Don't throw - security alerts are best-effort
    return false;
  }
}
