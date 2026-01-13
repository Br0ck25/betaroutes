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
	// Convert double-braced attributes to single-brace (handles quoted and unquoted forms)
	s = s.replace(/([\w:-]+)="\{{2}([\s\S]*?)\}{2}"/g, (m, a, inner) => `${a}={${inner}}`);
	s = s.replace(/([\w:-]+)='\{{2}([\s\S]*?)\}{2}'/g, (m, a, inner) => `${a}={${inner}}`);
	s = s.replace(/([\w:-]+)=\{{2}([\s\S]*?)\}{2}/g, (m, a, inner) => `${a}={${inner}}`);

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
		console.log(`Unbraced: ${path.relative(process.cwd(), f)}`);
		changed++;
	}
}
console.log(`Unbrace pass done. Files changed: ${changed}`);
process.exit(0);
