const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('==================================================================');
console.log('   FULL PIPELINE E2E REGRESSION TEST WITH FROZEN GEMINI CACHE');
console.log('==================================================================\n');

let allPassed = true;

// Create isolated test fixture directory
const fixtureDir = path.resolve('qa_regression', 'pipeline_e2e_fixture');
fs.mkdirSync(fixtureDir, { recursive: true });

const testVideo = path.join(fixtureDir, 'test_input.mp4');
const testSrt = path.join(fixtureDir, 'transcripts.srt');
const testCache = path.join(fixtureDir, '_gemini_cache.json');
const testOutput = path.join(fixtureDir, 'test_pipeline_output.mp4');

// 1. Create a 6-second test video with voice tone and audio stream
execSync(`ffmpeg -y -f lavfi -i testsrc=duration=6:size=1080x1920:rate=30 -f lavfi -i sine=frequency=220:duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 "${testVideo}"`, { stdio: 'ignore' });

// 2. Create matching SRT transcript
const srtContent = `1
00:00:00,000 --> 00:00:03,000
Ngừng nhập calo bằng tay mỗi tối.

2
00:00:03,000 --> 00:00:06,000
Chụp ảnh bữa ăn bằng camera AI.
`;
fs.writeFileSync(testSrt, srtContent, 'utf8');

// 3. Create matching frozen _gemini_cache.json
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

console.log('[E2E Pipeline] Running actual pipeline.js with --skip-gemini on frozen cache fixture...');
try {
  execSync(`node pipeline.js --skip-gemini --video "${testVideo}" --srt "${testSrt}" --output "${testOutput}"`, {
    cwd: path.resolve('.'),
    stdio: 'inherit'
  });
  console.log('[E2E Pipeline] ✓ Full pipeline execution completed with exit code 0.');
} catch (err) {
  console.error('[E2E Pipeline] ❌ Pipeline execution failed:', err.message);
  allPassed = false;
}

// 4. Validate output video and audio
if (fs.existsSync(testOutput)) {
  console.log('\n[E2E Pipeline] Validating generated output video & audio QA...');
  
  // Probe video
  const probeRaw = execSync(`ffprobe -v error -show_format -show_streams -of json "${testOutput}"`, { encoding: 'utf8' });
  const meta = JSON.parse(probeRaw);
  const vStream = meta.streams.find(s => s.codec_type === 'video');
  const aStream = meta.streams.find(s => s.codec_type === 'audio');

  if (!vStream || vStream.width !== 1080 || vStream.height !== 1920) {
    console.error('❌ Video stream invalid or dimensions incorrect:', vStream);
    allPassed = false;
  } else {
    console.log(`✓ Video stream valid: ${vStream.codec_name} 1080x1920 @ ${vStream.r_frame_rate} fps`);
  }

  if (!aStream || aStream.codec_name !== 'aac' || Number(aStream.channels) !== 2 || Number(aStream.sample_rate) !== 48000) {
    console.error('❌ Audio stream invalid format:', aStream);
    allPassed = false;
  } else {
    console.log(`✓ Audio stream format valid: AAC 48000 Hz Stereo`);
  }

  // Audio QA Loudness & True Peak
  const loudRaw = execSync(`ffmpeg -i "${testOutput}" -vn -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1`, { encoding: 'utf8' });
  const loudMatch = loudRaw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (loudMatch) {
    const loud = JSON.parse(loudMatch[0]);
    const lufs = parseFloat(loud.input_i);
    const tp = parseFloat(loud.input_tp);
    console.log(`[Audio QA] Integrated Loudness: ${lufs} LUFS | True Peak: ${tp} dBTP`);

    if (lufs >= -15.0 && lufs <= -13.0 && tp <= -1.0) {
      console.log('✓ Post-Render Audio QA PASSED on fresh pipeline render!');
    } else {
      console.error('❌ Audio QA FAILED: Metrics out of tolerance', { lufs, tp });
      allPassed = false;
    }
  } else {
    console.error('❌ Could not measure loudness on output');
    allPassed = false;
  }
} else {
  console.error('❌ Output file was not created:', testOutput);
  allPassed = false;
}

// Cleanup fixture directory
if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });

console.log('\n==================================================================');
if (allPassed) {
  console.log('✓ FULL PIPELINE E2E REGRESSION TEST PASSED 100%!');
  process.exit(0);
} else {
  console.error('❌ FULL PIPELINE E2E REGRESSION TEST FAILED.');
  process.exit(1);
}
