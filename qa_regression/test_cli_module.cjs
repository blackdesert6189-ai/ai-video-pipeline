const path = require('path');
const { pathToFileURL } = require('url');

async function runTests() {
  console.log('==================================================================');
  console.log('                 TESTING CLI MODULE (src/pipeline/cli.js)');
  console.log('==================================================================\n');

  const { parseArgs } = await import(pathToFileURL(path.resolve('src', 'pipeline', 'cli.js')).href);

  let allPassed = true;

  // 1. Pure Positional Arguments: [srt, video, output]
  const res1 = parseArgs(['input/sub.srt', 'input/video.mp4', 'output/final.mp4']);
  if (res1.srtPath === 'input/sub.srt' && res1.videoPath === 'input/video.mp4' && res1.outputPath === 'output/final.mp4' && res1.skipGemini === false && res1.reportOnly === false) {
    console.log('✓ TEST 1 PASSED: Pure positional arguments correctly mapped [srtPath, videoPath, outputPath].');
  } else {
    console.error('❌ TEST 1 FAILED:', res1);
    allPassed = false;
  }

  // 2. Pure Named Flags
  const res2 = parseArgs(['--video', 'input/video.mp4', '--srt', 'input/sub.srt', '--output', 'output/final.mp4']);
  if (res2.videoPath === 'input/video.mp4' && res2.srtPath === 'input/sub.srt' && res2.outputPath === 'output/final.mp4') {
    console.log('✓ TEST 2 PASSED: Pure named flags parsed accurately regardless of order.');
  } else {
    console.error('❌ TEST 2 FAILED:', res2);
    allPassed = false;
  }

  // 3. Named Flags + --skip-gemini
  const res3 = parseArgs(['--video', 'input/video.mp4', '--output', 'output/final.mp4', '--skip-gemini']);
  if (res3.videoPath === 'input/video.mp4' && res3.outputPath === 'output/final.mp4' && res3.skipGemini === true) {
    console.log('✓ TEST 3 PASSED: Named flags with --skip-gemini handled properly.');
  } else {
    console.error('❌ TEST 3 FAILED:', res3);
    allPassed = false;
  }

  // 4. --report Flag
  const res4 = parseArgs(['--srt', 'transcript.srt', '--report']);
  if (res4.reportOnly === true && res4.srtPath === 'transcript.srt') {
    console.log('✓ TEST 4 PASSED: --report flag handled properly.');
  } else {
    console.error('❌ TEST 4 FAILED:', res4);
    allPassed = false;
  }

  // 5. Batch Mode: --batch & --output-dir
  const res5 = parseArgs(['--batch', './batch_input', '--output-dir', './batch_output']);
  if (res5.batchDir === path.resolve('./batch_input') && res5.outputDir === path.resolve('./batch_output')) {
    console.log('✓ TEST 5 PASSED: --batch and --output-dir resolved accurately.');
  } else {
    console.error('❌ TEST 5 FAILED:', res5);
    allPassed = false;
  }

  // 6. Batch Mode Aliases: --batch-dir & --out-dir
  const res6 = parseArgs(['--batch-dir', './batch_input2', '--out-dir', './batch_output2']);
  if (res6.batchDir === path.resolve('./batch_input2') && res6.outputDir === path.resolve('./batch_output2')) {
    console.log('✓ TEST 6 PASSED: --batch-dir and --out-dir aliases resolved accurately.');
  } else {
    console.error('❌ TEST 6 FAILED:', res6);
    allPassed = false;
  }

  // 7. Mixed Named and Positional Inputs
  // When only --output is named, args[0] ('input/sub.srt') falls back to srtPath, args[1] ('input/video.mp4') falls back to videoPath
  const res7 = parseArgs(['input/sub.srt', 'input/video.mp4', '--output', 'output/out_named.mp4']);
  if (res7.srtPath === 'input/sub.srt' && res7.videoPath === 'input/video.mp4' && res7.outputPath === 'output/out_named.mp4') {
    console.log('✓ TEST 7 PASSED: Mixed named and positional arguments follow exact baseline semantics.');
  } else {
    console.error('❌ TEST 7 FAILED:', res7);
    allPassed = false;
  }

  // 8. Empty Arguments (Safe Return, NO process.exit)
  const res8 = parseArgs([]);
  if (res8 && res8.videoPath === '' && res8.skipGemini === false && res8.batchDir === '') {
    console.log('✓ TEST 8 PASSED: Empty arguments return plain options defaults without crashing or exiting.');
  } else {
    console.error('❌ TEST 8 FAILED:', res8);
    allPassed = false;
  }

  console.log('\n==================================================================');
  if (allPassed) {
    console.log('✓ ALL CLI MODULE CHARACTERIZATION TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('❌ CLI MODULE TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
