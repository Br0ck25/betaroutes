import fs from 'fs/promises';
import path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function shouldProcess(filePath) {
	const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
	// process server-only codepaths: explicit server lib, +server route files, and any *.server.ts/js
	return (
		rel.startsWith('src/lib/server/') ||
		/src\/routes\/.+\+server\./.test(rel) ||
		/\.server\.(ts|js)$/.test(rel)
	);
}

function replaceConsole(content) {
	// conservative replacements
	let out = content;
	out = out.replace(/console\.error\(/g, 'log.error(');
	out = out.replace(/console\.warn\(/g, 'log.warn(');
	out = out.replace(/console\.info\(/g, 'log.info(');
	out = out.replace(/console\.log\(/g, 'log.debug(');
	out = out.replace(/console\.trace\(/g, 'log.debug(');
	return out;
}

async function addImportIfMissing(filePath, content) {
	if (!/import\s+\{\s*log\s*\}\s+from\s+['\"]\$lib\/server\/log['\"];?/.test(content)) {
		// Add near top after other imports
		const lines = content.split('\n');
		const idx = lines.findIndex((l) => l.startsWith('import'));
		if (idx === -1) {
			return `import { log } from '$lib/server/log';\n${content}`;
		}
		// find last contiguous import block
		let end = idx;
		while (end + 1 < lines.length && lines[end + 1].startsWith('import')) end++;
		lines.splice(end + 1, 0, "import { log } from '$lib/server/log';");
		return lines.join('\n');
	}
	return content;
}

async function walkDir(dir) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const results = [];
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			results.push(...(await walkDir(full)));
		} else {
			results.push(full);
		}
	}
	return results;
}

async function run() {
	const allFiles = await walkDir(path.join(ROOT, 'src'));
	const targetFiles = allFiles.filter((f) => shouldProcess(f) && /\.ts$|\.js$/.test(f));
	console.log('Found', targetFiles.length, 'candidate files');

	for (const file of targetFiles) {
		let content = await fs.readFile(file, 'utf8');
		const newContent = replaceConsole(content);
		if (newContent !== content) {
			const withImport = await addImportIfMissing(file, newContent);
			await fs.writeFile(file, withImport, 'utf8');
			console.log('Patched', path.relative(ROOT, file));
		}
	}
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
