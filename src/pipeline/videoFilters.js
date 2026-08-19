/**
 * ============================================================
 * Video Filter Graph Construction Module
 * ============================================================
 * Builds FFmpeg video filtergraph expressions for:
 * - Zoom & Ken Burns effect (buildZoomExpr)
 * - Cinematic color grading eq chain (buildColorGradeFilter)
 * - Multi-input B-roll and subtitle overlay graph (buildBrollFilter)
 *
 * Extracted from pipeline.js in Phase 4.
 * ============================================================
 */

// ── Video zoom constants ─────────────────────────────────────────
export const ZOOM_HOOK_PEAK     = 1.06;    // peak zoom lúc hook (6%)
export const ZOOM_HOOK_DURATION = 2.0;     // giây punch-in
export const ZOOM_EASE_DURATION = 1.0;     // giây ease về Ken Burns
export const ZOOM_KB_BASE       = 1.03;    // điểm bắt đầu Ken Burns (3%)
export const ZOOM_KB_RATE       = 0.00015; // tốc độ zoom mỗi frame
export const ZOOM_KB_MAX        = 1.06;    // trần Ken Burns

/**
 * Builds zoompan expression string for hook punch-in + Ken Burns drift.
 * @param {number} videoFps - Video frame rate
 * @returns {string} FFmpeg zoom expression
 */
export function buildZoomExpr(videoFps) {
  const hf  = Math.round(ZOOM_HOOK_DURATION * videoFps);
  const ef  = Math.round(ZOOM_EASE_DURATION * videoFps);
  const eef = hf + ef;
  const hookRise = (ZOOM_HOOK_PEAK - 1.0).toFixed(4);
  const easeDown = (ZOOM_HOOK_PEAK - ZOOM_KB_BASE).toFixed(4);
  return `if(lt(on,${hf}),1.0+on/${hf}*${hookRise},if(lt(on,${eef}),${ZOOM_HOOK_PEAK.toFixed(4)}-(on-${hf})/${ef}*${easeDown},min(${ZOOM_KB_BASE.toFixed(4)}+(on-${eef})*${ZOOM_KB_RATE.toFixed(6)},${ZOOM_KB_MAX.toFixed(4)})))`;
}

/**
 * Builds FFmpeg eq filter chain for warm cinematic color grade.
 * inLabel/outLabel e.g. '[composited]' → '[outv]'
 * @param {string} inLabel - Input video stream label
 * @param {string} outLabel - Output video stream label
 * @param {object} [colorGrade] - Color grade settings (defaults to enabled cinematic preset)
 * @returns {string} FFmpeg filter string
 */
export function buildColorGradeFilter(inLabel, outLabel, colorGrade = null) {
  const cg = colorGrade || {
    enabled:    true,
    brightness: 0.00,
    contrast:   1.10,
    saturation: 1.12,
    gamma:      0.91,
    gammaR:     1.07,
    gammaG:     0.98,
    gammaB:     0.90,
  };

  if (!cg.enabled) return `${inLabel}copy${outLabel}`;
  const params = [
    `brightness=${cg.brightness.toFixed(3)}`,
    `contrast=${cg.contrast.toFixed(3)}`,
    `saturation=${cg.saturation.toFixed(3)}`,
    `gamma=${cg.gamma.toFixed(3)}`,
    `gamma_r=${cg.gammaR.toFixed(3)}`,
    `gamma_g=${cg.gammaG.toFixed(3)}`,
    `gamma_b=${cg.gammaB.toFixed(3)}`,
  ].join(':');
  return `${inLabel}eq=${params}${outLabel}`;
}

/**
 * Builds multi-input B-roll overlay and subtitle composition filtergraph.
 * @param {Array<object>} segs - B-roll segments [{ startTime, endTime, clipPath, ... }]
 * @param {number} pngInputIndex - FFmpeg input index for transparent subtitle PNG frames
 * @param {number} mainW - Output canvas width
 * @param {number} mainH - Output canvas height
 * @param {number} [videoFps=30] - Video frame rate
 * @param {object} [colorGrade] - Optional color grade configuration
 * @returns {{ inputs: string, filterStr: string }}
 */
export function buildBrollFilter(segs, pngInputIndex, mainW, mainH, videoFps = 30, colorGrade = null) {
  const zExpr   = buildZoomExpr(videoFps);
  const zFilter = `[0:v]zoompan=z='${zExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=${videoFps}:s=${mainW}x${mainH}[zv]`;

  const gradeFilter = buildColorGradeFilter('[composited]', '[outv]', colorGrade);

  if (!segs.length) {
    return { inputs: '', filterStr: `${zFilter};[${pngInputIndex}:v][zv]scale2ref[ov][base];[base][ov]overlay=0:0[composited];${gradeFilter}` };
  }
  let inputs = '';
  let filters = [zFilter];
  let prevVid = '[zv]';
  segs.forEach((seg, i) => {
    const dur = (seg.endTime - seg.startTime + 0.25).toFixed(2);
    inputs += ` -ss 1.0 -t ${dur} -i "${seg.clipPath}"`;
    const brLabel = `[brs${i}]`;
    const outLabel = `[brv${i}]`;
    filters.push(`[${i + 1}:v]scale=${mainW}:${mainH}:force_original_aspect_ratio=increase,crop=${mainW}:${mainH},setsar=1,setpts=PTS-STARTPTS+${seg.startTime.toFixed(3)}/TB${brLabel}`);
    filters.push(`${prevVid}${brLabel}overlay=0:0:enable='between(t,${seg.startTime.toFixed(3)},${seg.endTime.toFixed(3)})'${outLabel}`);
    prevVid = outLabel;
  });
  const filterStr = filters.join(';') + `;[${pngInputIndex}:v]${prevVid}scale2ref[ov][base];[base][ov]overlay=0:0[composited];${gradeFilter}`;
  return { inputs, filterStr };
}

/**
 * Minimal factory closure injecting explicit cinematic color grade configuration.
 * @param {object} options - Options containing colorGrade
 * @returns {{ buildZoomExpr: Function, buildColorGradeFilter: Function, buildBrollFilter: Function }}
 */
export function createVideoFilters(options = {}) {
  const colorGrade = options.colorGrade || null;

  return {
    buildZoomExpr: (videoFps) => buildZoomExpr(videoFps),
    buildColorGradeFilter: (inLabel, outLabel) => buildColorGradeFilter(inLabel, outLabel, colorGrade),
    buildBrollFilter: (segs, pngInputIndex, mainW, mainH, videoFps = 30) =>
      buildBrollFilter(segs, pngInputIndex, mainW, mainH, videoFps, colorGrade)
  };
}
