/**
 * ============================================================
 * WARNING — NOT THE PRODUCTION SOURCE FOR PREMIUM REELS
 * ============================================================
 * pipeline.js is the renderer for PRESENTER / KNOWLEDGE-type
 * videos (dạng kiến thức có subtitle + B-roll).
 *
 * It is NOT approved for Reel_01 or any Reel that has been
 * migrated to the Remotion premium pipeline.
 *
 * For premium Reels: use remotion_engine.
 * See ARCHITECTURE_DECISIONS.md ADR-001.
 * See .agents/AGENTS.md Section 4 (Architecture Lock).
 * ============================================================
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { renderMetricFromTitle } from './metricRenderer.js';
import { getMetricCSS } from './metricRenderer.js';
import { classifyOverlayType, enhanceSemanticOverlays } from './semanticOverlayEngine.js';
import { reportSemanticArchitecture } from './semanticReport.js';
import { getPatternCSS } from './visualPatternRenderer.js';
import {
  COLOR_RESET,
  COLOR_GREEN,
  COLOR_RED,
  COLOR_YELLOW,
  COLOR_CYAN,
  COLOR_MAGENTA,
  logStep,
  logSuccess,
  logWarning,
  logError
} from './src/pipeline/logger.js';
import { parseArgs } from './src/pipeline/cli.js';
import { parseSRT, timeToSeconds } from './src/pipeline/srt.js';
import { loadOwnedCache, saveOwnedCache } from './src/pipeline/cache.js';
import { hasAudioStream, probeAudioStream, measureLoudnormStats } from './src/pipeline/mediaProbe.js';
import {
  AUDIO_COMP_THRESHOLD,
  AUDIO_COMP_RATIO,
  AUDIO_COMP_ATTACK_MS,
  AUDIO_COMP_RELEASE_MS,
  AUDIO_LUFS_TARGET,
  AUDIO_TRUE_PEAK_DB,
  AUDIO_LRA,
  AUDIO_HIGHPASS_HZ,
  AUDIO_DENOISE_FLOOR,
  AUDIO_GATE_THRESHOLD,
  AUDIO_GATE_ATTACK_MS,
  AUDIO_GATE_RELEASE_MS,
  AUDIO_EQ_MUD_HZ,
  AUDIO_EQ_MUD_GAIN,
  AUDIO_EQ_DESS_HZ,
  AUDIO_EQ_DESS_GAIN,
  AUDIO_EQ_PRESENCE_HZ,
  AUDIO_EQ_PRESENCE_GAIN,
  AUDIO_EQ_AIR_HZ,
  AUDIO_EQ_AIR_GAIN,
  SFX_VOLUME_DB,
  HOOK_SFX_VOLUME_DB,
  BROLL_SFX_VOLUME_DB,
  SFX_POOL_SIZE,
  CARD_SFX_CATEGORY_PREFERENCES,
  SFX_CATEGORY_KEYWORDS,
  normalizeSfxFileName,
  classifySfxFile,
  discoverSfxFiles,
  scoreSfxForCardType,
  buildSfxPoolByCardType,
  buildSfxMapByCardType,
  buildVoiceProcessingChain,
  buildAudioPlan,
  measureMixedAudioLoudnorm,
  mixOverlaySfxIntoOutput,
  sfxTempOutputPath
} from './src/pipeline/audio.js';
import {
  buildAudioFilterGraph,
  buildFinalFfmpegCommand,
  executeFfmpegRender
} from './src/pipeline/ffmpeg.js';
import { validatePostRenderAudioQA } from './src/pipeline/finalQa.js';
import { applyRuntimeVisualPatches } from './src/pipeline/runtimeVisualPatches.js';
import { createVideoFilters } from './src/pipeline/videoFilters.js';
import { createOverlayPostProcessor } from './src/pipeline/overlayPostProcessor.js';
import { createSubtitleSplitter } from './src/pipeline/subtitleSplit.js';
import { createPeakSmartIndent } from './src/pipeline/peakSmartIndent.js';
import { getLottieIconFilter } from './src/pipeline/lottieFilter.js';
import { createGeminiService } from './src/pipeline/geminiService.js';
import { createNormalization } from './src/pipeline/normalization.js';
import { createAssetAcquisition } from './src/pipeline/assetAcquisition.js';
import { createPresenterLayout } from './src/pipeline/presenterLayout.js';
import { createLayout } from './src/pipeline/layout.js';
import { createCompositionStyles } from './src/pipeline/compositionStyles.js';
import { createHtmlComposition } from './src/pipeline/htmlComposition.js';

// ── Windows: force UTF-8 console output (fix UnicodeEncodeError for ✓ ✗ ⚠) ──
if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'pipe' }); } catch (_) {}
}

// ── Asset index (built once with: node build_asset_index.js) ──────
let assetMap = new Map();
try {
  const _idx = JSON.parse(fs.readFileSync('./asset_index.json', 'utf8'));
  assetMap = new Map(_idx.map(e => [e.key, e]));
  console.log(`[assets] ${assetMap.size} visual assets loaded`);
} catch { /* index not built yet — images disabled */ }

let brollIndex = [];
try {
  brollIndex = JSON.parse(fs.readFileSync('./broll_index.json', 'utf8'));
  console.log(`[broll] ${brollIndex.length} B-roll clips loaded`);
} catch { /* no broll index yet */ }

// Constants / Configuration
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY || '';
const PEXELS_API_KEY    = process.env.PEXELS_API_KEY || '';
const ICONSCOUT_API_KEY    = process.env.ICONSCOUT_API_KEY || '';
const ICONSCOUT_CLIENT_ID  = process.env.ICONSCOUT_CLIENT_ID || '';

// ── Pexels config — tất cả số lượng fetch ở đây ──────────────────
const PEXELS = {
  broll: {
    perPage:          5,
    maxDictPass:      10,
    maxGeminiPass:    8,
    maxDictQueries:   5,
    maxGeminiQueries: 6,
    minGeminiCount:   2,
  },
};

// ── Layout config — tất cả số vị trí ở đây, không chỗ nào khác ──
const LAYOUT = createLayout();

// -------------------------------------------------------------
// Asset Acquisition — Pexels B-roll (video) + IconScout / Lottie (animation)
// -------------------------------------------------------------
const LOTTIE_DIR = path.resolve('assets/lottie');

const {
  fetchPexelsBroll,
  fetchLottieForOverlays
} = createAssetAcquisition({
  pexelsBroll: PEXELS.broll,
  pexelsApiKey: PEXELS_API_KEY,
  iconscoutApiKey: ICONSCOUT_API_KEY,
  iconscoutClientId: ICONSCOUT_CLIENT_ID,
  lottieDir: LOTTIE_DIR,
  fetchImpl: (...args) => fetch(...args),
  httpsGet: (...args) => https.get(...args),
  logSuccess
});

function getVideoDimensions(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoPath}"`,
      { encoding: 'utf8' }
    ).trim();
    const [w, h] = out.split(',').map(Number);
    if (w > 0 && h > 0) return { w, h };
  } catch {}
  return { w: 1080, h: 1920 };
}

function getVideoFps(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "${videoPath}"`,
      { encoding: 'utf8' }
    ).trim();
    const [num, den] = out.split('/').map(Number);
    if (num > 0 && den > 0) return Math.round(num / den);
  } catch {}
  return 30;
}

const {
  detectPresenterSide,
  applyPresenterSide
} = createPresenterLayout({
  layout: LAYOUT,
  execSyncImpl: (...args) => execSync(...args),
  puppeteerImpl: puppeteer,
  logWarning,
  logSuccess
});

// -------------------------------------------------------------
// 3. Gemini API Client (Strict JSON Schema)
// -------------------------------------------------------------
const {
  callGemini,
  rewriteCardText
} = createGeminiService({
  lottieDir: LOTTIE_DIR,
  getBrollIndex: () => brollIndex
});

// -------------------------------------------------------------
// 4. Dynamic HTML Composition Generator
// -------------------------------------------------------------

const {
  foldText,
  toSeconds,
  normalizeSentence,
  normalizeOverlay
} = createNormalization({
  layoutPeak: LAYOUT.peak,
  getPeakFunctionWords: () => PEAK_FUNCTION_WORDS,
  classifyOverlayType
});

// Dùng chung cho tất cả chỗ render ảnh — đổi filter ở PEXELS.imageFilter là đổi toàn bộ
function buildImageStyle(entry, extraStyle = '') {
  const base = `max-width:100%;max-height:100%;object-fit:contain;${extraStyle}`;
  // 'transparent' = ảnh đã được Remove.bg xóa nền → render trực tiếp, không cần blend
  if (!entry.blend_mode || entry.blend_mode === 'transparent') return base;
  return base + (PEXELS.imageFilter[entry.blend_mode] || '');
}


// -------------------------------------------------------------
// 4B. Premium Metric Counter Generator
const {
  postProcessOverlays
} = createOverlayPostProcessor({
  toSeconds,
  hookSafeStart: LAYOUT.hook.safeStart,
  logWarning
});
// ───────────────────────────────────────────────────────────────────

const {
  splitLongSentences
} = createSubtitleSplitter({
  normalizeSentence,
  foldText,
  maxWordsDefault: LAYOUT.subtitle.maxWords,
  warn: console.warn
});

const {
  getPeakSmartIndents
} = createPeakSmartIndent({
  layoutPeak: LAYOUT.peak,
  layoutSubtitle: LAYOUT.subtitle
});

const {
  generateStyles
} = createCompositionStyles({
  getMetricCSSImpl: getMetricCSS,
  getPatternCSSImpl: getPatternCSS,
  readFileSyncImpl: fs.readFileSync,
  resolvePathImpl: path.resolve,
  existsSyncImpl: fs.existsSync
});

// ── Từ hư tiếng Việt (folded/ASCII form) — dùng trong TYB per-word sizing ──────
// Chứa dạng foldText() của các từ hư (function words) phổ biến
// KHÔNG chứa từ có collision với content word sau foldText (vd: 'co'='cơ'/'có', 'no'='nó'/'no')
// Scalable: thêm từ mới bằng cách append vào Set, không sửa logic
const PEAK_FUNCTION_WORDS = new Set([
  // ── Temporal / aspect markers
  'da','se','dang','van','cung','lai',
  // ── Modals / negation
  // ⚠ 'khong' removed: foldText("khổng") = "khong" = foldText("không") — collision!
  //   "khổng lồ" (enormous) bị shrink sai khi "khổng" match "khong" trong set này
  //   Trade-off: "không" (negation) không còn shrink trong anchor — CHẤP NHẬN
  //   vì anchor chứa "không" (negation) đã là semantic error — anchor guarantee sẽ không promote loại này
  'phai','can','chua','duoc',
  // ── Prepositions — CHỈ giữ những từ KHÔNG trùng content word sau foldText
  // Loại bỏ: 'qua'("quả"=fruit/result), 'xuong'("xương"=bone), 'trong'("trong"=clear),
  //          'sang'("sang"=luxurious), 'len'("len"=wool), 'la'("lá"=leaf/organ)
  // 'o' = foldText("ở") = preposition at/in — safe: "ổ"(nest/disk) unlikely in health content
  'voi','ve','tren','duoi','tu','den','o',
  'bang','theo','vao','ra','cua','tai',
  // ── Conjunctions & discourse markers (removed 'la' → collision với "lá"=leaf)
  'va','hay','hoac','nhung','ma','neu',
  'khi','de','nen','vi','boi',
  // ── Demonstratives / references
  'do','day','nay','kia','ay',
  // ── Pronouns (safe — không trùng content word phổ biến)
  'ta','ho','chung',
  // ── Adverbial modifiers
  'rat','kha','hoi',
  // ── Light quantifiers
  'mot','nhieu',
  // ── Classifiers / articles — KHÔNG BAO GIỜ được là anchor (thêm để block anchor guarantee)
  // 'cac'("các"), 'cai'("cái"), 'nhung'("những") — article/classifier, không phải content word
  // Collision check: 'cac' không trùng content word phổ biến; 'cai' không trùng; 'nhung' OK
  'cac','cai','nhung','moi',
]);

const {
  generatePremiumHTML
} = createHtmlComposition({
  layout: LAYOUT,
  peakFunctionWords: PEAK_FUNCTION_WORDS,
  getAssetMap: () => assetMap,
  buildImageStyleImpl: buildImageStyle,
  generateStylesImpl: generateStyles,
  renderMetricFromTitleImpl: renderMetricFromTitle,
  getLottieIconFilterImpl: getLottieIconFilter,
  getPeakSmartIndentsImpl: getPeakSmartIndents,
  postProcessOverlaysImpl: postProcessOverlays,
  splitLongSentencesImpl: splitLongSentences,
  normalizeSentenceImpl: normalizeSentence,
  normalizeOverlayImpl: normalizeOverlay,
  toSecondsImpl: toSeconds,
  foldTextImpl: foldText,
  readFileSyncImpl: fs.readFileSync
});

// -------------------------------------------------------------
// 5. Orchestration Pipeline Flow
// -------------------------------------------------------------
// opts: { srtPath, videoPath, outputPath, skipGemini, reportOnly, noexit }
// noexit=true → throw on error instead of process.exit(1) so batch can continue.
async function runPipeline(opts = {}) {
  const srtPath    = opts.srtPath || '';
  const videoPath  = opts.videoPath || '';
  const outputPath = opts.outputPath || '';
  const skipGemini = Boolean(opts.skipGemini);
  const reportOnly = Boolean(opts.reportOnly);

  if (reportOnly) {
    if (!srtPath) {
      logError("--report mode requires --srt <srt_path>");
      console.log(`\nUsage:\n  node pipeline.js --srt <srt_path> --report`);
      if (opts.noexit) throw new Error("--report mode requires --srt <srt_path>");
      process.exit(1);
    }
  } else if (!videoPath || !outputPath || (!skipGemini && !srtPath)) {
    logError("Missing required arguments!");
    console.log(`\nUsage:\n  node pipeline.js --srt <srt_path> --video <video_path> --output <output_path> [--skip-gemini]`);
    if (opts.noexit) throw new Error("Missing required arguments!");
    process.exit(1);
  }

  const tempDir = path.resolve("temp_frames");
  const compositionHtmlPath = path.resolve("index.html");
  let totalDuration = 10;
  let sfxOverlayEvents = [];
  let brollSegments = [];

  try {
    logStep("Starting CNFI Premium Video Generation Pipeline (Custom Puppeteer)");
    console.log(`SRT Path:    ${srtPath || "(Skipped)"}`);
    console.log(`Video Path:  ${videoPath}`);
    console.log(`Output Path: ${outputPath}`);

    if (!fs.existsSync(videoPath)) {
      throw new Error(`CRITICAL: Input video file not found at: ${videoPath}`);
    }
    if (!hasAudioStream(videoPath)) {
      throw new Error(`CRITICAL FAIL-CLOSED: Input video "${videoPath}" has no audio stream. Aborting pipeline.`);
    }

    if (skipGemini) {
      const { cacheFilePath, data: cached } = loadOwnedCache(videoPath, srtPath);
      logStep(`--skip-gemini: Found valid cache at ${cacheFilePath} → loading cached data and regenerating HTML...`);
      totalDuration = cached.totalDuration || 10;
        
        // Populate sentences and overlays
        const sentences = cached.sentences || [];
        const overlays = cached.overlays || [];
        const hook = cached.hook || null;
        
        // Fetch Lottie files for overlays if they don't have paths yet
        logStep("Fetching Lottie animations for cached overlay cards...");
        await fetchLottieForOverlays(overlays);
        
        // Fix: read asset index
        const latestAssetIndex = (() => {
          try { return JSON.parse(fs.readFileSync('asset_index.json', 'utf8')); } catch { return []; }
        })();
        for (const ov of overlays) {
          if (ov.image_key) {
            const entry = latestAssetIndex.find(e => e.key === ov.image_key);
            if (entry) assetMap.set(ov.image_key, entry);
          }
        }
        
        // Resolve B-roll segments from schedule in cache
        const geminiSchedule = cached.broll_schedule || [];
        const usedBrollFiles = new Set();
        brollSegments = geminiSchedule
          .filter(s => s.filename && s.endTime > s.startTime)
          .filter(s => { const key = s.filename.toLowerCase(); if (usedBrollFiles.has(key)) return false; usedBrollFiles.add(key); return true; })
          .map(s => {
            const clip = brollIndex.find(c => c.filename === s.filename)
              || brollIndex.find(c => c.filename.toLowerCase() === s.filename.toLowerCase());
            if (!clip) { logWarning(`B-roll not found: "${s.filename}" — skipped`); return null; }
            if (!fs.existsSync(clip.path)) return null;
            return { startTime: toSeconds(s.startTime, 0), endTime: toSeconds(s.endTime, 0), clipPath: clip.path, filename: clip.filename };
          })
          .filter(Boolean);
          
        sfxOverlayEvents = postProcessOverlays(overlays);
        
        // Suppress card overlap with peak sentences
        const peakSents = sentences.map(normalizeSentence).filter(s => s.style === "peak");
        if (peakSents.length > 0) {
          const peakWins = peakSents.map(s => ({ start: s.startTime, end: s.endTime }));
          const before = sfxOverlayEvents.length;
          sfxOverlayEvents = sfxOverlayEvents.filter(card => {
            const cs = toSeconds(card.startTime, 0);
            const ce = toSeconds(card.endTime, cs + 1);
            return !peakWins.some(p => cs < p.end && ce > p.start);
          });
          logSuccess(`Peak suppression: removed ${before - sfxOverlayEvents.length} card(s) overlapping peak sentences (visual + SFX).`);
        }
        
        // Detect presenter position — tự động đặt card tránh mặt người
        logStep("Detecting presenter position for safe card placement...");
        const presenterSide = await detectPresenterSide(videoPath);
        applyPresenterSide(presenterSide);
        
        // Generate dynamic HTML from cache
        const htmlContent = generatePremiumHTML(sentences, overlays, totalDuration, hook, []);
        fs.writeFileSync(compositionHtmlPath, htmlContent, 'utf-8');
        logSuccess(`HTML regenerated from Gemini cache! Duration: ${totalDuration}s`);
    } else {
      try {
        // Read SRT
        logStep("Reading and Parsing SRT Transcript file...");
        if (!fs.existsSync(srtPath)) {
          throw new Error(`SRT file not found at: ${srtPath}`);
        }
        const srtContent = fs.readFileSync(srtPath, 'utf-8');
        const cues = parseSRT(srtContent);
        logSuccess(`Successfully parsed ${cues.length} cues from SRT file!`);

        // Pass 1: Fetch B-roll + Photos trước Gemini (dùng từ điển) → Gemini biết có gì mà schedule
        logStep("Fetching Pexels B-roll clips + card photos for this video topic...");
        const srtFullText = cues.map(c => c.text).join(' ');

        const pexelsClips = await fetchPexelsBroll(srtFullText, PEXELS.broll.maxDictPass);
        if (pexelsClips.length) {
          brollIndex.push(...pexelsClips);
          logSuccess(`Pexels videos: +${pexelsClips.length} clips merged (${brollIndex.length} total)`);
        }

        // Call Gemini API
        logStep("Calling Gemini API to analyze semantics and select overlays...");
        const geminiOutput = await callGemini(cues, GEMINI_API_KEY);
        logSuccess("Successfully parsed Gemini API structured response!");

        // Pass 2: Fetch B-roll thêm bằng query từ Gemini — chính xác hơn, build library cho lần sau
        const geminiQueries = geminiOutput.broll_queries_en || [];
        if (geminiQueries.length) {
          logStep(`Fetching additional B-roll using Gemini queries: ${geminiQueries.slice(0,3).join(' | ')}...`);
          const extraClips = await fetchPexelsBroll(srtFullText, PEXELS.broll.maxGeminiPass, geminiQueries);
          if (extraClips.length) {
            brollIndex.push(...extraClips);
            logSuccess(`Pexels B-roll (Gemini queries): +${extraClips.length} clips cached for future renders`);
          }
        }

        logStep("Running reusable Semantic Overlay Engine...");
        const semanticOutput = enhanceSemanticOverlays({
          sentences: geminiOutput.sentences,
          overlays: geminiOutput.overlays,
          cues
        });

        // Làm sạch title/detail của từng card — xử lý văn phong lủng củng từ ASR
        logStep("Rewriting card text for clean publishable Vietnamese...");
        await rewriteCardText(semanticOutput.overlays, GEMINI_API_KEY);

        sfxOverlayEvents = postProcessOverlays(semanticOutput.overlays);

        // Suppress cards overlapping peak sentences — peak IS the card, no need for both
        // Filter both visual (generatePremiumHTML) AND audio SFX (mixOverlaySfxIntoOutput)
        const peakSents = (semanticOutput.sentences || []).map(normalizeSentence).filter(s => s.style === "peak");
        if (peakSents.length > 0) {
          const peakWins = peakSents.map(s => ({ start: s.startTime, end: s.endTime }));
          const before = sfxOverlayEvents.length;
          sfxOverlayEvents = sfxOverlayEvents.filter(card => {
            const cs = toSeconds(card.startTime, 0);
            const ce = toSeconds(card.endTime, cs + 1);
            return !peakWins.some(p => cs < p.end && ce > p.start);
          });
          logSuccess(`Peak suppression: removed ${before - sfxOverlayEvents.length} card(s) overlapping peak sentences (visual + SFX).`);
        }

        logSuccess(`Semantic engine ready: ${sfxOverlayEvents.length} clean overlays (${semanticOutput.semanticSummary.overlayCount} raw from Gemini).`);

        // Fetch Lottie animation per card từ LottieFiles API — thay thế Pexels card photos
        logStep("Fetching Lottie animations for overlay cards...");
        await fetchLottieForOverlays(semanticOutput.overlays);

        // Fix: đọc asset_index.json 1 lần duy nhất thay vì mỗi overlay 1 lần
        const latestAssetIndex = (() => {
          try { return JSON.parse(fs.readFileSync('asset_index.json', 'utf8')); } catch { return []; }
        })();
        for (const ov of semanticOutput.overlays) {
          if (ov.image_key) {
            const entry = latestAssetIndex.find(e => e.key === ov.image_key);
            if (entry) assetMap.set(ov.image_key, entry);
          }
        }

        // B-roll + image gap: từ Gemini output
        logStep("Reading Gemini B-roll/image schedule...");
        const geminiSchedule = geminiOutput.broll_schedule || [];

        // Video B-roll segments — fuzzy filename match + dedup
        const usedBrollFiles = new Set();
        brollSegments = geminiSchedule
          .filter(s => s.filename && s.endTime > s.startTime)
          .filter(s => { const key = s.filename.toLowerCase(); if (usedBrollFiles.has(key)) return false; usedBrollFiles.add(key); return true; })
          .map(s => {
            // Exact match only — partial match gây nhầm clip sai hoàn toàn
            const clip = brollIndex.find(c => c.filename === s.filename)
              || brollIndex.find(c => c.filename.toLowerCase() === s.filename.toLowerCase());
            if (!clip) { logWarning(`B-roll not found: "${s.filename}" — skipped`); return null; }
            if (!fs.existsSync(clip.path)) return null;
            return { startTime: toSeconds(s.startTime, 0), endTime: toSeconds(s.endTime, 0), clipPath: clip.path, filename: clip.filename };
          })
          .filter(Boolean);

        // Image gap segments disabled — B-roll gaps use video only
        const imageGapSegments = [];

        logSuccess(`B-roll: ${brollSegments.length} video clips`);
        brollSegments.forEach(s => console.log(`   [video] ${s.startTime.toFixed(1)}s–${s.endTime.toFixed(1)}s → "${s.filename.slice(0,40)}"`));

        // Inspect semantic recommendations
        console.log(`\n${COLOR_CYAN}◆  Overlays recommended by Gemini:${COLOR_RESET}`);
        semanticOutput.overlays.forEach((o, idx) => {
          console.log(`   ${idx+1}. [${o.type}] "${o.title}" - "${o.detail}" (${o.startTime}s - ${o.endTime}s) | Score: ${o.visual_value}`);
        });
        console.log(`   Total overlay count: ${semanticOutput.overlays.length}`);
        console.log(`   Total sentence count: ${semanticOutput.sentences.length}`);

        if (reportOnly) {
          reportSemanticArchitecture(semanticOutput.overlays);
          logSuccess("Dry-run report complete. No render performed.");
          return;
        }

        // Compute duration
        const finalCue = cues[cues.length - 1];
        totalDuration = Math.ceil(finalCue.endTime + 0.5);
        logSuccess(`Total composition duration set to: ${totalDuration} seconds`);

        // Detect presenter position — tự động đặt card tránh mặt người
        logStep("Detecting presenter position for safe card placement...");
        const presenterSide = await detectPresenterSide(videoPath);
        applyPresenterSide(presenterSide);

        // Generate HTML content
        logStep("Generating elegant-maxwell index.html with GSAP timeline...");
        const htmlContent = generatePremiumHTML(semanticOutput.sentences, semanticOutput.overlays, totalDuration, geminiOutput.hook || null, imageGapSegments);
        
        // Save directly to Desktop target directory as requested
        fs.writeFileSync(compositionHtmlPath, htmlContent, 'utf-8');
        logSuccess(`Created dynamic index.html composition at: ${compositionHtmlPath}`);
        // ── Cache Gemini output cho --skip-gemini HTML regeneration ──────────
        // Mỗi lần full run xong → tự lưu cache; lần sau --skip-gemini sẽ
        // regenerate HTML từ cache mà không cần gọi lại Gemini API
        try {
          saveOwnedCache({
            videoPath,
            srtPath,
            sentences: semanticOutput.sentences,
            overlays: semanticOutput.overlays,
            totalDuration,
            hook: geminiOutput.hook || null,
            broll_schedule: geminiOutput.broll_schedule || []
          });
          logSuccess('Gemini output cached with videoFile tag (--skip-gemini sẽ load đúng video cache)');
        } catch (_ce) {
          logWarning(`Could not save Gemini cache: ${_ce.message}`);
        }
      } catch (err) {
        throw err;
      }
    }

    // Ensure output directory exists
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      logStep(`Creating output directory: ${outDir}`);
      fs.mkdirSync(outDir, { recursive: true });
    }

    // -------------------------------------------------------------
    // Puppeteer Frame Capturing loop
    // -------------------------------------------------------------
    logStep("Launching Headless Chrome with Puppeteer...");
    const browser = await puppeteer.launch({
      headless: "new",
      defaultViewport: {
        width: 1080,
        height: 1920,
        deviceScaleFactor: 1
      },
      protocolTimeout: 300000, // 5 minutes to permanently prevent CDP timeouts on Windows
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--hide-scrollbars'
      ]
    });
    const page = await browser.newPage();

    const fileUrl = `file:///${compositionHtmlPath.replace(/\\/g, '/')}`;
    logStep(`Loading composition in Puppeteer: ${fileUrl}`);
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    logSuccess("Composition loaded!");

    await applyRuntimeVisualPatches(page, LAYOUT);
    logSuccess("Applied fixed neon rail and clean metric text patches.");

    // Wait for fonts — explicit load hero cursive font trước, sau đó ready
    logStep("Waiting for document fonts to load completely...");
    await page.evaluate((fontName, fontSize) => document.fonts.load(`normal ${fontSize}px "${fontName}"`), LAYOUT.subtitle.peakScriptClimaxFont, LAYOUT.subtitle.peakScriptClimaxSize);
    await page.evaluate(() => document.fonts.ready);
    logSuccess("Fonts successfully loaded!");

    // Verify timeline registration
    const hasTimeline = await page.evaluate(() => {
      return !!(window.__timelines && window.__timelines["elegant-maxwell"]);
    });
    if (!hasTimeline) {
      throw new Error("Could not find registered GSAP timeline 'elegant-maxwell' on window.__timelines!");
    }
    logSuccess("GSAP timeline detected!");

    // Clean and recreate temp frames folder
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Stagger to 15fps for extreme speed and bulletproof reliability under timeouts
    const fps = 15;
    const totalFrames = Math.ceil(totalDuration * fps);
    logStep(`Starting transparent PNG frame capture loop at ${fps}fps (${totalFrames} total frames)...`);

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const currentTime = frameIdx / fps;

      // Deterministically seek the composition playhead.
      await page.evaluate((t) => {
        if (typeof window.renderAt === "function") {
          window.renderAt(t);
        } else {
          window.__timelines["elegant-maxwell"].seek(t);
        }
      }, currentTime);

      // Screenshot with alpha-transparency enabled (omitBackground: true)
      const framePath = path.join(tempDir, `frame_${String(frameIdx).padStart(5, '0')}.png`);
      await page.screenshot({
        path: framePath,
        omitBackground: true,
        type: 'png'
      });

      if (frameIdx % 100 === 0 || frameIdx === totalFrames - 1) {
        const percent = ((frameIdx + 1) / totalFrames * 100).toFixed(1);
        console.log(`   [Puppeteer] Captured frame ${frameIdx + 1}/${totalFrames} (${percent}%) | Timestamp: ${currentTime.toFixed(2)}s`);
      }
    }

    await browser.close();
    logSuccess("Custom Puppeteer capture loop completed! Staged all transparent PNGs.");

    // -------------------------------------------------------------
    // FFmpeg Direct Overlay Stitching
    // -------------------------------------------------------------
    logStep("Calling FFmpeg to composite transparent overlay PNG sequence and master audio in a single pass...");
    const framePattern = path.join(tempDir, 'frame_%05d.png');
    const brollSegs = brollSegments;
    const pngInputIdx = 1 + brollSegs.length;
    const { w: mainW, h: mainH } = getVideoDimensions(videoPath);
    const videoFps = getVideoFps(videoPath);
    logSuccess(`Main video: ${mainW}×${mainH} @ ${videoFps}fps`);
    const { buildBrollFilter } = createVideoFilters({ colorGrade: LAYOUT.cinematic.colorGrade });
    const brollFilter = buildBrollFilter(brollSegs, pngInputIdx, mainW, mainH, videoFps);

    // ── Build Audio Plan ONCE before Loudnorm Pass 1 ──────────────────
    const audioPlan = buildAudioPlan(sfxOverlayEvents, brollSegments);
    logStep(`Built unified audio plan with ${audioPlan.length} SFX event(s). Measuring mixed audio loudness (Pass 1)...`);
    const loudStats = measureMixedAudioLoudnorm(videoPath, audioPlan);
    if (loudStats) {
      logSuccess(`Loudnorm Pass 1 measured on mixed audio: I=${loudStats.input_i} LUFS, LRA=${loudStats.input_lra}, TP=${loudStats.input_tp}`);
    } else {
      logWarning("Mixed loudnorm measurement failed — falling back to single-pass loudnorm.");
    }

    // SFX inputs start after input 0 (video), inputs 1..brollSegs.length (broll), input 1+brollSegs.length (framePattern)
    const sfxStartInputIdx = 1 + brollSegs.length + 1;
    const audioFilterGraph = buildAudioFilterGraph({ audioPlan, loudStats, sfxStartInputIdx });
    const combinedFilterComplex = `${brollFilter.filterStr};${audioFilterGraph.fullAudioFilter}`;

    const ffmpegCmd = buildFinalFfmpegCommand({
      videoPath,
      brollFilterInputs: brollFilter.inputs,
      fps,
      framePattern,
      sfxInputsStr: audioFilterGraph.sfxInputsStr,
      combinedFilterComplex,
      outputPath
    });
    console.log(`Running: ${ffmpegCmd}\n`);

    executeFfmpegRender(ffmpegCmd);
    logSuccess(`FFmpeg single-pass compositing and audio mastering complete!`);

    // ── Strict Fail-Closed Post-Render Audio QA Validation ────────────
    validatePostRenderAudioQA(outputPath);

    // Staging frames cleanup
    logStep("Cleaning up staging frame screenshots...");
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      logSuccess("Removed temporary frames directory.");
    }

    console.log(`\n${COLOR_GREEN}==================================================================`);
    console.log(`✓  SUCCESS: Video production completed successfully!`);
    console.log(`✓  Final composite video saved to:`);
    console.log(`   ${outputPath}`);
    console.log(`==================================================================${COLOR_RESET}\n`);

  } catch (error) {
    logError("Pipeline failed with error:");
    console.error(error);
    // Safety cleanup in case of crash
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (opts.noexit) throw error;   // batch mode: rethrow so caller can skip & continue
    process.exit(1);
  }
}

// -------------------------------------------------------------
// 6. Batch Mode — scan folder for video+SRT pairs, process all
// -------------------------------------------------------------
// Usage: node pipeline.js --batch ./input --output-dir ./output
//
// Folder structure expected:
//   input/
//     myVideo.mp4
//     myVideo.srt      ← same stem as .mp4
//
// Output: output/myVideo_cnfi.mp4 (one per pair)
//
// All paths are dynamic — nothing hardcoded.
// -------------------------------------------------------------
async function runBatch(bDir, oDir, baseOpts = {}) {
  if (!fs.existsSync(bDir)) {
    logError(`Batch directory not found: ${bDir}`);
    process.exit(1);
  }
  fs.mkdirSync(oDir, { recursive: true });

  // Find all .mp4 files that have a matching .srt in the same folder
  const files = fs.readdirSync(bDir);
  const mp4Files = files.filter(f => /\.(mp4|mov|mkv)$/i.test(f));
  const jobs = mp4Files
    .map(mp4 => {
      const stem   = path.basename(mp4, path.extname(mp4));
      const srt    = files.find(f => path.basename(f, path.extname(f)) === stem && /\.srt$/i.test(f));
      return srt ? {
        srtPath:    path.join(bDir, srt),
        videoPath:  path.join(bDir, mp4),
        outputPath: path.join(oDir, `${stem}_cnfi.mp4`),
      } : null;
    })
    .filter(Boolean);

  if (!jobs.length) {
    logError(`No matching video+SRT pairs found in: ${bDir}`);
    logError(`Expected: video.mp4 + video.srt with the same filename stem.`);
    process.exit(1);
  }

  console.log(`\n${COLOR_GREEN}[BATCH] ${jobs.length} video(s) queued for processing:${COLOR_RESET}`);
  jobs.forEach((j, idx) => console.log(`  [${idx + 1}] ${path.basename(j.videoPath)}`));
  console.log();

  let passed = 0, failed = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const label = path.basename(job.videoPath);
    console.log(`\n${COLOR_GREEN}══════════════════════════════════════════════`);
    console.log(`[BATCH ${i + 1}/${jobs.length}] ${label}`);
    console.log(`══════════════════════════════════════════════${COLOR_RESET}`);
    try {
      await runPipeline({ ...baseOpts, ...job, noexit: true });
      passed++;
      logSuccess(`[BATCH ${i + 1}/${jobs.length}] DONE → ${path.basename(job.outputPath)}`);
    } catch (err) {
      failed++;
      logError(`[BATCH ${i + 1}/${jobs.length}] FAILED: ${label} — ${err.message}`);
    }
  }

  console.log(`\n${COLOR_GREEN}══════════════════════════════════════════════`);
  console.log(`BATCH COMPLETE: ${passed} succeeded, ${failed} failed`);
  console.log(`Output folder: ${oDir}`);
  console.log(`══════════════════════════════════════════════${COLOR_RESET}\n`);
  if (failed > 0) process.exit(1);
}

// Entry point — batch vs single
const cliOptions = parseArgs(process.argv.slice(2));

// Top-level CLI validation (executed before batch dispatch in baseline main)
if (cliOptions.reportOnly) {
  if (!cliOptions.srtPath) {
    logError("--report mode requires --srt <srt_path>");
    console.log(`\nUsage:\n  node pipeline.js --srt <srt_path> --report`);
    process.exit(1);
  }
} else if (!cliOptions.videoPath || !cliOptions.outputPath || (!cliOptions.skipGemini && !cliOptions.srtPath)) {
  logError("Missing required arguments!");
  console.log(`\nUsage:\n  node pipeline.js --srt <srt_path> --video <video_path> --output <output_path> [--skip-gemini]`);
  process.exit(1);
}

if (cliOptions.batchDir) {
  const finalOutputDir = cliOptions.outputDir || path.join(cliOptions.batchDir, "output");
  runBatch(cliOptions.batchDir, finalOutputDir, cliOptions).catch(e => { console.error(e); process.exit(1); });
} else {
  runPipeline(cliOptions);
}
