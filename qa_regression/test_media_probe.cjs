const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function runTests() {
  console.log('==================================================================');
  console.log('          TESTING MEDIA PROBE MODULE (src/pipeline/mediaProbe.js)');
  console.log('==================================================================\n');

  const { hasAudioStream, probeAudioStream, measureLoudnormStats } = await import(
    pathToFileURL(path.resolve('src', 'pipeline', 'mediaProbe.js')).href
  );

  let allPassed = true;
  const testDir = path.resolve('qa_regression', 'test_media_probe_fixture');
  fs.mkdirSync(testDir, { recursive: true });

  const audioVideo = path.join(testDir, 'with_audio.mp4');
  const videoOnly = path.join(testDir, 'video_only.mp4');

  // Generate test files
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -f lavfi -i sine=frequency=1000:duration=2 -c:v libx264 -c:a aac -ar 48000 -ac 2 "${audioVideo}"`, { stdio: 'ignore' });
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -an -c:v libx264 "${videoOnly}"`, { stdio: 'ignore' });

  // 1. hasAudioStream positive test
  if (hasAudioStream(audioVideo) === true) {
    console.log('✓ TEST 1 PASSED: hasAudioStream correctly detects audio stream in valid video+audio.');
  } else {
    console.error('❌ TEST 1 FAILED: Expected true for file with audio.');
    allPassed = false;
  }

  // 2. hasAudioStream negative test
  if (hasAudioStream(videoOnly) === false) {
    console.log('✓ TEST 2 PASSED: hasAudioStream correctly returns false for video-only file.');
  } else {
    console.error('❌ TEST 2 FAILED: Expected false for video-only file.');
    allPassed = false;
  }

  // 3. probeAudioStream stream metadata parsing
  const aStream = probeAudioStream(audioVideo);
  if (aStream && aStream.codec_name === 'aac' && Number(aStream.channels) === 2 && Number(aStream.sample_rate) === 48000) {
    console.log('✓ TEST 3 PASSED: probeAudioStream correctly extracts codec (aac), channels (2), sample_rate (48000).');
  } else {
    console.error('❌ TEST 3 FAILED: Unexpected probeData:', aStream);
    allPassed = false;
  }

  // 4. probeAudioStream negative test
  const noStream = probeAudioStream(videoOnly);
  if (noStream === null) {
    console.log('✓ TEST 4 PASSED: probeAudioStream returns null for video-only file.');
  } else {
    console.error('❌ TEST 4 FAILED: Expected null for video-only file, got:', noStream);
    allPassed = false;
  }

  // 5. measureLoudnormStats test
  const loudStats = measureLoudnormStats(audioVideo);
  if (loudStats && typeof loudStats.input_i !== 'undefined' && typeof loudStats.input_tp !== 'undefined') {
    console.log(`✓ TEST 5 PASSED: measureLoudnormStats successfully parsed loudnorm JSON (input_i=${loudStats.input_i}, input_tp=${loudStats.input_tp}).`);
  } else {
    console.error('❌ TEST 5 FAILED: Failed to parse loudnorm stats:', loudStats);
    allPassed = false;
  }

  // Cleanup
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n==================================================================');
  if (allPassed) {
    console.log('✓ ALL MEDIA PROBE TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('❌ MEDIA PROBE TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
