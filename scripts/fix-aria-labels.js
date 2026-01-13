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
	// Replace patterns like aria-label={Some text} or aria-label={Some text" with aria-label="Some text"
	out = out.replace(
		/aria-label=\{\s*([^}"\n]+?)\s*(?:\}|")/g,
		(m, inner) => `aria-label="${inner.trim()}"`
	);
	// Also aria-hidden={true" -> aria-hidden={true}
	out = out.replace(/aria-([\w-]+)=\{\s*(true|false)"/g, (m, a, val) => `aria-${a}={${val}}`);
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
		console.log(`Fixed aria: ${path.relative(process.cwd(), f)}`);
		changed++;
	}
}
console.log(`Aria pass done. Files changed: ${changed}`);
process.exit(0);
