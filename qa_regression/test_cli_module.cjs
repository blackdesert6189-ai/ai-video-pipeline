const path = require('path');
const { pathToFileURL } = require('url');

async function runTests() {
  console.log('==================================================================');
  console.log('                 TESTING CLI MODULE (src/pipeline/cli.js)');
  console.log('==================================================================\n');

  const { parseArgs } = await import(pathToFileURL(path.resolve('src', 'pipeline', 'cli.js')).href);

  let allPassed = true;

  // 1. Test Named Flags
  const args1 = ['--video', 'input/video.mp4', '--srt', 'input/sub.srt', '--output', 'output/final.mp4', '--skip-gemini'];
  const res1 = parseArgs(args1);
  if (res1.videoPath === 'input/video.mp4' && res1.srtPath === 'input/sub.srt' && res1.outputPath === 'output/final.mp4' && res1.skipGemini === true && res1.reportOnly === false) {
    console.log('✓ TEST 1 PASSED: Named flags parsed correctly into plain options object.');
  } else {
    console.error('❌ TEST 1 FAILED:', res1);
    allPassed = false;
  }

  // 2. Test Positional Arguments Fallback
  const args2 = ['input/sub.srt', 'input/video.mp4', 'output/final.mp4'];
  const res2 = parseArgs(args2);
  if (res2.srtPath === 'input/sub.srt' && res2.videoPath === 'input/video.mp4' && res2.outputPath === 'output/final.mp4') {
    console.log('✓ TEST 2 PASSED: Positional fallback correctly maps [srt, video, output].');
  } else {
    console.error('❌ TEST 2 FAILED:', res2);
    allPassed = false;
  }

  // 3. Test Batch Mode Arguments
  const args3 = ['--batch', './batch_input', '--output-dir', './batch_output'];
  const res3 = parseArgs(args3);
  if (res3.batchDir === path.resolve('./batch_input') && res3.outputDir === path.resolve('./batch_output')) {
    console.log('✓ TEST 3 PASSED: Batch mode directories resolved accurately.');
  } else {
    console.error('❌ TEST 3 FAILED:', res3);
    allPassed = false;
  }

  // 4. Test --report Flag
  const args4 = ['--srt', 'transcript.srt', '--report'];
  const res4 = parseArgs(args4);
  if (res4.reportOnly === true && res4.srtPath === 'transcript.srt') {
    console.log('✓ TEST 4 PASSED: --report flag handled properly.');
  } else {
    console.error('❌ TEST 4 FAILED:', res4);
    allPassed = false;
  }

  // 5. Test empty arguments (NO process.exit triggered)
  const res5 = parseArgs([]);
  if (res5 && res5.videoPath === '' && res5.skipGemini === false) {
    console.log('✓ TEST 5 PASSED: Empty arguments return defaults without throwing or exiting.');
  } else {
    console.error('❌ TEST 5 FAILED:', res5);
    allPassed = false;
  }

  console.log('\n==================================================================');
  if (allPassed) {
    console.log('✓ ALL CLI MODULE TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('❌ CLI MODULE TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
