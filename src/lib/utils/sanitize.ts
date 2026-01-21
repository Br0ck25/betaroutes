// src/lib/utils/sanitize.ts
// [!code fix] SECURITY (Issue #7, #43): HTML sanitization utility

import DOMPurify from 'isomorphic-dompurify';
import type { Config as DOMPurifyConfig } from 'dompurify';

/**
 * Sanitize HTML content using DOMPurify
 * Use this for any content rendered with {@html}
 *
 * @param dirty - The untrusted HTML string to sanitize
 * @param options - Optional DOMPurify configuration
 * @returns Sanitized HTML string safe to render
 */
export function sanitizeHtml(dirty: string, options?: DOMPurifyConfig): string {
	return DOMPurify.sanitize(dirty, options) as string;
}

/**
 * Sanitize SVG content specifically
 * Allows only SVG elements and safe attributes
 *
 * @param svg - The SVG string to sanitize
 * @returns Sanitized SVG string
 */
export function sanitizeSvg(svg: string): string {
	return DOMPurify.sanitize(svg, {
		USE_PROFILES: { svg: true, svgFilters: true },
		ADD_TAGS: ['use'], // Allow <use> for icon sprites
		ALLOWED_ATTR: [
			'class',
			'id',
			'xmlns',
			'viewBox',
			'width',
			'height',
			'fill',
			'stroke',
			'stroke-width',
			'stroke-linecap',
			'stroke-linejoin',
			'd',
			'cx',
			'cy',
			'r',
			'x',
			'y',
			'x1',
			'y1',
			'x2',
			'y2',
			'points',
			'pathLength',
			'stroke-dasharray',
			'fill-rule',
			'clip-rule'
		]
	}) as string;
}

/**
 * Pre-sanitize static SVG strings at build time
 * Use this for known-safe, hardcoded SVG content
 * This is defense-in-depth even for static content
 *
 * @param svg - Static SVG string
 * @returns Sanitized SVG string
 */
export function sanitizeStaticSvg(svg: string): string {
	// Even though it's static, sanitize as defense-in-depth
	// This protects against future refactoring mistakes
	return sanitizeSvg(svg);
}
