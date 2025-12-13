// src/lib/server/email.ts
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

// --- Email Template Helper ---
function getVerificationHtml(verifyUrl: string) {
    const brandColor = '#FF7F50';
    const accentColor = '#FF6A3D';

    return `
<!DOCTYPE html>
<html lang="en">
<body>
    <h2>Verify your email</h2>
    <p>Please verify your email by clicking the link below:</p>
    <a href="${verifyUrl}" style="color:${brandColor};font-weight:bold;">
        Verify Email
    </a>
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
    const verifyUrl = `${baseUrl}/api/verify?token=${token}`;

    // Dev mode: log only
    if (dev) {
        console.log('📧 DEV EMAIL');
        console.log('To:', email);
        console.log('Link:', verifyUrl);
        return true;
    }

    const apiKey = env.RESEND_API_KEY;

    if (!apiKey) {
        console.error('❌ RESEND_API_KEY missing at runtime');
        return false;
    }

    try {
        // ✅ Dynamic import (prevents Vite build crash)
        const { Resend } = await import('resend');

        const resend = new Resend(apiKey);

        await resend.emails.send({
            // Use this until domain is verified
            from: 'Go Route Yourself <onboarding@resend.dev>',
            // After verification:
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
