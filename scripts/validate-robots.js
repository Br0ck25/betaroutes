import fs from 'fs';
import path from 'path';

const file = path.resolve(process.cwd(), 'static', 'robots.txt');
if (!fs.existsSync(file)) {
	console.error('robots.txt not found at static/robots.txt');
	process.exit(2);
}

const content = fs.readFileSync(file, 'utf8');
const lines = content.split(/\r?\n/);

// Allowed directives (case-insensitive)
const allowed = new Set(['user-agent', 'disallow', 'allow', 'sitemap', 'crawl-delay', 'host']);

let hasError = false;
for (let i = 0; i < lines.length; i++) {
	const raw = lines[i];
	const lineNum = i + 1;
	const trimmed = raw.trim();

	if (trimmed === '' || trimmed.startsWith('#')) continue;

	// lines of the form "Key: value"
	const m = /^([^:\s]+)\s*:\s*(.*)$/.exec(trimmed);
	if (!m) {
		console.error(`robots.txt:${lineNum} Unknown line format: ${raw}`);
		hasError = true;
		continue;
	}

	const key = m[1].toLowerCase();
	if (!allowed.has(key)) {
		console.error(`robots.txt:${lineNum} Unknown directive: ${raw}`);
		hasError = true;
	}
}

if (hasError) {
	console.error('\nInvalid robots.txt detected. Remove unknown directives before deploying.');
	process.exit(1);
}

console.log('robots.txt looks valid ✅');
