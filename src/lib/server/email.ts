export async function sendVerificationEmail(email, token, baseUrl) {
    console.log('📨 Email attempt', { email, baseUrl });

    if (dev) return true;

    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) throw new Error('Missing RESEND_API_KEY');

    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);

    const verifyUrl = `${baseUrl}/api/verify?token=${token}`;

    const result = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: 'Verify your account',
        html: getVerificationHtml(verifyUrl)
    });

    console.log('📤 Resend result:', result);
    return true;
}
