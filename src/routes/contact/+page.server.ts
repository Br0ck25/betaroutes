// src/routes/contact/+page.server.ts
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { sendContactInquiryEmail } from '$lib/server/email';
import { log } from '$lib/server/log';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { KVNamespace } from '@cloudflare/workers-types';

export const actions: Actions = {
	default: async ({ request, platform, getClientAddress }) => {
		// Rate limiting: 5 submissions per hour per IP
		const usersKV = platform?.env?.BETA_USERS_KV as KVNamespace | undefined;
		if (usersKV) {
			const clientIp = getClientAddress();
			const { allowed } = await checkRateLimit(usersKV, clientIp, 'contact_form', 5, 3600);
			if (!allowed) {
				return fail(429, {
					error: 'Too many submissions. Please try again later.',
					name: '',
					email: '',
					company: '',
					message: ''
				});
			}
		}

		const formData = await request.formData();

		const name = formData.get('name') as string;
		const email = formData.get('email') as string;
		const company = formData.get('company') as string;
		const message = formData.get('message') as string;

		// Basic validation
		if (!name || !email || !message) {
			return fail(400, {
				error: 'Missing required fields',
				name,
				email,
				company,
				message
			});
		}

		try {
			await sendContactInquiryEmail({ name, email, company, message });
			return { success: true };
		} catch (err) {
			log.error('Contact form error:', err);
			return fail(500, {
				error: 'Failed to send message. Please try again later.',
				name,
				email,
				company,
				message
			});
		}
	}
};
