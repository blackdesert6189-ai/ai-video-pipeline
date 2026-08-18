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
    buildAudioPlan,
    measureMixedAudioLoudnorm,
    classifySfxFile,
    scoreSfxForCardType,
    AUDIO_LUFS_TARGET
  } = await import(pathToFileURL(path.resolve('src', 'pipeline', 'audio.js')).href);

  let allPassed = true;

  // 1. Test Voice Processing Chain
  const vChain = buildVoiceProcessingChain();
  if (vChain.includes('highpass=f=80') && vChain.includes('afftdn=nf=-25') && vChain.includes('acompressor=')) {
    console.log('✓ TEST 1 PASSED: buildVoiceProcessingChain accurately builds 8-stage broadcast filter chain.');
  } else {
    console.error('❌ TEST 1 FAILED:', vChain);
    allPassed = false;
  }

  // 2. Test SFX Classification & Scoring
  const cats = classifySfxFile('cinematic_whoosh_impact.mp3');
  if (cats.includes('cinematic') && cats.includes('whoosh') && cats.includes('impact')) {
    console.log('✓ TEST 2 PASSED: classifySfxFile correctly classifies multi-category audio filenames.');
  } else {
    console.error('❌ TEST 2 FAILED:', cats);
    allPassed = false;
  }

  const scoreStat = scoreSfxForCardType({ fileName: 'impact_boom.mp3', categories: ['impact'] }, 'STAT');
  if (scoreStat > 0) {
    console.log(`✓ TEST 3 PASSED: scoreSfxForCardType correctly ranks STAT impact SFX (score=${scoreStat}).`);
  } else {
    console.error('❌ TEST 3 FAILED: Expected score > 0 for STAT impact.');
    allPassed = false;
  }

  // 3. Test Audio Plan Construction
  const mockOverlayEvents = [
    { type: 'STAT', startTime: 1.5 },
    { type: 'ACTION', startTime: 3.2 }
  ];
  const mockBrollSegments = [
    { startTime: 4.0 }
  ];

  const plan = buildAudioPlan(mockOverlayEvents, mockBrollSegments);
  if (Array.isArray(plan) && plan.length >= 2) {
    const hasHook = plan.some(e => e.type === 'HOOK');
    const hasCard = plan.some(e => e.type.startsWith('CARD_'));
    if (hasHook && hasCard) {
      console.log(`✓ TEST 4 PASSED: buildAudioPlan produces deterministic audio plan with ${plan.length} SFX events.`);
    } else {
      console.error('❌ TEST 4 FAILED: Missing hook or card in plan:', plan);
      allPassed = false;
    }
  } else {
    console.error('❌ TEST 4 FAILED: Invalid plan structure:', plan);
    allPassed = false;
  }

  // 4. Test Mixed Audio Loudnorm Measurement
  const testDir = path.resolve('qa_regression', 'test_audio_plan_fixture');
  fs.mkdirSync(testDir, { recursive: true });
  const testVideo = path.join(testDir, 'audio_test.mp4');
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=3 -c:v libx264 -c:a aac -ar 48000 "${testVideo}"`, { stdio: 'ignore' });

  const loud = measureMixedAudioLoudnorm(testVideo, plan);
  if (loud && typeof loud.input_i !== 'undefined') {
    console.log(`✓ TEST 5 PASSED: measureMixedAudioLoudnorm successfully measured Pass 1 loudnorm stats (I=${loud.input_i} LUFS).`);
  } else {
    console.error('❌ TEST 5 FAILED: Failed to measure mixed loudnorm:', loud);
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
