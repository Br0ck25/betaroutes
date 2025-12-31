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
	// Convert attributes like on:click={{(... )}} or on:dragstart={{(... )}} to single braces
	s = s.replace(/(on:[\w:-]+)=\{\{([\s\S]*?)\}\}/g, (m, a, inner) => `${a}={${inner}}`);
	// Also convert cases where we have on:place-selected={{(e) => ...}
	s = s.replace(/(on:[\w:-]+)=\{\{([\s\S]*?)\}/g, (m, a, inner) => `${a}={${inner}}`);
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
		console.log(`Cleaned braces: ${path.relative(process.cwd(), f)}`);
		changed++;
	}
}
console.log(`Clean braces pass done. Files changed: ${changed}`);
process.exit(0);
