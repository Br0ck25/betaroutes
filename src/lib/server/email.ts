// src/lib/server/email.ts
import { RESEND_API_KEY } from '$env/static/private';
import { dev } from '$app/environment';

export async function sendVerificationEmail(email: string, token: string, baseUrl: string) {
    const verifyUrl = `${baseUrl}/api/verify?token=${token}`;

    if (dev) {
        console.log('📧 [DEV] Skipping Email. Link:', verifyUrl);
        return true;
    }

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RESEND_API_KEY}`
            },
            body: JSON.stringify({
                from: 'Go Route Yourself <onboarding@resend.dev>', // Update with your domain later
                to: email,
                subject: 'Verify your account',
                html: `<p>Click here to verify: <a href="${verifyUrl}">${verifyUrl}</a></p>`
            })
        });
        return res.ok;
    } catch (e) {
        console.error(e);
        return false;
    }
}