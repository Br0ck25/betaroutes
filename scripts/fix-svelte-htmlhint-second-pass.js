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
	// Fix attributes containing template literals that were wrapped in quotes: ="{`...`}" -> = {`...`}
	s = s.replace(/="\{`/g, '={`');
	s = s.replace(/`}"/g, '`}');

	// Remove stray double-quotes before closing braces/parentheses
	s = s.replace(/"\s*\)/g, ')');
	s = s.replace(/"\s*\}/g, '}');

	// For attributes whose value contains an arrow function (=>), unwrap quotes: on:click="() => ..." -> on:click={() => ...}
	s = s.replace(/([\w:-]+)="([^"]*=>[^"]*)"/g, (m, a, inner) => `${a}={${inner}}`);

	// For attributes where we accidentally inserted nested quotes around template expressions like ${...}" -> ${...}
	s = s.replace(
		/\$\{([^}]+)\}"/g,
		(m, inner) => `\
\${${inner}}`
	);

	// Specific cleanup: aria-label="{`Select order ${o.id}"`}" -> aria-label={`Select order ${o.id}`}
	s = s.replace(/aria-label="\{`([^`]*)`\}"/g, (m, inner) => `aria-label={\`${inner}\`}`);

	return s;
}

const root = path.resolve(process.cwd(), 'src');
const files = walk(root);
let changed = 0;
for (const f of files) {
	let orig = fs.readFileSync(f, 'utf8');
	let fixed = fixContent(orig);
	if (fixed !== orig) {
		fs.writeFileSync(f, fixed, 'utf8');
		console.log(`Patched: ${path.relative(process.cwd(), f)}`);
		changed++;
	}
}
console.log(`Second pass done. Files changed: ${changed}`);
process.exit(0);
