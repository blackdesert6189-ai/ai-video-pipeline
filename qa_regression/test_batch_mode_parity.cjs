const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('==================================================================');
console.log('       TESTING --batch RUNTIME PARITY CHARACTERIZATION');
console.log('==================================================================\n');

let allPassed = true;
const fixtureDir = path.resolve('qa_regression', 'test_batch_fixture');
const outDir = path.resolve('qa_regression', 'test_batch_out');
fs.mkdirSync(fixtureDir, { recursive: true });

// Create sample video and srt pair in fixtureDir
fs.writeFileSync(path.join(fixtureDir, 'sample.mp4'), 'dummy video', 'utf8');
fs.writeFileSync(path.join(fixtureDir, 'sample.srt'), '1\n00:00:00,000 --> 00:00:01,000\nTest\n', 'utf8');

// Baseline main invocation: node pipeline.js --batch <fixtureDir> --output-dir <outDir>
// In baseline main, this fails immediately with "Missing required arguments!" because videoPath/outputPath are empty
const res = spawnSync('node', ['pipeline.js', '--batch', fixtureDir, '--output-dir', outDir], {
  encoding: 'utf8'
});

console.log(`[Exit Code]: ${res.status}`);
console.log(`[Stdout Snippet]: ${res.stdout.trim().slice(0, 200)}`);

const hasMissingArgsError = res.stdout.includes('Missing required arguments!') || res.stderr.includes('Missing required arguments!');
const didNotStartBatch = !res.stdout.includes('[BATCH]');
const noOutDirCreated = !fs.existsSync(outDir);

if (res.status !== 0 && hasMissingArgsError && didNotStartBatch && noOutDirCreated) {
  console.log('✓ BATCH PARITY PASSED: --batch CLI invocation triggers baseline top-level validation error and does not start batch processing.');
} else {
  console.error('❌ BATCH PARITY FAILED:', { status: res.status, hasMissingArgsError, didNotStartBatch, noOutDirCreated });
  allPassed = false;
}

// Cleanup
if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });

console.log('\n==================================================================');
if (allPassed) {
  console.log('✓ ALL BATCH PARITY CHARACTERIZATION TESTS PASSED 100%!');
  process.exit(0);
} else {
  console.error('❌ BATCH PARITY CHARACTERIZATION TESTS FAILED.');
  process.exit(1);
}
