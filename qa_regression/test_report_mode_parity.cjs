const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('==================================================================');
console.log('      TESTING --report RUNTIME PARITY CHARACTERIZATION');
console.log('==================================================================\n');

let allPassed = true;
const testDir = path.resolve('qa_regression', 'test_report_fixture');
fs.mkdirSync(testDir, { recursive: true });

const testSrt = path.join(testDir, 'sample.srt');
fs.writeFileSync(testSrt, `1\n00:00:00,000 --> 00:00:02,000\nXin chao Viet Nam.\n`, 'utf8');

const testVideo = path.join(testDir, 'sample_video.mp4');
execSync(`ffmpeg -y -f lavfi -i testsrc=duration=2:size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -c:a aac "${testVideo}"`, { stdio: 'ignore' });

// 1. --report without other args triggers baseline video file not found check
const res1 = spawnSync('node', ['pipeline.js', '--report'], { encoding: 'utf8' });
if (res1.status !== 0 && res1.stderr.includes('Input video file not found at:')) {
  console.log('✓ TEST 1 PASSED: node pipeline.js --report triggers baseline video existence check (exact main parity).');
} else {
  console.error('❌ TEST 1 FAILED:', { status: res1.status, stdout: res1.stdout, stderr: res1.stderr });
  allPassed = false;
}

// 2. --report with --srt sample.srt triggers audio check on positional videoPath (exact main parity)
const res2 = spawnSync('node', ['pipeline.js', '--srt', testSrt, '--report'], { encoding: 'utf8' });
if (res2.status !== 0 && res2.stderr.includes('has no audio stream')) {
  console.log('✓ TEST 2 PASSED: node pipeline.js --srt ... --report triggers audio validation on positional videoPath (exact main parity).');
} else {
  console.error('❌ TEST 2 FAILED:', { status: res2.status, stdout: res2.stdout, stderr: res2.stderr });
  allPassed = false;
}

// Cleanup
if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

console.log('\n==================================================================');
if (allPassed) {
  console.log('✓ ALL --report PARITY CHARACTERIZATION TESTS PASSED 100%!');
  process.exit(0);
} else {
  console.error('❌ --report PARITY TESTS FAILED.');
  process.exit(1);
}
