const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

fs.mkdirSync('qa_regression/vis_checkpoints/before', { recursive: true });
fs.mkdirSync('qa_regression/vis_checkpoints/after', { recursive: true });

const tests = [
  {
    name: 'creatine',
    beforeFile: 'output/creatine.mp4',
    afterFile: 'output/creatine_mastered.mp4',
    timestamps: ['2.0', '15.0', '30.0', '60.0', '90.0', '110.0', '118.0'],
    requireExact: true // Audio mastering must preserve exact video stream
  },
  {
    name: 'di-bo-chuyen-sau',
    beforeFile: 'output/di-bo-chuyen-sau.mp4',
    afterFile: 'output/di-bo-chuyen-sau_mastered.mp4',
    timestamps: ['2.0', '10.0', '20.0', '37.0', '55.0', '68.0', '72.0'],
    requireExact: true
  }
];

console.log('==================================================================');
console.log('  ISOLATED AUDIO REMASTER VISUAL-PRESERVATION TEST (-c:v copy)');
console.log('==================================================================\n');

let allPassed = true;
const results = [];

for (const t of tests) {
  console.log(`--- Testing: ${t.name} ---`);
  if (!fs.existsSync(t.beforeFile)) {
    console.error(`❌ FAILED: Baseline file not found: ${t.beforeFile}`);
    allPassed = false;
    continue;
  }
  if (!fs.existsSync(t.afterFile)) {
    console.error(`❌ FAILED: Target file not found: ${t.afterFile}`);
    allPassed = false;
    continue;
  }

  for (const time of t.timestamps) {
    const beforeImg = path.join('qa_regression', 'vis_checkpoints', 'before', `${t.name}_${time}s.png`);
    const afterImg = path.join('qa_regression', 'vis_checkpoints', 'after', `${t.name}_${time}s.png`);

    try {
      execSync(`ffmpeg -y -ss ${time} -i "${t.beforeFile}" -vframes 1 "${beforeImg}"`, { stdio: 'ignore' });
      execSync(`ffmpeg -y -ss ${time} -i "${t.afterFile}" -vframes 1 "${afterImg}"`, { stdio: 'ignore' });

      // Compute PSNR — must parse successfully
      const psnrRaw = execSync(`ffmpeg -i "${beforeImg}" -i "${afterImg}" -lavfi psnr -f null - 2>&1`, { encoding: 'utf8' });
      const psnrMatch = psnrRaw.match(/average:([0-9.]+|inf)/);
      if (!psnrMatch) {
        throw new Error(`Failed to parse PSNR output for ${t.name} at t=${time}s`);
      }
      const isInfPsnr = psnrMatch[1] === 'inf';
      const psnrVal = isInfPsnr ? Infinity : parseFloat(psnrMatch[1]);

      // Compute SSIM — must parse successfully
      const ssimRaw = execSync(`ffmpeg -i "${beforeImg}" -i "${afterImg}" -lavfi ssim -f null - 2>&1`, { encoding: 'utf8' });
      const ssimMatch = ssimRaw.match(/All:([0-9.]+)/);
      if (!ssimMatch) {
        throw new Error(`Failed to parse SSIM output for ${t.name} at t=${time}s`);
      }
      const ssimVal = parseFloat(ssimMatch[1]);

      // Strictly Assert Metrics
      let checkpointPassed = true;
      if (t.requireExact) {
        if (!isInfPsnr) {
          console.error(`❌ Checkpoint FAIL [t=${time}s]: Expected PSNR = inf dB, got ${psnrVal} dB`);
          checkpointPassed = false;
        }
        if (ssimVal < 1.0) {
          console.error(`❌ Checkpoint FAIL [t=${time}s]: Expected SSIM = 1.000000, got ${ssimVal}`);
          checkpointPassed = false;
        }
      }

      const displayPsnr = isInfPsnr ? 'inf' : psnrVal.toFixed(2);
      const displayDiff = isInfPsnr ? '0' : 'non-zero';
      console.log(`  [t=${time.padStart(5, ' ')}s] PSNR = ${displayPsnr.padEnd(6, ' ')} dB | SSIM = ${ssimVal.toFixed(6)} | Pixel Diff: ${displayDiff} ${checkpointPassed ? '✓' : '❌'}`);

      if (!checkpointPassed) allPassed = false;
      results.push({ name: t.name, time, psnr: displayPsnr, ssim: ssimVal, passed: checkpointPassed });
    } catch (err) {
      console.error(`❌ Error at ${t.name} t=${time}s: ${err.message}`);
      allPassed = false;
    } finally {
      if (fs.existsSync(beforeImg)) fs.rmSync(beforeImg, { force: true });
      if (fs.existsSync(afterImg)) fs.rmSync(afterImg, { force: true });
    }
  }
}

console.log('\n==================================================================');
if (allPassed) {
  console.log('✓ ALL CHECKPOINTS PASSED STRICT VISUAL ASSERTIONS (PSNR=inf dB, SSIM=1.000000)');
  process.exit(0);
} else {
  console.error('❌ VISUAL REGRESSION DETECTED: ONE OR MORE CHECKPOINTS FAILED.');
  process.exit(1);
}
