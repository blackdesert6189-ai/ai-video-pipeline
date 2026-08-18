/**
 * render.js — Production Remotion Render Entrypoint with Enforced Preflight Guard
 *
 * Enforces repository Reel rules:
 * 1. Preflight validation MUST pass before Remotion render can start.
 * 2. Missing/empty/invalid voiceover aborts immediately with non-zero exit code.
 * 3. Never bypasses preflight.
 */

const { execSync } = require('child_process');
const path = require('path');
const { validateRemotionProps } = require('./preflight');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Usage: node render.js <CompositionId> <OutputFile> [--props=<props.json>]");
  process.exit(1);
}

const compositionId = args[0];
const outputFile = args[1];
const propsArg = args.find(a => a.startsWith('--props=')) || '--props=props_reel05.json';
const propsPath = propsArg.replace('--props=', '');

console.log(`[Remotion Pipeline] Validating preflight requirements for "${compositionId}" with props: "${propsPath}"...`);
try {
  validateRemotionProps(propsPath);
} catch (err) {
  console.error(`\n[RENDER ABORTED] ${err.message}\n`);
  process.exit(1);
}

console.log(`[Remotion Pipeline] ✓ Preflight passed. Starting Remotion render...`);
const extraArgs = args.filter(a => a !== compositionId && a !== outputFile && !a.startsWith('--props=')).join(' ');
const cmd = `npx remotion render ${compositionId} "${outputFile}" --props="${propsPath}" ${extraArgs}`;
execSync(cmd, { stdio: 'inherit', cwd: __dirname, shell: true });
