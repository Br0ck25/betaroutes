#!/usr/bin/env node
import { execSync } from 'child_process';
const platform = process.platform;

if (platform === 'win32') {
	console.log('Skipping legacy svelte4->5 detector on Windows.');
	process.exit(0);
}

try {
	execSync('sh ./svelte4-to-5-detector.sh', { stdio: 'inherit' });
} catch (e) {
	process.exit(e.status || 1);
}
