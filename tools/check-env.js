#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const deprecatedFile = path.join(repoRoot, '.env.example');

if (fs.existsSync(deprecatedFile)) {
	console.error(
		'ERROR: Deprecated file `.env.example` exists. Use `.dev.vars.example` instead and remove `.env.example`.'
	);
	console.error(
		'To fix: `git rm .env.example` and commit the change, or delete the file locally and push.`'
	);
	process.exit(1);
}

// If not present, exit cleanly
process.exit(0);
