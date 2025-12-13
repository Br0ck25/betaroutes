// src/lib/server/email.ts
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { Resend } from 'resend';

// --- Email Template Helper ---
function getVerificationHtml(verifyUrl: string) {
    const brandColor = '#FF7F50';
    const accentColor = '#FF6A3D';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Verify your email</title>
</head>
<body style="margin:0;padding:0;font-family:Helvetica,Arial,sans-serif;background:#f9fafb;color:#111827;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
        <tr>
            <td align="center">
                <table width="100%" style="max-width:500px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
                    <tr>
                        <td style="padding:30px;text-align:center;">
                            <h1 style="margin:0;color:${brandColor};">Go Route Yourself</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:40px;">
                            <h2>Verify your email address</h2>
                            <p>Please confirm your email to activate your account.</p>
                            <div style="text-align:center;margin:32px 0;">
                                <a href="${verifyUrl}"
                                   style="background:${brandColor};color:#fff;padding:14px 32px;
                                   text-decoration:none;border-radius:8px;font-weight:600;">
                                    Verify Email
                                </a>
                            </div>
                            <p style="font-size:13px;">
                                Or copy this link:<br />
                                <a href="${verifyUrl}">${verifyUrl}</a>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px;text-align:center;font-size:12px;color:#9ca3af;">
                            © ${new Date().getFullYear()} Go Route Yourself
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
export async function sendVerificationEmail(
    email: string,
    token: string,
    baseUrl: string
): Promise<boolean> {
    const apiKey = env.RESEND_API_KEY;
    const verifyUrl = `${baseUrl}/api/verify?token=${token}`;

    // Dev: log only
    if (dev) {
        console.log('📧 DEV EMAIL');
        console.log('To:', email);
        console.log('Link:', verifyUrl);
        return true;
    }

    if (!apiKey) {
        console.error('❌ RESEND_API_KEY is missing at runtime');
        return false;
    }

    const resend = new Resend(apiKey);

    try {
        await resend.emails.send({
            // 🔴 Use this until your domain is verified
            from: 'Go Route Yourself <onboarding@resend.dev>',
            // Once verified, you can switch back:
            // from: 'Go Route Yourself <noreply@gorouteyourself.com>',

            to: email,
            subject: 'Verify your account',
            html: getVerificationHtml(verifyUrl)
        });

        return true;
    } catch (error) {
        console.error('❌ Resend send failed:', error);
        return false;
    }
}
