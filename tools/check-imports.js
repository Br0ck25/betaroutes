// Verifies all $lib/* imports resolve correctly
import { existsSync } from 'fs';

const imports = [
  '$lib/db/queries',
  '$lib/db/types',
  '$lib/stores/user.svelte',
  '$lib/utils/csrf',
  '$lib/server/env'
];

for (const imp of imports) {
  const path = imp.replace('$lib', './src/lib') + '.ts';
  if (!existsSync(path) && !existsSync(path.replace('.ts', '.svelte.ts'))) {
    console.error(`❌ Missing: ${imp}`);
    process.exit(1);
  }
}
console.log('✅ All imports valid');
