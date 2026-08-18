const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('==================================================================');
console.log('     REAL CLI FAIL-SAFE TEST SUITE (PIPELINE.JS DIRECT EXEC)');
console.log('==================================================================\n');

let allPassed = true;

// Helper to run real CLI
function runCli(args) {
  const res = spawnSync('node', ['pipeline.js', ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8'
  });
  return {
    exitCode: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    allOutput: (res.stdout || '') + (res.stderr || '')
  };
}

// ── CLI TEST 1: Input video without audio ──────────────────────────────────
console.log('--- CLI TEST 1: Real CLI with video having NO audio track ---');
const noAudioVideo = path.resolve('qa_regression', 'cli_no_audio.mp4');
execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=1080x1920:rate=30 -c:v libx264 -an "${noAudioVideo}"`, { stdio: 'ignore' });

const res1 = runCli(['--video', noAudioVideo, '--output', 'qa_regression/cli_out1.mp4']);
console.log(`[Exit Code]: ${res1.exitCode}`);

const hasNoAudioError = res1.allOutput.includes('CRITICAL FAIL-CLOSED: Input video') && res1.allOutput.includes('has no audio stream');
const hasSuccess1 = res1.allOutput.includes('Pipeline complete') || res1.allOutput.includes('FFmpeg single-pass compositing');

if (res1.exitCode !== 0 && hasNoAudioError && !hasSuccess1) {
  console.log('✓ CLI TEST 1 PASSED: Process exited with non-zero code, printed CRITICAL FAIL-CLOSED error, and emitted NO success message.');
} else {
  console.error('❌ CLI TEST 1 FAILED:', { exitCode: res1.exitCode, hasNoAudioError, hasSuccess1 });
  allPassed = false;
}
if (fs.existsSync(noAudioVideo)) fs.rmSync(noAudioVideo, { force: true });

// ── CLI TEST 2: --skip-gemini with missing local cache ──────────────────────
console.log('\n--- CLI TEST 2: Real CLI with --skip-gemini on isolated folder without cache ---');
const isolatedDir = path.resolve('qa_regression', 'cli_isolated_dir');
fs.mkdirSync(isolatedDir, { recursive: true });
const isolatedVideo = path.join(isolatedDir, 'isolated_video.mp4');
execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a aac "${isolatedVideo}"`, { stdio: 'ignore' });

const res2 = runCli(['--skip-gemini', '--video', isolatedVideo, '--output', 'qa_regression/cli_out2.mp4']);
console.log(`[Exit Code]: ${res2.exitCode}`);

const hasMissingCacheError = res2.allOutput.includes('CRITICAL FAIL-CLOSED: --skip-gemini was specified, but no local cache exists');
const hasSuccess2 = res2.allOutput.includes('HTML regenerated from Gemini cache') || res2.allOutput.includes('FFmpeg single-pass');

if (res2.exitCode !== 0 && hasMissingCacheError && !hasSuccess2) {
  console.log('✓ CLI TEST 2 PASSED: Process exited with non-zero code, refused fallback to stale index.html, and emitted NO success message.');
} else {
  console.error('❌ CLI TEST 2 FAILED:', { exitCode: res2.exitCode, hasMissingCacheError, hasSuccess2 });
  allPassed = false;
}

// ── CLI TEST 3: --skip-gemini with cache belonging to another video ────────
console.log('\n--- CLI TEST 3: Real CLI with --skip-gemini where cache belongs to another video ---');
const mismatchCacheFile = path.join(isolatedDir, '_gemini_cache.json');
fs.writeFileSync(mismatchCacheFile, JSON.stringify({
  videoFile: 'unrelated_foreign_video.mp4',
  totalDuration: 10,
  sentences: [],
  overlays: []
}, null, 2));

const res3 = runCli(['--skip-gemini', '--video', isolatedVideo, '--output', 'qa_regression/cli_out3.mp4']);
console.log(`[Exit Code]: ${res3.exitCode}`);

const hasMismatchError = res3.allOutput.includes('CRITICAL FAIL-CLOSED: Cache file') && res3.allOutput.includes('Refusing cross-video contamination');
const hasSuccess3 = res3.allOutput.includes('HTML regenerated from Gemini cache') || res3.allOutput.includes('FFmpeg single-pass');

if (res3.exitCode !== 0 && hasMismatchError && !hasSuccess3) {
  console.log('✓ CLI TEST 3 PASSED: Process exited with non-zero code, rejected foreign cache ownership, and emitted NO success message.');
} else {
  console.error('❌ CLI TEST 3 FAILED:', { exitCode: res3.exitCode, hasMismatchError, hasSuccess3 });
  allPassed = false;
}

// Cleanup
if (fs.existsSync(isolatedDir)) fs.rmSync(isolatedDir, { recursive: true, force: true });

console.log('\n==================================================================');
if (allPassed) {
  console.log('✓ ALL REAL CLI FAIL-SAFE TESTS PASSED 100% (EXIT CODE != 0, ZERO FALSE SUCCESS)!');
  process.exit(0);
} else {
  console.error('❌ SOME CLI TESTS FAILED.');
  process.exit(1);
}
console.log('==================================================================\n');
