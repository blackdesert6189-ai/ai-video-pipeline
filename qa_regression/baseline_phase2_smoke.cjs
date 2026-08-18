const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('==================================================================');
console.log('         PHASE 2 BASELINE CHARACTERIZATION & SMOKE RUN');
console.log('==================================================================\n');

// 1. Run production Presenter smoke fixture with --skip-gemini
const smokeDir = path.resolve('qa_regression', 'phase2_baseline_smoke');
fs.mkdirSync(smokeDir, { recursive: true });

const smokeVideo = path.join(smokeDir, 'smoke_input.mp4');
const smokeSrt = path.join(smokeDir, 'smoke_input.srt');
const smokeCache = path.join(smokeDir, '_gemini_cache.json');
const smokeOut = path.resolve('output', 'phase2_baseline_output.mp4');
if (fs.existsSync(smokeOut)) fs.rmSync(smokeOut, { force: true });

// 6-second fixture video with audio
execSync(`ffmpeg -y -f lavfi -i testsrc=duration=6:size=1080x1920:rate=30 -f lavfi -i sine=frequency=300:duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 "${smokeVideo}"`, { stdio: 'ignore' });

// SRT
fs.writeFileSync(smokeSrt, `1\n00:00:00,000 --> 00:00:03,000\nNgừng nhập calo bằng tay mỗi tối.\n\n2\n00:00:03,000 --> 00:00:06,000\nChụp ảnh bữa ăn bằng camera AI.\n`, 'utf8');

// Valid local cache owned by smoke_input.mp4
fs.writeFileSync(smokeCache, JSON.stringify({
  videoFile: "smoke_input.mp4",
  totalDuration: 6,
  hook: "TỰ ĐỘNG TÍNH CALO BỮA ĂN",
  hook_type: "brand",
  sentences: [
    { index: 1, text: "Ngừng nhập calo bằng tay mỗi tối.", startTime: 0, endTime: 3, words: ["Ngừng", "nhập", "calo", "bằng", "tay", "mỗi", "tối"], style: "normal", peak_lines: [] },
    { index: 2, text: "Chụp ảnh bữa ăn bằng camera AI.", startTime: 3, endTime: 6, words: ["Chụp", "ảnh", "bữa", "ăn", "bằng", "camera", "AI"], style: "peak", peak_lines: [{ text: "Chụp ảnh AI", type: "bold" }] }
  ],
  overlays: [
    { sentence_index: 1, startTime: 0.5, endTime: 2.8, type: "card", title: "TIẾT KIỆM THỜI GIAN", detail: "Không cần cân đo thủ công" }
  ],
  broll_schedule: []
}, null, 2), 'utf8');

console.log('Running real production Presenter smoke pipeline...');
const res = spawnSync('node', ['pipeline.js', '--skip-gemini', '--video', smokeVideo, '--srt', smokeSrt, '--output', smokeOut], {
  cwd: path.resolve('.'),
  encoding: 'utf8'
});

console.log(`[Smoke Exit Code]: ${res.status}`);
if (res.status !== 0) {
  console.error('Smoke failed:', res.stderr || res.stdout);
  process.exit(1);
}

// Probe output
const probeRaw = execSync(`ffprobe -v error -show_format -show_streams -of json "${smokeOut}"`, { encoding: 'utf8' });
const meta = JSON.parse(probeRaw);
const vStream = meta.streams.find(s => s.codec_type === 'video');
const aStream = meta.streams.find(s => s.codec_type === 'audio');

const loudRaw = execSync(`ffmpeg -i "${smokeOut}" -vn -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1`, { encoding: 'utf8' });
const loud = JSON.parse(loudRaw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)[0]);
const lufs = parseFloat(loud.input_i);
const tp = parseFloat(loud.input_tp);

console.log('\n--- PHASE 2 BASELINE SMOKE METRICS ---');
console.log(`Output Path:       ${smokeOut}`);
console.log(`Video Codec:       ${vStream.codec_name}`);
console.log(`Resolution:        ${vStream.width}x${vStream.height}`);
console.log(`FPS:               ${vStream.r_frame_rate}`);
console.log(`Audio Codec:       ${aStream.codec_name}`);
console.log(`Sample Rate:       ${aStream.sample_rate} Hz`);
console.log(`Channels:          ${aStream.channels}`);
console.log(`Integrated LUFS:   ${lufs} LUFS`);
console.log(`True Peak:         ${tp} dBTP`);

// Cleanup fixture
if (fs.existsSync(smokeDir)) fs.rmSync(smokeDir, { recursive: true, force: true });
