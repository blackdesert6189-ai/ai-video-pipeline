/**
 * ============================================================
 * WARNING — NOT THE PRODUCTION SOURCE FOR PREMIUM REELS
 * ============================================================
 * This script uses HTML/Puppeteer rendering.
 * It is NOT approved for use as the production renderer for
 * Reel_01 or any other premium reel in the CNFI pipeline.
 *
 * Approved uses: prototype, emergency fallback (with explicit
 * user APPROVE), auxiliary assets, non-premium tasks.
 *
 * See ARCHITECTURE_DECISIONS.md ADR-001.
 * See .agents/AGENTS.md Section 4 (Architecture Lock).
 * ============================================================
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import puppeteer from 'puppeteer';
import { pathToFileURL } from 'url';

const baseDir = 'C:\\Users\\Admin\\Desktop\\CNFI_Video_Premium';
const configPath = path.join(baseDir, 'edit_config.json');
const tempDir = path.join(baseDir, 'temp_ai_reel');
const compositionHtmlPath = path.join(tempDir, 'overlay_engine.html');

console.log('[ReelsEngine v3] Bắt đầu khởi chạy bộ dựng v3 (Vertical Slice)...');

// ── ADR-001 RUNTIME GUARD ─────────────────────────────────────────────────────
// Danh sách các Reel đã được lock sang Remotion engine.
// compile_ai_reel.js KHÔNG ĐƯỢC chạy cho các Reel này.
const REMOTION_LOCKED_REELS = ['reel_01', 'reel-01'];

if (fs.existsSync(configPath)) {
  try {
    const editConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const outputName = (editConfig.output || editConfig.outputFile || '').toLowerCase();
    const isLockedReel = REMOTION_LOCKED_REELS.some(r => outputName.includes(r));
    if (isLockedReel) {
      console.error('\n╔══════════════════════════════════════════════════════════════╗');
      console.error('║  ❌  ADR-001 VIOLATION — EXECUTION BLOCKED                  ║');
      console.error('╠══════════════════════════════════════════════════════════════╣');
      console.error('║  compile_ai_reel.js không được dùng cho Reel premium.       ║');
      console.error(`║  Detected output: ${outputName.padEnd(42)}║`);
      console.error('║  Reel này đã được lock sang Remotion engine (ADR-001).      ║');
      console.error('║                                                              ║');
      console.error('║  Dùng đúng lệnh:                                            ║');
      console.error('║  cd remotion_engine                                          ║');
      console.error('║  npx remotion render src/index.ts Scene <output> \\          ║');
      console.error('║    --props=props_c.json --overwrite                          ║');
      console.error('║                                                              ║');
      console.error('║  Docs: facebook/ARCHITECTURE_DECISIONS.md ADR-001           ║');
      console.error('╚══════════════════════════════════════════════════════════════╝\n');
      process.exit(1);
    }
  } catch (e) {
    // Config parse error — không block, chỉ warn
    console.warn('[ADR-001 Guard] Không đọc được edit_config.json để kiểm tra:', e.message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Tạo thư mục tạm đồng bộ ngay từ đầu
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}


// Helper tải file từ CDN
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function prepareAssets() {
  const threeDest = path.join(tempDir, 'three.min.js');
  const gsapDest = path.join(tempDir, 'gsap.min.js');

  if (!fs.existsSync(threeDest)) {
    console.log('[ReelsEngine v3] Đang tải Three.js...');
    await downloadFile('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', threeDest);
  }
  if (!fs.existsSync(gsapDest)) {
    console.log('[ReelsEngine v3] Đang tải GSAP...');
    await downloadFile('https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js', gsapDest);
  }

  // Sao chép các tệp font chữ thương hiệu vào thư mục tạm thời
  const font800Src = path.join(baseDir, 'assets', 'fonts', 'be-vietnam-pro-800.ttf');
  const font900Src = path.join(baseDir, 'assets', 'fonts', 'be-vietnam-pro-900.ttf');
  fs.copyFileSync(font800Src, path.join(tempDir, 'be-vietnam-pro-800.ttf'));
  fs.copyFileSync(font900Src, path.join(tempDir, 'be-vietnam-pro-900.ttf'));
  console.log('[ReelsEngine v3] Đã copy font chữ thương hiệu Be Vietnam Pro.');

  console.log('[ReelsEngine v3] Đã sẵn sàng các thư viện Three.js và GSAP.');
}

// 1. Đọc tệp cấu hình
if (!fs.existsSync(configPath)) {
  console.error(`[Lỗi] Không tìm thấy tệp cấu hình: ${configPath}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const localVideoPath = path.join(tempDir, 'app_video.mp4');
console.log(`[ReelsEngine v3] Đang sao chép video vào thư mục tạm: ${config.videoPath} -> ${localVideoPath}`);
fs.copyFileSync(config.videoPath, localVideoPath);
const videoUrl = 'app_video.mp4';

// 2. Tính toán mốc thời gian động (Timeline Math)
let currentTimelineTime = 0;
const processedSegments = config.segments.map(seg => {
  const duration = seg.end - seg.start;
  const timelineStart = currentTimelineTime;
  const timelineEnd = currentTimelineTime + duration;
  currentTimelineTime = timelineEnd;
  
  // Ánh xạ B-roll nền cho các segment app
  let bgBroll = '';
  if (seg.type === 'app') {
    bgBroll = seg.id.includes('reveal')
      ? 'C:\\Users\\Admin\\Desktop\\CNFI_Video_Premium\\assets\\Broll\\pexels_7250817.mp4'
      : 'C:\\Users\\Admin\\Desktop\\CNFI_Video_Premium\\assets\\Broll\\128130-740906921_medium.mp4';
  }

  return {
    ...seg,
    timelineStart,
    timelineEnd,
    duration,
    bgBroll
  };
});
const totalDuration = currentTimelineTime;

console.log(`[ReelsEngine v3] Đã tính toán xong mốc thời gian:`);
processedSegments.forEach(seg => {
  console.log(`   - Segment [${seg.id}]: ${seg.timelineStart.toFixed(2)}s -> ${seg.timelineEnd.toFixed(2)}s (Duration: ${seg.duration.toFixed(2)}s)`);
});
console.log(`[ReelsEngine v3] Tổng thời lượng: ${totalDuration.toFixed(2)} giây.`);

// 3. Viết mã nguồn cho overlay_engine.html với WebGL Phone Mockup 3D
const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @font-face {
      font-family: 'Be Vietnam Pro';
      src: url('be-vietnam-pro-800.ttf') format('truetype');
      font-weight: 800;
    }
    @font-face {
      font-family: 'Be Vietnam Pro';
      src: url('be-vietnam-pro-900.ttf') format('truetype');
      font-weight: 900;
    }
    body {
      margin: 0;
      padding: 0;
      width: 1080px;
      height: 1920px;
      background: transparent;
      overflow: hidden;
      font-family: 'Be Vietnam Pro', sans-serif;
      color: white;
    }
    
    #canvas3d {
      position: absolute;
      top: 0;
      left: 0;
      width: 1080px;
      height: 1920px;
      z-index: 10;
      display: none;
    }

    /* Phụ đề dạng TikTok */
    #subtitle-container {
      position: absolute;
      bottom: 180px;
      width: 100%;
      text-align: center;
      z-index: 100;
    }
    .subtitle-text {
      display: inline-block;
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 46px;
      font-weight: 900;
      color: #ffffff;
      background: rgba(0, 0, 0, 0.85);
      padding: 16px 32px;
      border-radius: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      border: 3px solid rgba(255, 255, 255, 0.15);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .highlight {
      color: #a6ff3d;
      text-shadow: 0 0 15px rgba(166, 255, 61, 0.8);
      white-space: nowrap;
    }

    #flash-overlay {
      position: absolute;
      top: 0; left: 0; width: 1080px; height: 1920px;
      background: white;
      opacity: 0;
      z-index: 999;
    }

    #outro-container {
      position: absolute;
      top: 0; left: 0; width: 1080px; height: 1920px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      background: rgba(0, 0, 0, 0.45);
      opacity: 0;
      z-index: 80;
    }
    .cta-btn {
      margin-top: 50px;
      background: linear-gradient(135deg, #a6ff3d, #80d91a);
      color: #050505;
      font-size: 52px;
      font-weight: 900;
      padding: 32px 90px;
      border-radius: 60px;
      box-shadow: 0 15px 45px rgba(166, 255, 61, 0.5);
      border: none;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
  </style>
  <script src="three.min.js"></script>
</head>
<body>
  <video id="app-video" src="${videoUrl}" muted style="display:none;"></video>
  
  <div id="flash-overlay"></div>
  <div id="canvas3d"></div>
  
  <div id="subtitle-container">
    <span id="subtitle" class="subtitle-text"></span>
  </div>

  <div id="outro-container">
    <button class="cta-btn">Tải CNFI Health Ngay</button>
  </div>

  <script>
    const video = document.getElementById('app-video');
    const segments = ${JSON.stringify(processedSegments)};
    
    // Khởi tạo Three.js
    const container = document.getElementById('canvas3d');
    const width = 1080;
    const height = 1920;
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 11.5;
    
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(1);
    container.appendChild(renderer.domElement);
    
    // Ánh sáng
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 8);
    scene.add(dirLight);
    
    // Tạo mô hình điện thoại 3D đơn giản
    const phoneGroup = new THREE.Group();
    
    // Viền kim loại ngoài
    const bezelGeom = new THREE.BoxGeometry(3.8, 8.0, 0.28);
    const bezelMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });
    const bezel = new THREE.Mesh(bezelGeom, bezelMat);
    phoneGroup.add(bezel);
    
    // Thân máy sau
    const bodyGeom = new THREE.BoxGeometry(3.76, 7.96, 0.3);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.5, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    phoneGroup.add(body);
    
    // Màn hình hiển thị
    const screenGeom = new THREE.PlaneGeometry(3.6, 7.8);
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    const screenMat = new THREE.MeshBasicMaterial({ map: videoTexture });
    const screen = new THREE.Mesh(screenGeom, screenMat);
    screen.position.z = 0.151; // Đẩy lên trước viền chút ít
    phoneGroup.add(screen);
    
    scene.add(phoneGroup);

    // Bắt đầu tải video thô để sẵn sàng tìm kiếm
    video.load();

    window.renderAt = function(t) {
      return new Promise((resolve) => {
        const currentSeg = segments.find(s => t >= s.timelineStart && t < s.timelineEnd);
        
        const subEl = document.getElementById('subtitle');
        const flashEl = document.getElementById('flash-overlay');
        const outro = document.getElementById('outro-container');
        
        subEl.style.opacity = 0;
        flashEl.style.opacity = 0;
        outro.style.opacity = 0;
        container.style.display = 'none';

        if (currentSeg) {
          // 1. Cập nhật phụ đề kiểu kinetic
          let subText = currentSeg.subtitle;
          subText = subText.replace("calo", "<span class='highlight'>calo</span>");
          subText = subText.replace("AI", "<span class='highlight'>AI</span>");
          subText = subText.replace("chính xác", "<span class='highlight'>chính xác</span>");
          subText = subText.replace("thử ngay", "<span class='highlight'>thử ngay</span>");
          
          subEl.innerHTML = subText;
          subEl.style.opacity = 1;

          const elapsed = t - currentSeg.timelineStart;
          const progress = elapsed / currentSeg.duration;

          if (currentSeg.type === 'app') {
            container.style.display = 'block';
            
            // Tìm kiếm mốc thời gian thực của video thô
            let videoTime = currentSeg.start + elapsed;
            
            video.currentTime = videoTime;
            video.onseeked = () => {
              videoTexture.needsUpdate = true;
              
              if (currentSeg.overlayType === '3d_phone_scan') {
                // Xoay nhẹ điện thoại 3D từ góc xiên sang trực diện
                phoneGroup.rotation.y = -0.55 * (1 - progress);
                phoneGroup.rotation.x = 0.15 * (1 - progress);
                phoneGroup.position.set(0, 0, 0);
                phoneGroup.scale.setScalar(1.0);
              } 
              else if (currentSeg.overlayType === '3d_phone_reveal') {
                // Đưa camera lại sát màn hình (auto-zoom) và dịch y để focus cụm kcal/macro
                phoneGroup.rotation.set(0, 0, 0);
                // Zoom mượt dần từ 1.0 lên 1.7
                const scaleVal = 1.0 + progress * 0.7;
                phoneGroup.scale.setScalar(scaleVal);
                // Dịch chuyển y dần lên trên (tương đương pan camera xuống cụm macros)
                phoneGroup.position.y = -0.9 * progress;
              }
              
              renderer.render(scene, camera);
              resolve();
            };
          } else {
            // Segment B-roll
            if (currentSeg.overlayType === 'outro_cta') {
              outro.style.opacity = 1;
            }
            resolve();
          }
        } else {
          resolve();
        }
      });
    };
  </script>
</body>
</html>`;

fs.writeFileSync(compositionHtmlPath, htmlContent, 'utf8');
console.log('[ReelsEngine v3] Đã viết overlay_engine.html hoàn tất.');

// 4. Chụp chuỗi ảnh PNG trong suốt qua Puppeteer
async function captureOverlayFrames() {
  console.log('[ReelsEngine v3] Đang chụp chuỗi ảnh PNG bằng Puppeteer...');
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    defaultViewport: { width: 1080, height: 1920 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--allow-file-access-from-files'
    ]
  });
  const page = await browser.newPage();
  
  const fileUrl = `file:///${compositionHtmlPath.replace(/\\/g, '/')}`;
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });

  const fps = 15;
  const totalFrames = Math.ceil(totalDuration * fps);
  
  const framesFolder = path.join(tempDir, 'frames');
  if (fs.existsSync(framesFolder)) {
    fs.rmSync(framesFolder, { recursive: true, force: true });
  }
  fs.mkdirSync(framesFolder, { recursive: true });

  const startTime = Date.now();
  for (let idx = 0; idx < totalFrames; idx++) {
    const time = idx / fps;
    
    // Gọi seeker bất đồng bộ của Three.js
    await page.evaluate(async (t) => {
      await window.renderAt(t);
    }, time);
    
    const framePath = path.join(framesFolder, `frame_${String(idx).padStart(5, '0')}.png`);
    await page.screenshot({
      path: framePath,
      omitBackground: true,
      type: 'png'
    });

    if (idx % 30 === 0 || idx === totalFrames - 1) {
      console.log(`   [Puppeteer] Đã lưu 3D frame ${idx + 1}/${totalFrames}`);
    }
  }

  await browser.close();
  const renderTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[ReelsEngine v3] Đã chụp xong overlay. Thời gian render 3D: ${renderTimeSec}s`);
  return renderTimeSec;
}

// 5. Biên soạn video nền (chỉ chứa B-rolls)
function buildVideoBase() {
  console.log('[ReelsEngine v3] Đang xử lý biên soạn video nền B-roll...');
  const segmentFiles = [];
  
  processedSegments.forEach((seg, idx) => {
    const tempClipPath = path.join(tempDir, `bg_clip_${idx}.mp4`);
    let filterStr = '';
    
    if (seg.type === 'broll') {
      filterStr = `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"`;
      const sliceCmd = `ffmpeg -y -ss ${seg.start} -to ${seg.end} -i "${seg.src}" ${filterStr} -r 30 -pix_fmt yuv420p -c:v libx264 -crf 20 -an "${tempClipPath}"`;
      execSync(sliceCmd, { stdio: 'ignore' });
    } else {
      // Đối với segment chứa app, video nền chính là B-roll được làm mờ
      filterStr = `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=15:5"`;
      const sliceCmd = `ffmpeg -y -ss 0 -to ${seg.duration} -i "${seg.bgBroll}" ${filterStr} -r 30 -pix_fmt yuv420p -c:v libx264 -crf 20 -an "${tempClipPath}"`;
      execSync(sliceCmd, { stdio: 'ignore' });
    }
    
    segmentFiles.push(tempClipPath);
  });

  const listFilePath = path.join(tempDir, 'concat_list.txt');
  const listContent = segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(listFilePath, listContent, 'utf8');
  
  const baseVideoPath = path.join(tempDir, 'base_video.mp4');
  const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${baseVideoPath}"`;
  execSync(concatCmd, { stdio: 'ignore' });
  
  return baseVideoPath;
}

// 6. Tổng hợp Video Base + 3D Overlay + Âm thanh
function assembleFinalOutput(baseVideoPath) {
  console.log('[ReelsEngine v3] Ghép nối lớp phủ 3D và mix âm nhạc...');
  const pngPattern = path.join(tempDir, 'frames', 'frame_%05d.png');
  
  const filterComplex = [
    `[0:v][1:v]overlay=0:0[v_overlay]`,
    `[2:v]scale=120:-1[logo]`,
    `[v_overlay][logo]overlay=main_w-overlay_w-60:60[outv]`
  ].join(';');

  // Mốc trễ âm thanh khớp chuẩn nhịp
  const sfxWhoosh = 'C:\\Users\\Admin\\Desktop\\CNFI_Video_Premium\\assets\\sfx\\dragon-studio-whoosh-cinematic-sound-effect-376889.mp3';
  const sfxChime = 'C:\\Users\\Admin\\Desktop\\CNFI_Video_Premium\\assets\\sfx\\universfield-bright-notification-352449.mp3';

  const delayWhoosh = Math.round(processedSegments.find(s => s.id === 'segment_1_hook').timelineStart * 1000);
  const delayChime = Math.round(processedSegments.find(s => s.id === 'segment_3_reveal').timelineStart * 1000);

  const audioFilter = [
    `[4:a]volume=-10dB,adelay=${delayWhoosh}|${delayWhoosh}[a_whoosh]`,
    `[5:a]volume=-8dB,adelay=${delayChime}|${delayChime}[a_chime]`,
    `[3:a][a_whoosh][a_chime]amix=inputs=3:duration=first:dropout_transition=0:normalize=0[aout]`
  ].join(';');

  const assembleCmd = [
    `ffmpeg -y`,
    `-i "${baseVideoPath}"`,       // 0
    `-framerate 15 -i "${pngPattern}"`, // 1
    `-i "${config.logoPath}"`,    // 2
    `-stream_loop -1 -i "${config.musicPath}"`, // 3
    `-i "${sfxWhoosh}"`,          // 4
    `-i "${sfxChime}"`,           // 5
    `-filter_complex "${filterComplex};${audioFilter}"`,
    `-map "[outv]"`,
    `-map "[aout]"`,
    `-t ${totalDuration}`,
    `-c:v libx264 -crf 20 -pix_fmt yuv420p`,
    `-c:a aac -b:a 192k`,
    `"${config.outputPath}"`
  ].join(' ');

  execSync(assembleCmd, { stdio: 'inherit' });
  console.log(`[ReelsEngine v3] Xuất bản video v3 thành công tại: ${config.outputPath}`);
}

async function main() {
  const startTime = Date.now();
  try {
    await prepareAssets();
    const renderTimeSec = await captureOverlayFrames();
    const baseVideo = buildVideoBase();
    assembleFinalOutput(baseVideo);
    
    const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ReelsEngine v3] Hoàn tất toàn bộ pipeline. Tổng thời gian chạy: ${totalTimeSec}s`);
    
    // Lưu metadata báo cáo
    fs.writeFileSync(path.join(tempDir, 'report.json'), JSON.stringify({
      renderTimeSec,
      totalTimeSec,
      outputPath: config.outputPath,
      duration: totalDuration,
      dimensions: '1080x1920'
    }, null, 2), 'utf8');

    // Dọn dẹp tệp tạm nhưng giữ lại report.json
    fs.readdirSync(tempDir).forEach(file => {
      if (file !== 'report.json') {
        const filePath = path.join(tempDir, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.rmSync(filePath, { force: true });
        }
      }
    });

  } catch (error) {
    console.error('[ReelsEngine v3] [Lỗi] Quá trình xử lý video thất bại:', error.message);
    process.exit(1);
  }
}

main();
