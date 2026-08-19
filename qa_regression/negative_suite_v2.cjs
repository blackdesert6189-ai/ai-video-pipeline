const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('==================================================================');
console.log('           NEGATIVE & FAIL-SAFE TEST SUITE (6/6 CASES)');
console.log('==================================================================\n');

let allPassed = true;

// ── TEST 1: No input audio stream → FAIL-CLOSED ─────────────────────────────
console.log('--- TEST 1: Source video has NO audio stream ---');
const noAudioVideo = path.resolve('qa_regression', 'test_no_audio.mp4');
execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=1080x1920:rate=30 -c:v libx264 -an "${noAudioVideo}"`, { stdio: 'ignore' });

try {
  execSync(`node pipeline.js --skip-gemini --video "${noAudioVideo}" --output "qa_regression/test_fail.mp4"`, { stdio: 'pipe' });
  console.error('❌ TEST 1 FAILED: Expected pipeline to abort, but exited 0.');
  allPassed = false;
} catch (err) {
  const output = String(err.stderr || '') + String(err.stdout || '');
  if (output.includes('CRITICAL FAIL-CLOSED: Input video') && output.includes('has no audio stream')) {
    console.log('✓ TEST 1 PASSED: Correctly threw CRITICAL FAIL-CLOSED when input audio stream was missing.');
  } else {
    console.error(`❌ TEST 1 FAILED: Unexpected error received: ${output.slice(0, 300)}`);
    allPassed = false;
  }
}
if (fs.existsSync(noAudioVideo)) fs.rmSync(noAudioVideo, { force: true });

// ── TEST 2: Audio QA True Peak failure → FAIL-CLOSED ───────────────────────
console.log('\n--- TEST 2: Post-Render Audio QA blocks True Peak > -1.0 dBTP ---');
function validateAudioQA(filePath) {
  const raw = execSync(`ffmpeg -i "${filePath}" -vn -af "loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json" -f null - 2>&1`, { encoding: 'utf8' });
  const match = raw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!match) throw new Error("Could not measure");
  const stats = JSON.parse(match[0]);
  const finalLUFS = parseFloat(stats.input_i);
  const finalTP = parseFloat(stats.input_tp);
  if (finalLUFS < -15.0 || finalLUFS > -13.0) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Final Integrated Loudness (${finalLUFS} LUFS) is outside tolerance [-15.0, -13.0] LUFS!`);
  }
  if (finalTP > -1.0) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Final True Peak (${finalTP} dBTP) exceeds limit (-1.0 dBTP)!`);
  }
  return true;
}

let tpTestPath = 'output/creatine.mp4';
let tempTpCreated = false;
if (!fs.existsSync(tpTestPath)) {
  tpTestPath = path.resolve('qa_regression', 'test_clipping_tp.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x240:rate=30 -filter_complex "sine=f=440:d=3,loudnorm=I=-14.2:TP=-2[bg];sine=f=1000:d=0.01,volume=10[click];[click]adelay=1000|1000[dclick];[bg][dclick]amix=inputs=2:duration=first:normalize=0[aout]" -map 0:v -map "[aout]" -c:v libx264 -c:a aac -ac 2 -ar 48000 "${tpTestPath}"`, { stdio: 'ignore' });
  tempTpCreated = true;
}

try {
  validateAudioQA(tpTestPath);
  console.error('❌ TEST 2 FAILED: Expected QA to reject True Peak > -1.0 dBTP, but it passed.');
  allPassed = false;
} catch (err) {
  if (err.message && err.message.includes('CRITICAL AUDIO QA FAILED: Final True Peak') && err.message.includes('exceeds limit')) {
    console.log(`✓ TEST 2 PASSED: Successfully rejected clipping True Peak: ${err.message}`);
  } else {
    console.error(`❌ TEST 2 FAILED: Unexpected error: ${err.message}`);
    allPassed = false;
  }
} finally {
  if (tempTpCreated && fs.existsSync(tpTestPath)) fs.rmSync(tpTestPath, { force: true });
}

// ── TEST 3: Audio QA Loudness (LUFS) failure → FAIL-CLOSED ─────────────────
console.log('\n--- TEST 3: Post-Render Audio QA blocks Integrated Loudness out of [-15.0, -13.0] LUFS ---');
const dummyLoudPath = path.resolve('qa_regression', 'test_too_quiet.mp4');
// Generate audio at -46 LUFS (too quiet)
execSync(`ffmpeg -y -f lavfi -i "sine=frequency=1000:duration=2" -af "volume=-25dB" -c:a aac "${dummyLoudPath}"`, { stdio: 'ignore' });

try {
  validateAudioQA(dummyLoudPath);
  console.error('❌ TEST 3 FAILED: Expected QA to reject audio with LUFS outside [-15, -13], but it passed.');
  allPassed = false;
} catch (err) {
  if (err.message && err.message.includes('CRITICAL AUDIO QA FAILED: Final Integrated Loudness') && err.message.includes('outside tolerance')) {
    console.log(`✓ TEST 3 PASSED: Successfully rejected out-of-spec loudness: ${err.message}`);
  } else {
    console.error(`❌ TEST 3 FAILED: Unexpected error: ${err.message}`);
    allPassed = false;
  }
}
if (fs.existsSync(dummyLoudPath)) fs.rmSync(dummyLoudPath, { force: true });

// ── TEST 4: Missing local cache under --skip-gemini → FAIL-CLOSED ──────────
console.log('\n--- TEST 4: Missing local cache under --skip-gemini ---');
const dummyVideoDir = path.resolve('qa_regression', 'isolated_video_test');
fs.mkdirSync(dummyVideoDir, { recursive: true });
const isolatedVideo = path.join(dummyVideoDir, 'input.mp4');
execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a aac "${isolatedVideo}"`, { stdio: 'ignore' });

try {
  execSync(`node pipeline.js --skip-gemini --video "${isolatedVideo}" --output "qa_regression/isolated_out.mp4"`, { stdio: 'pipe' });
  console.error('❌ TEST 4 FAILED: Pipeline should have rejected missing local cache, but exited 0.');
  allPassed = false;
} catch (err) {
  const output = String(err.stderr || '') + String(err.stdout || '');
  if (output.includes('CRITICAL FAIL-CLOSED: --skip-gemini was specified, but no local cache exists')) {
    console.log('✓ TEST 4 PASSED: Cleanly rejected missing local cache without falling back to stale global index.html.');
  } else {
    console.error(`❌ TEST 4 FAILED: Unexpected error: ${output.slice(0, 300)}`);
    allPassed = false;
  }
}

// ── TEST 5: Wrong video cache (Cross-video contamination protection) ───────
console.log('\n--- TEST 5: Cache file declaring another video is REJECTED ---');
const mismatchCache = path.join(dummyVideoDir, '_gemini_cache.json');
fs.writeFileSync(mismatchCache, JSON.stringify({
  videoFile: 'completely_different_video.mp4',
  totalDuration: 10,
  sentences: [],
  overlays: []
}));

try {
  execSync(`node pipeline.js --skip-gemini --video "${isolatedVideo}" --output "qa_regression/isolated_out.mp4"`, { stdio: 'pipe' });
  console.error('❌ TEST 5 FAILED: Pipeline should have rejected mismatched cache ownership, but exited 0.');
  allPassed = false;
} catch (err) {
  const output = String(err.stderr || '') + String(err.stdout || '');
  if (output.includes('CRITICAL FAIL-CLOSED: Cache file') && output.includes('Refusing cross-video contamination')) {
    console.log('✓ TEST 5 PASSED: Detected mismatched cache ownership and prevented cross-video contamination.');
  } else {
    console.error(`❌ TEST 5 FAILED: Unexpected error: ${output.slice(0, 300)}`);
    allPassed = false;
  }
}

// ── TEST 6: Unowned cache missing videoFile field ─────────────────────────
console.log('\n--- TEST 6: Cache file missing videoFile ownership metadata is REJECTED ---');
const unownedCache = path.join(dummyVideoDir, '_gemini_cache.json');
fs.writeFileSync(unownedCache, JSON.stringify({
  // NO videoFile field
  totalDuration: 10,
  sentences: [{ index: 1, text: "Sample sentence", startTime: 0, endTime: 3 }],
  overlays: [{ sentence_index: 1, startTime: 0.5, endTime: 2.5, type: "card", title: "TEST" }]
}));

try {
  execSync(`node pipeline.js --skip-gemini --video "${isolatedVideo}" --output "qa_regression/isolated_out.mp4"`, { stdio: 'pipe' });
  console.error('❌ TEST 6 FAILED: Pipeline should have rejected unowned cache, but exited 0.');
  allPassed = false;
} catch (err) {
  const output = String(err.stderr || '') + String(err.stdout || '');
  if (output.includes('CRITICAL FAIL-CLOSED: Cache file') && output.includes('has no videoFile ownership metadata')) {
    console.log('✓ TEST 6 PASSED: Rejected unowned legacy cache missing videoFile ownership metadata.');
  } else {
    console.error(`❌ TEST 6 FAILED: Unexpected error: ${output.slice(0, 300)}`);
    allPassed = false;
  }
}

// Cleanup isolated test directory
if (fs.existsSync(dummyVideoDir)) fs.rmSync(dummyVideoDir, { recursive: true, force: true });
if (fs.existsSync(path.resolve('qa_regression', 'isolated_out.mp4'))) fs.rmSync(path.resolve('qa_regression', 'isolated_out.mp4'), { force: true });

console.log('\n==================================================================');
if (allPassed) {
  console.log('✓ ALL 6 NEGATIVE AND FAIL-SAFE VALIDATION TESTS PASSED 100%!');
  process.exit(0);
} else {
  console.error('❌ SOME TESTS FAILED.');
  process.exit(1);
}
