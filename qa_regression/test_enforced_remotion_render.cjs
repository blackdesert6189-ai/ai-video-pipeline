const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('==================================================================');
console.log('   TESTING ENFORCED REMOTION RENDER PATH (node render.js)');
console.log('==================================================================\n');

let allPassed = true;

// ── TEST 1: Missing voiceover through enforced render.js ────────────────────
console.log('--- ENFORCED TEST 1: Attempt render with MISSING voiceover file ---');
const missingProps = path.resolve('remotion_engine', 'props_test_missing.json');
fs.writeFileSync(missingProps, JSON.stringify({
  title: "Test Reel",
  voiceoverAudio: "missing_voice.mp3"
}, null, 2));

const res1 = spawnSync('node', ['render.js', 'SceneDraftReel05', 'output/test_should_not_exist.mp4', `--props=props_test_missing.json`], {
  cwd: path.resolve('remotion_engine'),
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024
});

console.log(`[Exit Code]: ${res1.status}`);
const output1 = (res1.stdout || '') + (res1.stderr || '');
const hasAbortError = output1.includes('REMOTION PREFLIGHT FAILED') && output1.includes('missing_voice.mp3');
const hasRenderStarted = output1.includes('Bundling') || output1.includes('Rendered');
const outputExists = fs.existsSync(path.resolve('remotion_engine', 'output', 'test_should_not_exist.mp4'));

if (res1.status !== 0 && hasAbortError && !hasRenderStarted && !outputExists) {
  console.log('✓ ENFORCED TEST 1 PASSED: Preflight caught missing voiceover, blocked Remotion render completely, and produced no output file.');
} else {
  console.error('❌ ENFORCED TEST 1 FAILED:', { status: res1.status, hasAbortError, hasRenderStarted, outputExists });
  allPassed = false;
}
if (fs.existsSync(missingProps)) fs.rmSync(missingProps, { force: true });

// ── TEST 2: Valid voiceover through enforced render.js ──────────────────────
console.log('\n--- ENFORCED TEST 2: Attempt render with VALID voiceover file ---');
const validProps = path.resolve('remotion_engine', 'props_test_valid.json');
fs.writeFileSync(validProps, JSON.stringify({
  title: "Test Reel Valid",
  voiceoverAudio: "voiceover_valid.mp3"
}, null, 2));

const outValid = path.resolve('remotion_engine', 'output', 'reel05_enforced_valid.mp4');
if (fs.existsSync(outValid)) fs.rmSync(outValid, { force: true });

try {
  execSync(`node render.js SceneDraftReel05 output/reel05_enforced_valid.mp4 --props=props_test_valid.json --concurrency=2`, {
    cwd: path.resolve('remotion_engine'),
    stdio: 'inherit'
  });
  console.log('[Exit Code]: 0');
} catch (e) {
  console.error('[Exit Code]:', e.status);
  allPassed = false;
}

if (fs.existsSync(outValid)) {
  console.log('✓ ENFORCED TEST 2 PASSED: Preflight passed and Remotion rendered output successfully.');
  
  // Audio QA on produced file
  const probeRaw = execSync(`ffmpeg -i "${outValid}" -vn -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1`, { encoding: 'utf8' });
  const loud = JSON.parse(probeRaw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)[0]);
  const lufs = parseFloat(loud.input_i);
  const tp = parseFloat(loud.input_tp);
  console.log(`[QA Metrics] Integrated Loudness: ${lufs} LUFS | True Peak: ${tp} dBTP`);
  if (lufs >= -15.0 && lufs <= -13.0 && tp <= -1.0) {
    console.log('✓ ENFORCED TEST 2 AUDIO QA PASSED: Broadcast/Social compliant!');
  } else {
    console.error('❌ Audio metrics outside spec:', { lufs, tp });
    allPassed = false;
  }
} else {
  console.error('❌ Output file was not generated.');
  allPassed = false;
}
if (fs.existsSync(validProps)) fs.rmSync(validProps, { force: true });

console.log('\n==================================================================');
if (allPassed) {
  console.log('✓ ALL ENFORCED REMOTION RENDER TESTS PASSED 100%!');
} else {
  console.log('❌ SOME TESTS FAILED.');
}
console.log('==================================================================\n');
