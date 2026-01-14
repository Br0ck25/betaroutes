#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function walk(dir) {
	const results = [];
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		if (fs.statSync(p).isDirectory()) results.push(...walk(p));
		else if (p.endsWith('.svelte')) results.push(p);
	}
	return results;
}

function fixContent(src) {
	let s = src;
	// 1) Handle double-brace use: e.g., use:autocomplete={{ apiKey: API_KEY }} -> use:autocomplete="{{ apiKey: API_KEY }}"
	s = s.replace(/([\w:-]+)=\{\{([\s\S]*?)\}\}/g, (m, a, inner) => `${a}="{{ ${inner.trim()} }}"`);

	// 2) Handle single-brace attributes: bind:, on:, class:, aria:, value=, etc.
	s = s.replace(/([\w:-]+)=\{([^\{][^}]*)\}/g, (m, a, inner) => `${a}="{${inner.trim()}}"`);

	// 3) Convert leading tabs to 4 spaces for indentation
	s = s.replace(/^\t+/gm, (m) => ' '.repeat(4 * m.length));

	return s;
}

const root = path.resolve(process.cwd(), 'src');
const files = walk(root);
let changed = 0;
for (const f of files) {
	const orig = fs.readFileSync(f, 'utf8');
	const fixed = fixContent(orig);
	if (fixed !== orig) {
		fs.writeFileSync(f, fixed, 'utf8');
		console.log(`Fixed: ${path.relative(process.cwd(), f)}`);
		changed++;
	}
}
console.log(`Done. Files changed: ${changed}`);
process.exit(0);
