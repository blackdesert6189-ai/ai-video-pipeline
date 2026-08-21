/**
 * src/pipeline/presenterLayout.js
 * Presenter position detection and presenter-aware layout positioning.
 */

import fs from 'fs';
import path from 'path';

export function createPresenterLayout({
  layout,
  execSyncImpl,
  puppeteerImpl,
  logWarning = console.warn,
  logSuccess = console.log
} = {}) {
  async function detectPresenterSide(videoPath) {
    const tmpDir = path.join(path.dirname(path.resolve(videoPath)), '.face_probe');
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const dur = (() => {
        try {
          const out = execSyncImpl(
            `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
            { encoding: 'utf8' }
          ).trim();
          return parseFloat(out) || 10;
        } catch { return 10; }
      })();

      // Trích 3 frame ở 25%, 50%, 75% thời lượng video
      const probeFrames = [0.25, 0.5, 0.75].map((frac, i) => {
        const t = Math.max(1, Math.floor(dur * frac));
        const p = path.join(tmpDir, `probe_${i}.jpg`);
        try {
          execSyncImpl(`ffmpeg -y -ss ${t} -i "${videoPath}" -vframes 1 -q:v 3 "${p}"`, { stdio: 'pipe' });
          return fs.existsSync(p) ? p : null;
        } catch { return null; }
      }).filter(Boolean);

      if (!probeFrames.length) return 'right';

      const fBrowser = await puppeteerImpl.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-experimental-web-platform-features']
      });

      const sides = [];
      for (const framePath of probeFrames) {
        try {
          const page = await fBrowser.newPage();
          await page.setViewport({ width: 640, height: 1136 });
          const b64 = fs.readFileSync(framePath).toString('base64');
          await page.setContent(`<!doctype html><img id="i" src="data:image/jpeg;base64,${b64}">`);
          await page.waitForSelector('#i');

          const side = await page.evaluate(async () => {
            if (!('FaceDetector' in window)) return null;
            const img = document.getElementById('i');
            await new Promise(r => { if (img.complete) r(); else img.onload = r; });
            try {
              const fd = new FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
              const faces = await fd.detect(img);
              if (!faces.length) return null;
              const face = faces[0];
              const cx = face.boundingBox.x + face.boundingBox.width / 2;
              const ratio = cx / img.naturalWidth;
              if (ratio < 0.38) return 'left';
              if (ratio > 0.62) return 'right';
              return 'center';
            } catch { return null; }
          });

          if (side) sides.push(side);
          await page.close();
        } catch {}
      }
      await fBrowser.close();

      if (!sides.length) return 'right';
      const counts = sides.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    } catch (e) {
      logWarning(`Face detection failed: ${e.message} — defaulting to RIGHT`);
      return 'right';
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  function applyPresenterSide(side) {
    const margin = layout.card.neonBarLeft; // dùng neonBarLeft (70px) làm margin chuẩn — nhất quán 2 bên
    if (side === 'left') {
      // Người quay bên trái → card bên phải
      layout.card.infoLeft   = layout.canvas.w - layout.card.width - margin;
      layout.card.statLeft   = layout.canvas.w - layout.card.statWidth - margin;
      layout.card.neonBarLeft = layout.card.infoLeft;  // neon rail theo card edge
      layout.card.introX     =  160;
      layout.card.exitX      =   34;
      layout.visualRow.left  = layout.canvas.w - layout.card.width - margin;
      layout.visualRow.introX =  24;
      layout.visualRow.exitX  =  16;
      logSuccess(`Presenter: LEFT → cards positioned on RIGHT (margin: ${margin}px)`);
    } else if (side === 'center') {
      // Người quay giữa → card xuống thấp hơn để tránh mặt
      layout.card.defaultTop = layout.card.defaultTop + 50;
      logSuccess(`Presenter: CENTER → cards positioned lower (+50px)`);
    } else {
      logSuccess(`Presenter: RIGHT → cards centered (infoLeft: ${layout.card.infoLeft}px)`);
    }
  }

  return {
    detectPresenterSide,
    applyPresenterSide
  };
}
