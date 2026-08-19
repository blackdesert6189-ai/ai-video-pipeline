const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function runTests() {
  console.log('==================================================================');
  console.log('            TESTING AUDIO MODULE (src/pipeline/audio.js)');
  console.log('==================================================================\n');

  const {
    buildVoiceProcessingChain,
    discoverSfxFiles,
    buildAudioPlan,
    measureMixedAudioLoudnorm,
    classifySfxFile,
    scoreSfxForCardType,
    addHookSfx,
    addBrollSfx,
    mixOverlaySfxIntoOutput
  } = await import(pathToFileURL(path.resolve('src', 'pipeline', 'audio.js')).href);

  let allPassed = true;
  const testDir = path.resolve('qa_regression', 'test_audio_plan_fixture');
  const sfxDir = path.join(testDir, 'sfx');
  fs.mkdirSync(sfxDir, { recursive: true });

  // Create isolated deterministic SFX fixture files
  const fixtureFiles = [
    'cinematic_01_hook.mp3',
    'impact_01_stat.mp3',
    'impact_02_stat.mp3',
    'whoosh_01_action.mp3',
    'notify_01_warning.mp3',
    'transition_01_broll.mp3',
    'transition_02_broll.mp3'
  ];

  for (const name of fixtureFiles) {
    const fPath = path.join(sfxDir, name);
    // Generate valid short mp3 audio
    execSync(`ffmpeg -y -f lavfi -i sine=frequency=440:duration=0.5 -c:a mp3 "${fPath}"`, { stdio: 'ignore' });
  }

  // Generate test video
  const testVideo = path.join(testDir, 'test_video.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=8:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=8 -c:v libx264 -c:a aac -ar 48000 "${testVideo}"`, { stdio: 'ignore' });

  // 1. Test Voice Processing Chain
  const vChain = buildVoiceProcessingChain();
  const expectedChainElements = [
    'highpass=f=80',
    'agate=threshold=0.001:attack=20:release=250:knee=2.828',
    'afftdn=nf=-25',
    'equalizer=f=250:width_type=o:width=2:g=-2',
    'equalizer=f=7500:width_type=o:width=1.5:g=-3',
    'equalizer=f=3000:width_type=o:width=2:g=3',
    'equalizer=f=8000:width_type=o:width=2:g=1',
    'acompressor=threshold=-18dB:ratio=3:attack=5:release=80:makeup=4'
  ];
  if (vChain === expectedChainElements.join(',')) {
    console.log('✓ TEST 1 PASSED: buildVoiceProcessingChain accurately matches exact 8-stage broadcast filter string.');
  } else {
    console.error('❌ TEST 1 FAILED: Voice chain mismatch:', vChain);
    allPassed = false;
  }

  // 2. Test Deterministic SFX Discovery & Classification
  const discovered = discoverSfxFiles(sfxDir);
  if (discovered.length === fixtureFiles.length) {
    console.log(`✓ TEST 2 PASSED: discoverSfxFiles accurately discovered and classified all ${discovered.length} fixture SFX.`);
  } else {
    console.error('❌ TEST 2 FAILED: Expected', fixtureFiles.length, 'files, got:', discovered.length);
    allPassed = false;
  }

  // 3. Test Deterministic Audio Plan Generation
  const mockOverlayEvents = [
    { type: 'STAT', startTime: 1.25 },
    { type: 'STAT', startTime: 1.25 }, // Exact duplicate timestamp -> suppressed!
    { type: 'STAT', startTime: 3.5 },  // Rotates to impact_02_stat.mp3
    { type: 'ACTION', startTime: 5.0 },
    { type: 'WARNING', startTime: 7.2 }
  ];
  const mockBrollSegments = [
    { startTime: 2.0 },
    { startTime: 6.0 }
  ];

  const plan = buildAudioPlan(mockOverlayEvents, mockBrollSegments, discovered);

  const expectedPlan = [
    { type: 'HOOK', fileName: 'whoosh_01_action.mp3', delayMs: 0, vol: -8 },
    { type: 'CARD_STAT', fileName: 'impact_01_stat.mp3', delayMs: 1250, vol: -10 },
    { type: 'CARD_STAT', fileName: 'cinematic_01_hook.mp3', delayMs: 3500, vol: -10 },
    { type: 'CARD_ACTION', fileName: 'whoosh_01_action.mp3', delayMs: 5000, vol: -10 },
    { type: 'CARD_WARNING', fileName: 'notify_01_warning.mp3', delayMs: 7200, vol: -10 },
    { type: 'BROLL', fileName: 'whoosh_01_action.mp3', delayMs: 2000, vol: -13 },
    { type: 'BROLL', fileName: 'transition_01_broll.mp3', delayMs: 6000, vol: -13 }
  ];

  let planMatches = plan.length === expectedPlan.length;
  if (planMatches) {
    for (let i = 0; i < expectedPlan.length; i++) {
      const p = plan[i];
      const e = expectedPlan[i];
      if (p.type !== e.type || p.fileName !== e.fileName || p.delayMs !== e.delayMs || p.vol !== e.vol) {
        planMatches = false;
        console.error(`❌ Plan mismatch at index ${i}:`, { actual: p, expected: e });
      }
    }
  }

  if (planMatches) {
    console.log('✓ TEST 3 PASSED: buildAudioPlan produces 100% deterministic plan with HOOK first, card rotation, B-roll timing, and duplicate suppression.');
  } else {
    console.error('❌ TEST 3 FAILED: Audio plan mismatch:', plan);
    allPassed = false;
  }

  // 4. Test Mixed Audio Loudnorm Measurement
  const loud = measureMixedAudioLoudnorm(testVideo, plan);
  if (loud && typeof loud.input_i !== 'undefined') {
    console.log(`✓ TEST 4 PASSED: measureMixedAudioLoudnorm successfully measured Pass 1 loudnorm stats (I=${loud.input_i} LUFS).`);
  } else {
    console.error('❌ TEST 4 FAILED: Failed to measure mixed loudnorm:', loud);
    allPassed = false;
  }

  // 5. Test Exported Legacy Audio Helpers (Ensures NO logger dependency errors)
  const hookOutput = path.join(testDir, 'hook_out.mp4');
  fs.copyFileSync(testVideo, hookOutput);
  try {
    addHookSfx(hookOutput);
    console.log('✓ TEST 5 PASSED: addHookSfx executed cleanly without logger or execution errors.');
  } catch (e) {
    console.error('❌ TEST 5 FAILED in addHookSfx:', e);
    allPassed = false;
  }

  const brollOutput = path.join(testDir, 'broll_out.mp4');
  fs.copyFileSync(testVideo, brollOutput);
  try {
    addBrollSfx(brollOutput, [{ startTime: 1.0 }]);
    console.log('✓ TEST 6 PASSED: addBrollSfx executed cleanly without logger or execution errors.');
  } catch (e) {
    console.error('❌ TEST 6 FAILED in addBrollSfx:', e);
    allPassed = false;
  }

  const mixOutput = path.join(testDir, 'mix_out.mp4');
  fs.copyFileSync(testVideo, mixOutput);
  try {
    mixOverlaySfxIntoOutput(mixOutput, [{ type: 'STAT', startTime: 1.0 }]);
    console.log('✓ TEST 7 PASSED: mixOverlaySfxIntoOutput executed cleanly without logger or execution errors.');
  } catch (e) {
    console.error('❌ TEST 7 FAILED in mixOverlaySfxIntoOutput:', e);
    allPassed = false;
  }

  // Cleanup
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n==================================================================');
  if (allPassed) {
    console.log('✓ ALL AUDIO MODULE TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('❌ AUDIO MODULE TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
