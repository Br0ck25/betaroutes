#!/usr/bin/env node
// Simple guard that fails if `svelte/store` is imported outside src/lib/stores
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const IGNORES = new Set(['node_modules', '.svelte-kit', 'dist', 'static', 'build']);
// files allowed to import svelte/store during migration (temporary whitelist)
const ALLOWED = new Set([
  'src/lib/services/googleMaps.ts',
  'src/routes/dashboard/settings/lib/save-settings.ts'
]);
const MATCH_RE =
  /(?:import\s+[\s\S]*?\s+from\s+['"]svelte\/store['"])|(?:from\s+['"]svelte\/store['"])/;
const EXT = new Set(['.ts', '.js', '.svelte']);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORES.has(e.name)) continue;
      files.push(...(await walk(path.join(dir, e.name))));
    } else if (e.isFile()) {
      if (EXT.has(path.extname(e.name))) files.push(path.join(dir, e.name));
    }
  }
  return files;
}

(async () => {
  try {
    const files = await walk(ROOT);
    const violations = [];
    for (const f of files) {
      // ignore files inside src/lib/stores or on the explicit ALLOWED whitelist
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      if (rel.startsWith('src/lib/stores/') || ALLOWED.has(rel)) continue;
      const content = await fs.readFile(f, 'utf8');
      if (MATCH_RE.test(content)) violations.push(rel);
    }

    if (violations.length) {
      console.error('\nERROR: Found legacy `svelte/store` imports outside `src/lib/stores/`:');
      for (const v of violations) console.error(' -', v);
      console.error(
        '\nPlease migrate these stores to `.svelte.ts` modules or move their import into `src/lib/stores/`.'
      );
      process.exit(1);
    }

    console.log('No legacy `svelte/store` imports found outside `src/lib/stores/`.');
  } catch (err) {
    console.error('check-no-legacy-stores failed:', err);
    process.exit(2);
  }
})();
