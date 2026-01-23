#!/usr/bin/env node
/**
 * run-bulk-migration.js
 *
 * Safe one-off runner for the `migrate-username-to-id` Cloudflare Worker.
 * - Defaults to dry-run mode (no writes)
 * - Requires explicit `--confirm` flag to perform writes
 * - Supports looping over cursors to finish prefixes in batches
 * - Writes JSON summaries to ./tools/migrations/output/
 *
 * Usage examples:
 *  - Dry run (safe):
 *      WORKER_URL="https://your-worker.example.workers.dev" node run-bulk-migration.js --mapping ./nameToId.json
 *
 *  - Execute a confirmed run (writes, non-deleting):
 *      WORKER_URL="https://your-worker.example.workers.dev" node run-bulk-migration.js --mapping ./nameToId.json --confirm --loop
 *
 *  - Execute confirmed run with delete of old keys (dangerous):
 *      WORKER_URL="https://your-worker.example.workers.dev" node run-bulk-migration.js --mapping ./nameToId.json --confirm --delete-old
 *
 * Safety warnings and steps are printed; this script will not enable deleteOld without --confirm.
 */

import fs from 'fs';
import path from 'path';

// Create an output directory relative to the repository root (process.cwd())
const OUTPUT_DIR = path.resolve(process.cwd(), 'tools', 'migrations', 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function usage() {
	console.log(`run-bulk-migration.js

Usage:
  WORKER_URL=<url> node run-bulk-migration.js --mapping <path> [--batch-size N] [--prefixes p1,p2] [--dry-run|--confirm] [--loop] [--delete-old]

Options:
  --mapping    Path to JSON file mapping username -> userId (required)
  --batch-size Number of keys per invocation (default 50)
  --prefixes   Comma-separated list of prefixes to process (default in worker)
  --confirm    Actually perform writes (required for non-dry runs)
  --dry-run    (default) do not write anything
  --loop       Keep invoking until all prefixes report nextCursor === null
  --delete-old Delete legacy keys after moving (DANGEROUS: requires --confirm)
  --no-backup  Do not store migration_backup copies (not recommended)
  --force-unresolved  Proceed even if the dry-run reported unresolved usernames (not recommended)

Examples:
  # Safe dry run
  WORKER_URL=https://... node run-bulk-migration.js --mapping ./nameToId.json

  # Confirmed run, iterate until finished
  WORKER_URL=https://... node run-bulk-migration.js --mapping ./nameToId.json --confirm --loop
`);
}

function parseArgs() {
	const args = process.argv.slice(2);
	const out = {
		mapping: null,
		batchSize: undefined,
		prefixes: undefined,
		confirm: false,
		dryRun: true,
		loop: false,
		deleteOld: false,
		backup: true,
		forceUnresolved: false
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		switch (a) {
			case '--mapping':
				out.mapping = args[++i];
				break;
			case '--batch-size':
				out.batchSize = Number(args[++i]);
				break;
			case '--prefixes':
				out.prefixes = args[++i]
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				break;
			case '--confirm':
				out.confirm = true;
				out.dryRun = false;
				break;
			case '--dry-run':
				out.dryRun = true;
				out.confirm = false;
				break;
			case '--loop':
				out.loop = true;
				break;
			case '--delete-old':
				out.deleteOld = true;
				break;
			case '--no-backup':
				out.backup = false;
				break;
			case '--force-unresolved':
				out.forceUnresolved = true;
				break;
			case '--help':
				usage();
				process.exit(0);
				break;
			default:
				console.error('Unknown arg', a);
				usage();
				process.exit(1);
		}
	}
	return out;
}

async function postToWorker(url, body) {
	const r = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const text = await r.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text };
	}
	return { status: r.status, json };
}

async function main() {
	const args = parseArgs();
	const workerUrl = process.env.WORKER_URL || process.env.MIGRATION_WORKER_URL;
	if (!workerUrl) {
		console.error('Missing WORKER_URL env var');
		usage();
		process.exit(1);
	}
	let mappingPath = args.mapping ? path.resolve(args.mapping) : null;
	// Try common fallback locations if mapping not specified
	if (!mappingPath) {
		const candA = path.resolve(process.cwd(), 'tools', 'migrations', 'nameToId.json');
		const candB = path.resolve(process.cwd(), 'migrate-username-to-id', 'nameToId.json');
		if (fs.existsSync(candA)) mappingPath = candA;
		else if (fs.existsSync(candB)) mappingPath = candB;
	}
	if (!mappingPath || !fs.existsSync(mappingPath)) {
		console.error(
			'Mapping file required via --mapping or placed at tools/migrations/nameToId.json or migrate-username-to-id/nameToId.json'
		);
		usage();
		process.exit(1);
	}
	const mappingPathResolved = mappingPath;
	const nameToId = JSON.parse(fs.readFileSync(mappingPathResolved, 'utf-8'));
	if (!nameToId || Object.keys(nameToId).length === 0) {
		console.warn(
			'Warning: mapping is empty. The worker will attempt heuristics (USERS_KV / AUTH_KV) which may not find all users.'
		);
	}

	console.log('Worker URL:', workerUrl);
	console.log('Mode:', args.dryRun ? 'dry-run' : args.confirm ? 'confirmed' : 'unknown');
	console.log('Batch size:', args.batchSize ?? 'default');
	console.log('Prefixes:', args.prefixes ?? 'default');
	console.log('DeleteOld:', args.deleteOld ? 'true' : 'false');
	console.log('Backup:', args.backup ? 'true' : 'false');

	if (args.deleteOld && !args.confirm) {
		console.error('--delete-old requires --confirm');
		process.exit(1);
	}

	// Iteratively call worker. Track cursorByPrefix
	let cursorByPrefix = {};
	let round = 0;
	while (true) {
		round++;
		console.log(`\n=== Invocation round ${round} ===`);
		const body = {
			dryRun: args.dryRun,
			confirm: args.confirm,
			deleteOld: args.deleteOld,
			backup: args.backup,
			batchSize: args.batchSize,
			nameToId,
			prefixes: args.prefixes,
			cursorByPrefix
		};

		const outFile = path.join(OUTPUT_DIR, `${Date.now()}-migration-round-${round}.json`);
		console.log('Posting payload to worker... (saving output to', outFile, ')');
		const res = await postToWorker(workerUrl, body);
		fs.writeFileSync(outFile, JSON.stringify({ status: res.status, response: res.json }, null, 2));

		if (res.status !== 200) {
			console.error('Worker responded with non-200 status', res.status, res.json);
			process.exit(1);
		}

		const results = res.json.results || [];
		let unresolved = new Set();
		let conflicts = [];
		let progress = 0;
		for (const r of results) {
			console.log(
				`Prefix: ${r.prefix} processed=${r.processed} migrated=${r.migrated} conflicts=${r.conflicts.length} unresolved=${r.unresolved.length} nextCursor=${r.nextCursor}`
			);
			if (r.unresolved && r.unresolved.length) r.unresolved.forEach((u) => unresolved.add(u));
			if (r.conflicts && r.conflicts.length) conflicts = conflicts.concat(r.conflicts);
			if (r.nextCursor) cursorByPrefix[r.prefix] = r.nextCursor;
			else cursorByPrefix[r.prefix] = null;
			progress += r.migrated || 0;
		}

		console.log('Round summary: total migrated (this round):', progress);
		if (conflicts.length) {
			console.warn('Conflicts detected (sample 20):', conflicts.slice(0, 20));
			console.warn('Resolve conflicts (manual inspection) before enabling deleteOld.');
		}
		if (unresolved.size) {
			console.warn('Unresolved usernames detected:', Array.from(unresolved));
			console.warn(
				'Add them to your mapping file and re-run or set --force-unresolved to continue anyway.'
			);
			if (!args.forceUnresolved) {
				console.error('Stopping due to unresolved usernames (safety).');
				process.exit(1);
			}
		}

		// If not looping, break after one invocation
		if (!args.loop) {
			console.log('Not looping; finished single invocation.');
			break;
		}

		// Check if all prefixes are done
		const unfinished = Object.keys(cursorByPrefix).filter((k) => cursorByPrefix[k]);
		if (unfinished.length === 0) {
			console.log('All prefixes complete (no nextCursor).');
			break;
		}

		console.log('Prefixes still have cursors; continuing loop. Cursors:', cursorByPrefix);
		// friendly delay between rounds
		await new Promise((r) => setTimeout(r, 1000));
	}

	console.log(
		'\nMigration run completed. Check output/ JSON files in tools/migrations/output/ for details.'
	);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
