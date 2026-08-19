const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function runTests() {
  console.log('==================================================================');
  console.log('          TESTING FINAL QA MODULE (src/pipeline/finalQa.js)');
  console.log('==================================================================\n');

  const { validatePostRenderAudioQA } = await import(
    pathToFileURL(path.resolve('src', 'pipeline', 'finalQa.js')).href
  );

  let allPassed = true;
  const testDir = path.resolve('qa_regression', 'test_final_qa_fixture');
  fs.mkdirSync(testDir, { recursive: true });

  const nonExistent = path.join(testDir, 'missing.mp4');
  const noAudio = path.join(testDir, 'no_audio.mp4');
  const mp3Audio = path.join(testDir, 'mp3_audio.mp4');
  const monoAudio = path.join(testDir, 'mono_audio.mp4');
  const rate44100 = path.join(testDir, 'rate_44100.mp4');
  const outOfSpecLoudness = path.join(testDir, 'out_of_spec_loudness.mp4');
  const clippingTruePeak = path.join(testDir, 'clipping_true_peak.mp4');
  const validOutput = path.join(testDir, 'valid_output.mp4');

  // Generate test fixtures
  console.log('Generating test fixtures with FFmpeg...');
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -an -c:v libx264 "${noAudio}"`, { stdio: 'ignore' });
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a mp3 "${mp3Audio}"`, { stdio: 'ignore' });
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a aac -ac 1 -ar 48000 "${monoAudio}"`, { stdio: 'ignore' });
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a aac -ac 2 -ar 44100 "${rate44100}"`, { stdio: 'ignore' });
  // Quiet audio: ~-35 LUFS (outside [-15, -13] LUFS)
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=3 -af "volume=-25dB" -c:v libx264 -c:a aac -ac 2 -ar 48000 "${outOfSpecLoudness}"`, { stdio: 'ignore' });

  // Clipping audio: Integrated Loudness in [-15, -13] LUFS (-13.9 LUFS) but True Peak > -1.0 dBTP (+1.3 dBTP)
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x240:rate=30 -filter_complex "sine=f=440:d=3,loudnorm=I=-14.2:TP=-2[bg];sine=f=1000:d=0.01,volume=10[click];[click]adelay=1000|1000[dclick];[bg][dclick]amix=inputs=2:duration=first:normalize=0[aout]" -map 0:v -map "[aout]" -c:v libx264 -c:a aac -ac 2 -ar 48000 "${clippingTruePeak}"`, { stdio: 'ignore' });

  // Compliant audio: -14.0 LUFS, <= -1.0 dBTP, 48000Hz stereo AAC
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=3 -af "loudnorm=I=-14:TP=-1.5:LRA=7" -c:v libx264 -c:a aac -ac 2 -ar 48000 "${validOutput}"`, { stdio: 'ignore' });

  console.log('Running test assertions...\n');

  // 1. Missing file
  try {
    validatePostRenderAudioQA(nonExistent);
    console.error('❌ TEST 1 FAILED: Expected missing file to throw.');
    allPassed = false;
  } catch (e) {
    if (e.message.includes('CRITICAL AUDIO QA FAILED') && e.message.includes('has no audio stream')) {
      console.log('✓ TEST 1 PASSED: Missing output file triggers baseline audio stream failure.');
    } else {
      console.error('❌ TEST 1 FAILED: Unexpected error message:', e.message);
      allPassed = false;
    }
  }

  // 2. Video with no audio
  try {
    validatePostRenderAudioQA(noAudio);
    console.error('❌ TEST 2 FAILED: Expected video without audio to throw.');
    allPassed = false;
  } catch (e) {
    if (e.message.includes('CRITICAL AUDIO QA FAILED: Output video') && e.message.includes('has no audio stream!')) {
      console.log('✓ TEST 2 PASSED: Video missing audio stream cleanly rejected.');
    } else {
      console.error('❌ TEST 2 FAILED:', e.message);
      allPassed = false;
    }
  }

  // 3. Wrong audio codec
  try {
    validatePostRenderAudioQA(mp3Audio);
    console.error('❌ TEST 3 FAILED: Expected non-AAC audio to throw.');
    allPassed = false;
  } catch (e) {
    if (e.message.includes("CRITICAL AUDIO QA FAILED: Expected audio codec 'aac'")) {
      console.log('✓ TEST 3 PASSED: Non-AAC audio codec cleanly rejected.');
    } else {
      console.error('❌ TEST 3 FAILED:', e.message);
      allPassed = false;
    }
  }

  // 4. Mono audio
  try {
    validatePostRenderAudioQA(monoAudio);
    console.error('❌ TEST 4 FAILED: Expected mono audio to throw.');
    allPassed = false;
  } catch (e) {
    if (e.message.includes('CRITICAL AUDIO QA FAILED: Expected 2 channels (stereo)')) {
      console.log('✓ TEST 4 PASSED: Mono audio stream cleanly rejected.');
    } else {
      console.error('❌ TEST 4 FAILED:', e.message);
      allPassed = false;
    }
  }

  // 5. Wrong sample rate
  try {
    validatePostRenderAudioQA(rate44100);
    console.error('❌ TEST 5 FAILED: Expected 44100 Hz audio to throw.');
    allPassed = false;
  } catch (e) {
    if (e.message.includes('CRITICAL AUDIO QA FAILED: Expected 48000 Hz sample rate')) {
      console.log('✓ TEST 5 PASSED: Non-48000Hz sample rate cleanly rejected.');
    } else {
      console.error('❌ TEST 5 FAILED:', e.message);
      allPassed = false;
    }
  }

  // 6. Integrated Loudness outside [-15.0, -13.0] LUFS
  try {
    validatePostRenderAudioQA(outOfSpecLoudness);
    console.error('❌ TEST 6 FAILED: Expected out-of-spec loudness to throw.');
    allPassed = false;
  } catch (e) {
    if (e.message.includes('CRITICAL AUDIO QA FAILED: Final Integrated Loudness') && e.message.includes('is outside acceptable tolerance [-15.0, -13.0] LUFS!')) {
      console.log('✓ TEST 6 PASSED: Out-of-spec Integrated Loudness rejected cleanly (no false SUCCESS).');
    } else {
      console.error('❌ TEST 6 FAILED:', e.message);
      allPassed = false;
    }
  }

  // 7. True Peak > -1.0 dBTP
  try {
    validatePostRenderAudioQA(clippingTruePeak);
    console.error('❌ TEST 7 FAILED: Expected clipping True Peak to throw.');
    allPassed = false;
  } catch (e) {
    if (e.message.includes('CRITICAL AUDIO QA FAILED: Final True Peak') && e.message.includes('exceeds limit (-1.0 dBTP)!')) {
      console.log('✓ TEST 7 PASSED: True Peak exceeding -1.0 dBTP rejected cleanly (no false SUCCESS).');
    } else {
      console.error('❌ TEST 7 FAILED:', e.message);
      allPassed = false;
    }
  }

  // 8. Fully Compliant Audio
  try {
    const res = validatePostRenderAudioQA(validOutput);
    if (res.passed && res.codec === 'aac' && res.channels === 2 && res.sampleRate === 48000 && res.lufs >= -15.0 && res.lufs <= -13.0 && res.truePeak <= -1.0) {
      console.log(`✓ TEST 8 PASSED: Fully compliant video passes Audio QA (LUFS=${res.lufs}, TP=${res.truePeak}).`);
    } else {
      console.error('❌ TEST 8 FAILED: Compliant output did not pass:', res);
      allPassed = false;
    }
  } catch (e) {
    console.error('❌ TEST 8 FAILED:', e.message);
    allPassed = false;
  }

  // Cleanup
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n==================================================================');
  if (allPassed) {
    console.log('✓ ALL 8 FINAL QA MODULE TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('❌ FINAL QA MODULE TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
