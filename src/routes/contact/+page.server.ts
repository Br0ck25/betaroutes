// src/routes/contact/+page.server.ts
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { sendContactInquiryEmail } from '$lib/server/email';
import { log } from '$lib/server/log';
import { checkRateLimit } from '$lib/server/rateLimit';
import { safeKV, getEnv } from '$lib/server/env';

// [!code fix] SECURITY: Field length limits to prevent DoS
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 max email length
const MAX_COMPANY_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000; // Reasonable limit for a contact message

export const actions: Actions = {
  default: async ({ request, platform, getClientAddress }) => {
    const formData = await request.formData();

    const name = (formData.get('name') as string)?.trim() || '';
    const email = (formData.get('email') as string)?.trim() || '';
    const company = (formData.get('company') as string)?.trim() || '';
    const message = (formData.get('message') as string)?.trim() || '';

    // [!code fix] SECURITY: Rate limit contact form (5 submissions per hour per IP)
    const env = getEnv(platform);
    const kv = safeKV(env, 'BETA_SESSIONS_KV');
    if (kv) {
      const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
      const limitResult = await checkRateLimit(kv, clientIp, 'contact_form', 5, 3600);
      if (!limitResult.allowed) {
        log.warn('[Contact] Rate limit exceeded', { ip: clientIp });
        return fail(429, {
          error: 'Too many submissions. Please try again later.',
          name,
          email,
          company,
          message
        });
      }
    }

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

    // [!code fix] SECURITY: Enforce field length limits
    if (name.length > MAX_NAME_LENGTH) {
      return fail(400, {
        error: `Name must be ${MAX_NAME_LENGTH} characters or less`,
        name: name.slice(0, MAX_NAME_LENGTH),
        email,
        company,
        message
      });
    }
    if (email.length > MAX_EMAIL_LENGTH) {
      return fail(400, {
        error: `Email must be ${MAX_EMAIL_LENGTH} characters or less`,
        name,
        email: email.slice(0, MAX_EMAIL_LENGTH),
        company,
        message
      });
    }
    if (company.length > MAX_COMPANY_LENGTH) {
      return fail(400, {
        error: `Company must be ${MAX_COMPANY_LENGTH} characters or less`,
        name,
        email,
        company: company.slice(0, MAX_COMPANY_LENGTH),
        message
      });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return fail(400, {
        error: `Message must be ${MAX_MESSAGE_LENGTH} characters or less`,
        name,
        email,
        company,
        message: message.slice(0, MAX_MESSAGE_LENGTH)
      });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return fail(400, {
        error: 'Please enter a valid email address',
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
