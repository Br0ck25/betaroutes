// src/lib/server/email.ts
// [!code fix] Change static import to dynamic to prevent build crashes
import { env } from '$env/dynamic/private'; 
import { dev } from '$app/environment';

// --- Email Template Helper ---
function getVerificationHtml(verifyUrl: string) {
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
                            <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: ${brandColor}; letter-spacing: -0.5px;">
                                Go Route Yourself
                            </h1>
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

// --- Main Send Function ---
export async function sendVerificationEmail(email: string, token: string, baseUrl: string) {
    const verifyUrl = `${baseUrl}/api/verify?token=${token}`;
    
    // [!code fix] Access the key safely via the 'env' object
    const apiKey = env.RESEND_API_KEY;

    // 1. Dev Mode: Skip actual sending to save API credits and ease debugging
    if (dev) {
        console.log('\n================ [DEV EMAIL] ================');
        console.log(`To: ${email}`);
        console.log(`Subject: Verify your account`);
        console.log(`🔗 Link: ${verifyUrl}`);
        console.log('=============================================\n');
        return true;
    }

    if (!apiKey) {
        console.error('❌ Missing RESEND_API_KEY env variable');
        // We return false here, which will cause the registration endpoint to fail gracefully
        return false;
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}` // [!code fix] Use the dynamic variable
            },
            body: JSON.stringify({
                from: 'Go Route Yourself <noreply@gorouteyourself.com>',
                to: email,
                subject: 'Verify your account',
                html: getVerificationHtml(verifyUrl)
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('❌ Resend API Error:', errorText);
            return false;
        }

        return true;
    } catch (e) {
        console.error('❌ Email send failed:', e);
        return false;
    }
}