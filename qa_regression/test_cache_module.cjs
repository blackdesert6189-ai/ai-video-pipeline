const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function runTests() {
  console.log('==================================================================');
  console.log('               TESTING CACHE MODULE (src/pipeline/cache.js)');
  console.log('==================================================================\n');

  const { getCacheCandidatePaths, loadOwnedCache, saveOwnedCache } = await import(pathToFileURL(path.resolve('src', 'pipeline', 'cache.js')).href);

  let allPassed = true;
  const testDir = path.resolve('qa_regression', 'test_cache_fixture');
  fs.mkdirSync(testDir, { recursive: true });

  const testVideo = path.join(testDir, 'sample_video.mp4');
  const testSrt = path.join(testDir, 'sample_video.srt');
  fs.writeFileSync(testVideo, 'dummy video', 'utf8');
  fs.writeFileSync(testSrt, 'dummy srt', 'utf8');

  // 1. Test Candidate Resolution
  const candidatesBefore = getCacheCandidatePaths(testVideo, testSrt);
  if (candidatesBefore.length === 0) {
    console.log('✓ TEST 1 PASSED: getCacheCandidatePaths returns empty array when no cache exists.');
  } else {
    console.error('❌ TEST 1 FAILED:', candidatesBefore);
    allPassed = false;
  }

  // 2. Test Missing Cache Rejection
  try {
    loadOwnedCache(testVideo, testSrt);
    console.error('❌ TEST 2 FAILED: Expected loadOwnedCache to throw when cache missing.');
    allPassed = false;
  } catch (err) {
    if (err.message.includes('CRITICAL FAIL-CLOSED: --skip-gemini was specified, but no local cache exists')) {
      console.log('✓ TEST 2 PASSED: Missing cache correctly rejected with fail-closed error.');
    } else {
      console.error('❌ TEST 2 FAILED: Unexpected error:', err.message);
      allPassed = false;
    }
  }

  // 3. Test Unowned Cache Rejection (missing videoFile)
  const cacheFile = path.join(testDir, '_gemini_cache.json');
  fs.writeFileSync(cacheFile, JSON.stringify({
    totalDuration: 12,
    sentences: [{ index: 1, text: "Sample" }]
  }, null, 2), 'utf8');

  try {
    loadOwnedCache(testVideo, testSrt);
    console.error('❌ TEST 3 FAILED: Expected loadOwnedCache to reject unowned cache.');
    allPassed = false;
  } catch (err) {
    if (err.message.includes('CRITICAL FAIL-CLOSED: Cache file') && err.message.includes('has no videoFile ownership metadata')) {
      console.log('✓ TEST 3 PASSED: Unowned cache missing videoFile metadata cleanly rejected.');
    } else {
      console.error('❌ TEST 3 FAILED: Unexpected error:', err.message);
      allPassed = false;
    }
  }

  // 4. Test Foreign Cache Rejection (videoFile mismatch)
  fs.writeFileSync(cacheFile, JSON.stringify({
    videoFile: 'other_video.mp4',
    totalDuration: 12,
    sentences: []
  }, null, 2), 'utf8');

  try {
    loadOwnedCache(testVideo, testSrt);
    console.error('❌ TEST 4 FAILED: Expected loadOwnedCache to reject foreign cache.');
    allPassed = false;
  } catch (err) {
    if (err.message.includes('CRITICAL FAIL-CLOSED: Cache file') && err.message.includes('Refusing cross-video contamination')) {
      console.log('✓ TEST 4 PASSED: Foreign cache ownership mismatch cleanly rejected.');
    } else {
      console.error('❌ TEST 4 FAILED: Unexpected error:', err.message);
      allPassed = false;
    }
  }

  // 5. Test Valid Cache Save and Load
  saveOwnedCache({
    videoPath: testVideo,
    srtPath: testSrt,
    sentences: [{ index: 1, text: "Hello" }],
    overlays: [{ type: "card", title: "Test Card" }],
    totalDuration: 15,
    hook: "TEST HOOK",
    broll_schedule: []
  });

  try {
    const loaded = loadOwnedCache(testVideo, testSrt);
    if (loaded.data.videoFile === 'sample_video.mp4' && loaded.data.hook === 'TEST HOOK' && loaded.data.totalDuration === 15) {
      console.log('✓ TEST 5 PASSED: Valid owned cache saved and loaded successfully.');
    } else {
      console.error('❌ TEST 5 FAILED: Data mismatch:', loaded);
      allPassed = false;
    }
  } catch (err) {
    console.error('❌ TEST 5 FAILED:', err.message);
    allPassed = false;
  }

  // Cleanup test fixture directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n==================================================================');
  if (allPassed) {
    console.log('✓ ALL CACHE MODULE TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('❌ CACHE MODULE TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
