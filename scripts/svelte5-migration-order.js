import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'MIGRATION_ORDER.md');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.svelte-kit',
  'dist',
  'build'
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && full.endsWith('.svelte')) {
      files.push(path.relative(ROOT, full));
    }
  }
  return files;
}

function phase(file) {
  if (file.includes('routes/') || file.includes('+page') || file.includes('+layout')) {
    return 'Phase 4 — Routes & Layouts (DO LAST)';
  }
  if (file.includes('features/')) {
    return 'Phase 3 — Feature Modules';
  }
  if (file.includes('lib/') || file.includes('stores')) {
    return 'Phase 2 — Shared Components';
  }
  return 'Phase 1 — Leaf / Low Dependency';
}

const files = walk(ROOT);
const grouped = {};

for (const file of files) {
  const p = phase(file);
  grouped[p] ??= [];
  grouped[p].push(file);
}

let md = `# Svelte 4 → 5 Migration Checklist\n\n`;
md += `Run migrations top-to-bottom. Migrate ONE file at a time.\n\n`;

for (const [group, list] of Object.entries(grouped)) {
  md += `## ${group}\n`;
  for (const file of list.sort()) {
    md += `- [ ] ${file}\n`;
  }
  md += `\n`;
}

fs.writeFileSync(OUT, md, 'utf8');
console.log('✔ MIGRATION_ORDER.md generated');
