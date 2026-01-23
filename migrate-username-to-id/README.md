migrate-username-to-id worker

This directory contains the Cloudflare Worker that runs the bulk migration from username-based KV keys to userId-based keys.

Steps to deploy and run (safe procedure):

1. Fill in KV namespace ids in `wrangler.toml`:
   - Replace `REPLACE_WITH_YOUR_DATA_KV_ID` with the KV namespace id that contains the `trip:`, `expense:`, `mileage:` keys (or use a replica that includes them).
   - Optionally add `MIGRATION_LOG_KV`, `USERS_KV`, `AUTH_KV` ids.

2. Test locally (optional):
   - You can `wrangler dev` in this folder to exercise the worker with your dev bindings.

3. Dry run (safe):
   - Deploy the worker (or use `wrangler dev` with TEST bindings) and POST to it with `dryRun: true` and a `nameToId` mapping JSON.
   - Example curl:

     curl -X POST https://migrate-username-to-id.example.workers.dev \
      -H 'Content-Type: application/json' \
      -d '{ "dryRun": true, "nameToId": {"James":"0d9df646-f89b-4ea8-ae70-f5d3bf3de322"}, "prefixes": ["trip:"] }'

4. Confirmed run: set `dryRun:false` and add `confirm:true`.
   - Start with `deleteOld:false` to keep legacy keys; after verification, you may set `deleteOld:true` (requires `confirm:true`) to remove legacy keys.

5. Monitoring: results contain `nextCursor` for each prefix allowing incremental looped runs.

6. Rollback: backups written under `migration_backup:{timestamp}:{origKey}` in the same KV. Copy back to original keys if needed.

Notes:

- Keep `nameToId` mapping file secret (do not commit live mapping). Use `tools/migrations/nameToId.json` locally and add it to `.gitignore`.
- For reliable runs over many records consider enqueuing jobs to Cloudflare Queues and processing chunks; this worker is intended as a safe one-off tool.
