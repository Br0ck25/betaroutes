# Bulk Migration Runbook (one-off)

This folder contains the Cloudflare Worker `migrate-username-to-id` and a safe helper script to run it.

Quick safety checklist (MUST):

1. Verify you have a recent backup of KV namespaces involved. The worker will write backups under `migration_backup:{timestamp}:{origKey}` by default.
2. Prepare a `nameToId` JSON mapping of legacy usernames -> UUIDs. Example: `nameToId.example.json`.
3. Dry-run first and inspect results carefully.

Using the helper script `run-bulk-migration.js`:

- Place a mapping file, e.g. `tools/migrations/nameToId.json`.
- Set `WORKER_URL` to the URL of your deployed worker (or a Tail worker URL from Wrangler).
- Dry run example:

  WORKER_URL="https://your-worker.example.workers.dev" \
  node tools/migrations/run-bulk-migration.js --mapping tools/migrations/nameToId.json

- Confirmed run (writes, safe default no delete):

  WORKER_URL="https://your-worker.example.workers.dev" \
  node tools/migrations/run-bulk-migration.js --mapping tools/migrations/nameToId.json --confirm --loop

- To enable deletion of old keys (only after backups and verification):

  WORKER_URL="https://your-worker.example.workers.dev" \
  node tools/migrations/run-bulk-migration.js --mapping tools/migrations/nameToId.json --confirm --delete-old --loop

Notes:

- The script writes round-by-round JSON summaries to `tools/migrations/output/`.
- By default the worker will create `migration_backup:{timestamp}:{origKey}` copies if `backup` is true.
- If you need help resolving `unresolved` usernames, add them to the mapping file and re-run.
- Consider running a small pilot user first (set `--prefixes "trip:"` and a minimal mapping) before a broad run.

If you'd like, I can:

- Add an automated dashboard to show migration progress and unresolved users, or
- Prepare a preflight script that checks KV sizes and estimates run-time and billing costs.
