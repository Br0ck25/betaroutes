// src/lib/server/email.ts
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

// --- Email Template Helpers ---

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

function getContactInquiryHtml(data: { name: string; email: string; company?: string; message: string }) {
    const brandColor = '#FF7F50';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>New Sales Inquiry</title>
</head>
<body style="font-family: sans-serif; padding: 20px; color: #333;">
    <h1 style="color: ${brandColor};">New Sales Inquiry</h1>
    <p><strong>Name:</strong> ${data.name}</p>
    <p><strong>Email:</strong> ${data.email}</p>
    <p><strong>Company:</strong> ${data.company || 'N/A'}</p>
    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
    <h3 style="margin-bottom: 10px;">Message:</h3>
    <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-radius: 5px;">${data.message}</p>
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
    const logoUrl = `${baseUrl}/logo.png`;

    // 1. Dev Mode: Skip actual sending to save API credits and ease debugging
    if (dev) {
        console.log('\n================ [DEV EMAIL] ================');
        console.log(`To: ${email}`);
        console.log(`Subject: Verify your account`);
        console.log(`🔗 Link: ${verifyUrl}`);
        console.log(`🖼️ Logo: ${logoUrl}`);
        console.log('=============================================\n');
        return true;
    }

    // 2. Check for API key (from parameter in production, or env in traditional deployments)
    const resolvedApiKey = apiKey || env.RESEND_API_KEY;
    
    if (!resolvedApiKey) {
        console.error('❌ Missing RESEND_API_KEY - must be passed as parameter or in env');
        throw new Error('Email service not configured - RESEND_API_KEY missing');
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resolvedApiKey}`
            },
            body: JSON.stringify({
                from: 'Go Route Yourself <noreply@gorouteyourself.com>',
                to: email,
                subject: 'Verify your account',
                html: getVerificationHtml(verifyUrl, logoUrl)
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ Resend API Error:', res.status, errorText);
            throw new Error(`Resend API error: ${res.status} - ${errorText}`);
        }

        console.log('✅ Verification email sent successfully to', email);
        return true;
    } catch (e) {
        console.error('❌ Email send failed:', e);
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
    const logoUrl = `${baseUrl}/logo.png`;

    // 1. Dev Mode: Skip actual sending
    if (dev) {
        console.log('\n================ [DEV EMAIL] ================');
        console.log(`To: ${email}`);
        console.log(`Subject: Reset your password`);
        console.log(`🔗 Link: ${resetUrl}`);
        console.log(`🖼️ Logo: ${logoUrl}`);
        console.log('=============================================\n');
        return true;
    }

    // 2. Check for API key
    const resolvedApiKey = apiKey || env.RESEND_API_KEY;
    
    if (!resolvedApiKey) {
        console.error('❌ Missing RESEND_API_KEY - must be passed as parameter or in env');
        throw new Error('Email service not configured - RESEND_API_KEY missing');
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resolvedApiKey}`
            },
            body: JSON.stringify({
                from: 'Go Route Yourself <noreply@gorouteyourself.com>',
                to: email,
                subject: 'Reset your password',
                html: getPasswordResetHtml(resetUrl, logoUrl)
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ Resend API Error:', res.status, errorText);
            throw new Error(`Resend API error: ${res.status} - ${errorText}`);
        }

        console.log('✅ Password reset email sent successfully to', email);
        return true;
    } catch (e) {
        console.error('❌ Email send failed:', e);
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
        console.log('\n================ [DEV EMAIL] ================');
        console.log(`To: sales@gorouteyourself.com`);
        console.log(`Reply-To: ${data.email}`);
        console.log(`Subject: New Inquiry: ${data.company || data.name}`);
        console.log(`Message: ${data.message}`);
        console.log('=============================================\n');
        return true;
    }

    // 2. Check for API key
    const resolvedApiKey = apiKey || env.RESEND_API_KEY;
    
    if (!resolvedApiKey) {
        console.error('❌ Missing RESEND_API_KEY');
        throw new Error('Email service not configured');
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resolvedApiKey}`
            },
            body: JSON.stringify({
                from: 'Go Route Yourself Contact <noreply@gorouteyourself.com>',
                to: 'sales@gorouteyourself.com',
                reply_to: data.email,
                subject: `Inquiry from ${data.name} ${data.company ? `(${data.company})` : ''}`,
                html: getContactInquiryHtml(data)
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ Resend API Error:', res.status, errorText);
            throw new Error(`Resend API error: ${res.status} - ${errorText}`);
        }

        return true;
    } catch (e) {
        console.error('❌ Contact email send failed:', e);
        throw e;
    }
}