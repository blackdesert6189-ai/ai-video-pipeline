const path = require('path');

async function runTests() {
  console.log('==================================================================');
  console.log('                 TESTING SRT MODULE (src/pipeline/srt.js)');
  console.log('==================================================================\n');

  const { pathToFileURL } = require('url');
  const { parseSRT, timeToSeconds } = await import(pathToFileURL(path.resolve('src', 'pipeline', 'srt.js')).href);

  let allPassed = true;

  // 1. Test timeToSeconds precision
  const t1 = timeToSeconds('01', '02', '03', '456');
  if (t1 === 3723.456) {
    console.log('✓ TEST 1 PASSED: timeToSeconds accurately computes 01:02:03,456 -> 3723.456s');
  } else {
    console.error('❌ TEST 1 FAILED: Expected 3723.456, got', t1);
    allPassed = false;
  }

  // 2. Test Standard SRT with Vietnamese Unicode and milliseconds
  const srtStandard = `1
00:00:01,250 --> 00:00:04,750
Xin chào Việt Nam, đây là thực phẩm bổ sung.

2
00:00:05,000 --> 00:00:08,120
Creatine giúp tăng cường năng lượng tế bào.
`;
  const cues1 = parseSRT(srtStandard);
  if (cues1.length === 2 && cues1[0].startTime === 1.25 && cues1[0].endTime === 4.75 && cues1[0].text === 'Xin chào Việt Nam, đây là thực phẩm bổ sung.' && cues1[1].text === 'Creatine giúp tăng cường năng lượng tế bào.') {
    console.log('✓ TEST 2 PASSED: Standard SRT with Vietnamese Unicode and millisecond precision parsed cleanly.');
  } else {
    console.error('❌ TEST 2 FAILED:', cues1);
    allPassed = false;
  }

  // 3. Test CRLF line endings (\r\n)
  const srtCrlf = "1\r\n00:00:00,000 --> 00:00:02,000\r\nDòng thứ nhất\r\n\r\n2\r\n00:00:02,500 --> 00:00:05,000\r\nDòng thứ hai\r\n";
  const cues2 = parseSRT(srtCrlf);
  if (cues2.length === 2 && cues2[0].text === 'Dòng thứ nhất' && cues2[1].text === 'Dòng thứ hai') {
    console.log('✓ TEST 3 PASSED: CRLF line endings handled seamlessly.');
  } else {
    console.error('❌ TEST 3 FAILED:', cues2);
    allPassed = false;
  }

  // 4. Test Multiline Subtitle Text
  const srtMulti = `1
00:00:00,100 --> 00:00:03,500
Dòng 1 trong cùng một cue
Dòng 2 tiếp theo
Dòng 3 kết thúc
`;
  const cues3 = parseSRT(srtMulti);
  if (cues3.length === 1 && cues3[0].text === 'Dòng 1 trong cùng một cue Dòng 2 tiếp theo Dòng 3 kết thúc') {
    console.log('✓ TEST 4 PASSED: Multiline subtitle cues properly concatenated with spaces.');
  } else {
    console.error('❌ TEST 4 FAILED:', cues3);
    allPassed = false;
  }

  // 5. Test empty string input
  if (parseSRT('').length === 0) {
    console.log('✓ TEST 5 PASSED: Empty SRT string input safely returns empty array.');
  } else {
    console.error('❌ TEST 5 FAILED: Expected empty array for empty string');
    allPassed = false;
  }

  console.log('\n==================================================================');
  if (allPassed) {
    console.log('✓ ALL SRT MODULE TESTS PASSED 100%!');
    process.exit(0);
  } else {
    console.error('❌ SRT MODULE TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
