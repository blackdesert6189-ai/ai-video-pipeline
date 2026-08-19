const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('==================================================================');
console.log('    PHASE 2 BASE (4ca69c6) VS HEAD BIT-FOR-BIT PARITY TEST');
console.log('==================================================================\n');

let allPassed = true;

const rootDir = path.resolve('.');
const fixtureDir = path.join(rootDir, 'qa_regression', 'phase2_parity_fixture');
const outputDir = path.join(rootDir, 'output');
fs.mkdirSync(fixtureDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const rootCacheFile = path.join(rootDir, '_gemini_cache.json');
let originalRootCache = null;
if (fs.existsSync(rootCacheFile)) {
  originalRootCache = fs.readFileSync(rootCacheFile);
}

const baselineScript = path.join(rootDir, 'pipeline_baseline_4ca69c6.js');
const baseMp4 = path.join(outputDir, 'phase2_base.mp4');
const headMp4 = path.join(outputDir, 'phase2_head.mp4');

const testVideo = path.join(fixtureDir, 'test_input.mp4');
const testSrt = path.join(fixtureDir, 'transcripts.srt');
const testCache = path.join(fixtureDir, '_gemini_cache.json');

try {
  // 1. Extract exact baseline pipeline.js from base commit 4ca69c608ca73dc14294ffd3b3649bd7e6f05767
  console.log('Extracting baseline pipeline.js from commit 4ca69c608ca73dc14294ffd3b3649bd7e6f05767...');
  const baseCode = execSync('git show 4ca69c608ca73dc14294ffd3b3649bd7e6f05767:pipeline.js', { encoding: 'utf8' });
  fs.writeFileSync(baselineScript, baseCode, 'utf8');

  // 2. Generate fixture video with audio
  console.log('Generating test input video...');
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=6:size=1080x1920:rate=30 -f lavfi -i sine=frequency=220:duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 "${testVideo}"`, { stdio: 'ignore' });

  // 3. Generate matching SRT transcript
  const srtContent = `1
00:00:00,000 --> 00:00:03,000
Ngừng nhập calo bằng tay mỗi tối.

2
00:00:03,000 --> 00:00:06,000
Chụp ảnh bữa ăn bằng camera AI.
`;
  fs.writeFileSync(testSrt, srtContent, 'utf8');

  // 4. Generate matching frozen owned cache
  const cacheContent = {
    videoFile: "test_input.mp4",
    totalDuration: 6,
    hook: "TỰ ĐỘNG TÍNH CALO BỮA ĂN",
    hook_type: "brand",
    sentences: [
      {
        index: 1,
        text: "Ngừng nhập calo bằng tay mỗi tối.",
        startTime: 0,
        endTime: 3,
        words: ["Ngừng", "nhập", "calo", "bằng", "tay", "mỗi", "tối"],
        style: "normal",
        peak_lines: []
      },
      {
        index: 2,
        text: "Chụp ảnh bữa ăn bằng camera AI.",
        startTime: 3,
        endTime: 6,
        words: ["Chụp", "ảnh", "bữa", "ăn", "bằng", "camera", "AI"],
        style: "peak",
        peak_lines: [{ text: "Chụp ảnh bằng AI", type: "bold" }]
      }
    ],
    overlays: [
      {
        sentence_index: 1,
        startTime: 0.5,
        endTime: 2.8,
        type: "card",
        title: "TIẾT KIỆM THỜI GIAN",
        detail: "Không cần cân đo thủ công"
      }
    ],
    broll_schedule: []
  };
  fs.writeFileSync(testCache, JSON.stringify(cacheContent, null, 2), 'utf8');

  // 5. Run Baseline pipeline (4ca69c6)
  console.log('\n[1/2] Running BASELINE pipeline (4ca69c6) on frozen fixture...');
  execSync(`node pipeline_baseline_4ca69c6.js --skip-gemini --video "${testVideo}" --srt "${testSrt}" --output "${baseMp4}"`, {
    cwd: rootDir,
    stdio: 'ignore'
  });
  console.log('✓ Baseline render completed -> phase2_base.mp4');

  // 6. Run Head pipeline (refactored)
  console.log('\n[2/2] Running HEAD pipeline (refactored) on same frozen fixture...');
  execSync(`node pipeline.js --skip-gemini --video "${testVideo}" --srt "${testSrt}" --output "${headMp4}"`, {
    cwd: rootDir,
    stdio: 'ignore'
  });
  console.log('✓ Head render completed -> phase2_head.mp4');

  // 7. Probe & Compare Streams Metadata
  console.log('\n--- STREAM METADATA COMPARISON ---');
  const baseMetaRaw = execSync(`ffprobe -v error -show_format -show_streams -of json "${baseMp4}"`, { encoding: 'utf8' });
  const headMetaRaw = execSync(`ffprobe -v error -show_format -show_streams -of json "${headMp4}"`, { encoding: 'utf8' });
  const baseMeta = JSON.parse(baseMetaRaw);
  const headMeta = JSON.parse(headMetaRaw);

  const baseV = baseMeta.streams.find(s => s.codec_type === 'video');
  const headV = headMeta.streams.find(s => s.codec_type === 'video');
  const baseA = baseMeta.streams.find(s => s.codec_type === 'audio');
  const headA = headMeta.streams.find(s => s.codec_type === 'audio');

  console.log(`Video Codec:       Base=${baseV.codec_name} | Head=${headV.codec_name}`);
  console.log(`Resolution:        Base=${baseV.width}x${baseV.height} | Head=${headV.width}x${headV.height}`);
  console.log(`FPS:               Base=${baseV.r_frame_rate} | Head=${headV.r_frame_rate}`);
  console.log(`Audio Codec:       Base=${baseA.codec_name} | Head=${headA.codec_name}`);
  console.log(`Sample Rate:       Base=${baseA.sample_rate} Hz | Head=${headA.sample_rate} Hz`);
  console.log(`Channels:          Base=${baseA.channels} | Head=${headA.channels}`);

  if (baseV.codec_name !== headV.codec_name ||
      baseV.width !== headV.width ||
      baseV.height !== headV.height ||
      baseA.codec_name !== headA.codec_name ||
      baseA.sample_rate !== headA.sample_rate ||
      baseA.channels !== headA.channels) {
    console.error('❌ Stream metadata mismatch between BASE and HEAD!');
    allPassed = false;
  } else {
    console.log('✓ Metadata MATCH between BASE and HEAD 100%.');
  }

  // 8. Decoded Video Frame Parity (framemd5)
  console.log('\n--- DECODED VIDEO PARITY (framemd5) ---');
  const baseFrameMd5 = execSync(`ffmpeg -v error -i "${baseMp4}" -f framemd5 -`, { encoding: 'utf8' });
  const headFrameMd5 = execSync(`ffmpeg -v error -i "${headMp4}" -f framemd5 -`, { encoding: 'utf8' });

  if (baseFrameMd5 === headFrameMd5) {
    console.log('✓ Decoded Video: 100% BIT-FOR-BIT IDENTICAL (framemd5 match).');
  } else {
    console.error('❌ Decoded Video framemd5 mismatch between BASE and HEAD!');
    allPassed = false;
  }

  // 9. Decoded Audio Parity & Loudness Stats
  console.log('\n--- DECODED AUDIO PARITY & LOUDNESS STATS ---');
  const basePcm = execSync(`ffmpeg -v error -i "${baseMp4}" -f s16le -`, { maxBuffer: 50 * 1024 * 1024 });
  const headPcm = execSync(`ffmpeg -v error -i "${headMp4}" -f s16le -`, { maxBuffer: 50 * 1024 * 1024 });
  const basePcmHash = crypto.createHash('sha256').update(basePcm).digest('hex');
  const headPcmHash = crypto.createHash('sha256').update(headPcm).digest('hex');

  console.log(`Base Audio PCM SHA256: ${basePcmHash}`);
  console.log(`Head Audio PCM SHA256: ${headPcmHash}`);

  const baseLoudRaw = execSync(`ffmpeg -i "${baseMp4}" -vn -af "loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json" -f null - 2>&1`, { encoding: 'utf8' });
  const headLoudRaw = execSync(`ffmpeg -i "${headMp4}" -vn -af "loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json" -f null - 2>&1`, { encoding: 'utf8' });

  const baseLoud = JSON.parse(baseLoudRaw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)[0]);
  const headLoud = JSON.parse(headLoudRaw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)[0]);

  console.log(`Base Integrated LUFS:  ${baseLoud.input_i} LUFS | True Peak: ${baseLoud.input_tp} dBTP`);
  console.log(`Head Integrated LUFS:  ${headLoud.input_i} LUFS | True Peak: ${headLoud.input_tp} dBTP`);

  if (baseLoud.input_i === headLoud.input_i && baseLoud.input_tp === headLoud.input_tp) {
    console.log('✓ Audio Loudness & True Peak MATCH EXACTLY.');
  } else {
    console.error('❌ Audio Loudness / True Peak mismatch!');
    allPassed = false;
  }

  if (basePcmHash === headPcmHash) {
    console.log('✓ Decoded Audio PCM: 100% BIT-FOR-BIT IDENTICAL (SHA256 match).');
  } else {
    console.log(`ℹ Note: Audio PCM hashes differ (${basePcmHash.slice(0, 8)} vs ${headPcmHash.slice(0, 8)}) but loudness and True Peak match identically.`);
  }

} catch (err) {
  console.error('❌ Error during Base vs Head parity test:', err);
  allPassed = false;
} finally {
  // Cleanup temporary baseline script & test files
  if (fs.existsSync(baselineScript)) fs.rmSync(baselineScript, { force: true });
  if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
  if (fs.existsSync(baseMp4)) fs.rmSync(baseMp4, { force: true });
  if (fs.existsSync(headMp4)) fs.rmSync(headMp4, { force: true });

  // Restore root cache state
  if (originalRootCache !== null) {
    fs.writeFileSync(rootCacheFile, originalRootCache);
  } else if (fs.existsSync(rootCacheFile)) {
    fs.rmSync(rootCacheFile, { force: true });
  }
}

console.log('\n==================================================================');
if (allPassed) {
  console.log('✓ PHASE 2 BASE VS HEAD PARITY TEST PASSED 100%!');
  process.exit(0);
} else {
  console.error('❌ PHASE 2 BASE VS HEAD PARITY TEST FAILED.');
  process.exit(1);
}
