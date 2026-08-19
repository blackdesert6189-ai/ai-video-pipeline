const path = require('path');
const { pathToFileURL } = require('url');

async function runTests() {
  console.log('==================================================================');
  console.log('       TESTING FFMPEG MODULE (src/pipeline/ffmpeg.js)');
  console.log('==================================================================\n');

  const { buildAudioFilterGraph, buildFinalFfmpegCommand } = await import(
    pathToFileURL(path.resolve('src', 'pipeline', 'ffmpeg.js')).href
  );

  let allPassed = true;

  // 1. Test Single-Pass Audio Filter Graph (no loudStats fallback)
  const fg1 = buildAudioFilterGraph({
    audioPlan: [
      { filePath: 'sfx1.mp3', vol: -10, delayMs: 500 },
      { filePath: 'sfx2.mp3', vol: -8, delayMs: 2000 }
    ],
    loudStats: null,
    sfxStartInputIdx: 2
  });

  if (
    fg1.voiceChain.includes('highpass=f=80') &&
    fg1.sfxFilters.length === 2 &&
    fg1.sfxFilters[0] === '[2:a]volume=-10dB,adelay=500|500[sfx0]' &&
    fg1.sfxFilters[1] === '[3:a]volume=-8dB,adelay=2000|2000[sfx1]' &&
    fg1.audioMixStr.includes('amix=inputs=3:duration=first') &&
    fg1.loudnormFilter === 'loudnorm=I=-14:TP=-1.5:LRA=7' &&
    fg1.sfxInputsStr === ' -i "sfx1.mp3" -i "sfx2.mp3"'
  ) {
    console.log('✓ TEST 1 PASSED: buildAudioFilterGraph produces exact fallback filter graph and input string.');
  } else {
    console.error('❌ TEST 1 FAILED:', fg1);
    allPassed = false;
  }

  // 2. Test Measured 2-Pass Audio Filter Graph (with loudStats)
  const mockLoudStats = {
    input_i: "-16.2",
    input_lra: "5.4",
    input_tp: "-2.1",
    input_thresh: "-26.5",
    target_offset: "0.2"
  };

  const fg2 = buildAudioFilterGraph({
    audioPlan: [],
    loudStats: mockLoudStats,
    sfxStartInputIdx: 2
  });

  if (
    fg2.audioMixStr === '[vproc]anull[mixed_audio]' &&
    fg2.loudnormFilter.includes('measured_i=-16.2:measured_lra=5.4:measured_tp=-2.1:measured_thresh=-26.5:offset=0.2:linear=true') &&
    fg2.sfxInputsStr === ''
  ) {
    console.log('✓ TEST 2 PASSED: buildAudioFilterGraph produces exact 2-pass linear loudnorm parameters.');
  } else {
    console.error('❌ TEST 2 FAILED:', fg2);
    allPassed = false;
  }

  // 3. Test Final FFmpeg Command Assembly
  const cmd = buildFinalFfmpegCommand({
    videoPath: 'input.mp4',
    brollFilterInputs: ' -i "broll1.mp4"',
    fps: 30,
    framePattern: 'frames/frame_%05d.png',
    sfxInputsStr: ' -i "sfx1.mp3"',
    combinedFilterComplex: '[0:v]eq=1[outv];[0:a]anull[outa]',
    outputPath: 'output.mp4'
  });

  const expectedCmd = 'ffmpeg -y -i "input.mp4" -i "broll1.mp4" -framerate 30 -i "frames/frame_%05d.png" -i "sfx1.mp3" -filter_complex "[0:v]eq=1[outv];[0:a]anull[outa]" -map "[outv]" -map "[outa]" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -ac 2 "output.mp4"';

  if (cmd === expectedCmd) {
    console.log('✓ TEST 3 PASSED: buildFinalFfmpegCommand produces bit-for-bit identical command string.');
  } else {
    console.error('❌ TEST 3 FAILED: Command mismatch!\nExpected:', expectedCmd, '\nGot:', cmd);
    allPassed = false;
  }

  console.log('\n==================================================================');
  if (allPassed) {
    console.log('✓ ALL FFMPEG MODULE TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('❌ FFMPEG MODULE TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
