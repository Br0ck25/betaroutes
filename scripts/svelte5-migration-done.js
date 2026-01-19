import fs from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run migrate:done <path/to/file.svelte>');
  process.exit(1);
}

let md = fs.readFileSync('MIGRATION_ORDER.md', 'utf8');

const unchecked = `- [ ] ${file}`;
const checked = `- [x] ${file}`;

if (!md.includes(unchecked)) {
  console.error('File not found or already checked');
  process.exit(1);
}

md = md.replace(unchecked, checked);
fs.writeFileSync('MIGRATION_ORDER.md', md, 'utf8');

console.log(`✔ Marked complete: ${file}`);
