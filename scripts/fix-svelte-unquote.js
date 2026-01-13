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

function fixContent(s) {
	let out = s;
	// Unquote simple directive bindings like bind:value="{x}"
	out = out.replace(
		/bind:([\w-]+)="\{([^}]*)\}"/g,
		(m, a, inner) => `bind:${a}={${inner.trim()}}`
	);
	out = out.replace(
		/class:([\w-]+)="\{([^}]*)\}"/g,
		(m, a, inner) => `class:${a}={${inner.trim()}}`
	);
	out = out.replace(/on:([\w:-]+)="([^}]*)"/g, (m, a, inner) => `on:${a}={${inner.trim()}}`);
	out = out.replace(/aria-([\w-]+)="([^}]*)"/g, (m, a, inner) => `aria-${a}={${inner.trim()}}`);

	// Also unquote simple bind:checked
	out = out.replace(
		/bind:checked="\{([^}]*)\}"/g,
		(m, inner) => `bind:checked={${inner.trim()}}`
	);

	return out;
}

const root = path.resolve(process.cwd(), 'src');
const files = walk(root);
let changed = 0;
for (const f of files) {
	const orig = fs.readFileSync(f, 'utf8');
	const fixed = fixContent(orig);
	if (fixed !== orig) {
		fs.writeFileSync(f, fixed, 'utf8');
		console.log(`Unquoted: ${path.relative(process.cwd(), f)}`);
		changed++;
	}
}
console.log(`Unquote pass done. Files changed: ${changed}`);
process.exit(0);
