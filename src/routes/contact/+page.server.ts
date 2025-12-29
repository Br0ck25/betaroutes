// src/routes/contact/+page.server.ts
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { sendContactInquiryEmail } from '$lib/server/email';
import { log } from '$lib/server/log';

export const actions: Actions = {
	default: async ({ request }) => {
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
