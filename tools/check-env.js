#!/usr/bin/env node
// tools/check-env.js
//
// Check for required environment files in development
// Called by: npm run lint

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const devVarsExample = join(projectRoot, '.dev.vars.example');
const devVars = join(projectRoot, '.dev.vars');
const env = join(projectRoot, '.env');

console.log('🔍 Checking environment configuration...');

// Check if we're in a CI environment
const isCI = process.env.CI === 'true' || process.env.CI === '1';

if (isCI) {
  console.log('✅ CI environment detected - skipping local env checks');
  process.exit(0);
}

// Check if .dev.vars exists (required for local development)
if (!existsSync(devVars)) {
  console.error('');
  console.error('❌ Missing .dev.vars file!');
  console.error('');
  console.error('📋 For local development, you need a .dev.vars file with secrets.');
  console.error('');

  if (existsSync(devVarsExample)) {
    console.error('Run this command to create it:');
    console.error('');
    console.error('  cp .dev.vars.example .dev.vars');
    console.error('');
    console.error('Then edit .dev.vars and add your API keys.');
  } else {
    console.error('Create a .dev.vars file in the project root.');
  }

  console.error('');
  console.error('See: SECURITY.md for secrets management rules');
  console.error('');
  process.exit(1);
}

// Warn if .env exists (shouldn't be used with Cloudflare)
if (existsSync(env)) {
  console.warn('');
  console.warn('⚠️  Warning: .env file found');
  console.warn('');
  console.warn('Cloudflare uses .dev.vars for local development, not .env');
  console.warn('Make sure secrets are in .dev.vars (not committed to git)');
  console.warn('');
}

// Basic validation of .dev.vars content
const devVarsContent = readFileSync(devVars, 'utf-8');

// Check for example placeholders
const hasPlaceholders =
  devVarsContent.includes('YOUR_') ||
  devVarsContent.includes('REPLACE_') ||
  devVarsContent.includes('CHANGEME') ||
  devVarsContent.includes('xxx');

if (hasPlaceholders) {
  console.warn('');
  console.warn('⚠️  Warning: .dev.vars contains placeholder values');
  console.warn('');
  console.warn('Replace placeholder values with real secrets:');
  console.warn('- YOUR_API_KEY → actual API key');
  console.warn('- REPLACE_THIS → actual value');
  console.warn('');
}

// Check for accidentally committed secrets (shouldn't happen, but defensive)
if (devVarsContent.length > 0) {
  // Verify file is in .gitignore
  const gitignorePath = join(projectRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
    if (!gitignoreContent.includes('.dev.vars')) {
      console.error('');
      console.error('❌ SECURITY: .dev.vars is not in .gitignore!');
      console.error('');
      console.error('Add this line to .gitignore immediately:');
      console.error('');
      console.error('  .dev.vars');
      console.error('');
      process.exit(1);
    }
  }
}

console.log('✅ Environment configuration OK');
console.log('');
