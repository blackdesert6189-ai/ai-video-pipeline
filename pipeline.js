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
import { parseOverlayTitle } from './metricParser.js';
import { classifyOverlayType, enhanceSemanticOverlays } from './semanticOverlayEngine.js';
import { reportSemanticArchitecture } from './semanticReport.js';
import { renderPattern, getPatternCSS } from './visualPatternRenderer.js';

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

/**
 * pipeline.js - CNFI Premium AI Video Pipeline (Puppeteer Custom Renderer Edition)
 * Automatically parses SRT, queries Gemini for structured layouts, writes index.html,
 * launches headless Chrome with high protocolTimeout, captures PNGs at 15fps,
 * and composites them directly onto the background video using FFmpeg.
 */

// Calibrate colors and console trace style
const COLOR_RESET = "\x1b[0m";
const COLOR_GREEN = "\x1b[32m";
const COLOR_RED = "\x1b[31m";
const COLOR_YELLOW = "\x1b[33m";
const COLOR_CYAN = "\x1b[36m";
const COLOR_MAGENTA = "\x1b[35m";

function logStep(msg) {
  console.log(`\n${COLOR_CYAN}◆  ${msg}${COLOR_RESET}`);
}

function logSuccess(msg) {
  console.log(`${COLOR_GREEN}✓  ${msg}${COLOR_RESET}`);
}

function logWarning(msg) {
  console.log(`${COLOR_YELLOW}⚠  ${msg}${COLOR_RESET}`);
}

function logError(msg) {
  console.log(`${COLOR_RED}✗  ${msg}${COLOR_RESET}`);
}

// -------------------------------------------------------------
// 1. Argument Parsing
// -------------------------------------------------------------
const args = process.argv.slice(2);
let srtPath    = "";
let videoPath  = "";
let outputPath = "";
let skipGemini = false;
let reportOnly = false;
let batchDir   = "";   // --batch <dir>  → scan for video+SRT pairs
let outputDir  = "";   // --output-dir <dir>  → where batch results go

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--srt" && args[i + 1]) {
    srtPath = args[i + 1]; i++;
  } else if (args[i] === "--video" && args[i + 1]) {
    videoPath = args[i + 1]; i++;
  } else if (args[i] === "--output" && args[i + 1]) {
    outputPath = args[i + 1]; i++;
  } else if ((args[i] === "--batch" || args[i] === "--batch-dir") && args[i + 1]) {
    batchDir = path.resolve(args[i + 1]); i++;
  } else if ((args[i] === "--output-dir" || args[i] === "--out-dir") && args[i + 1]) {
    outputDir = path.resolve(args[i + 1]); i++;
  } else if (args[i] === "--skip-gemini") {
    skipGemini = true;
  } else if (args[i] === "--report") {
    reportOnly = true;
  }
}

// Fallback to positional arguments (single-video mode only)
if (!batchDir) {
  if (!srtPath    && args[0]) srtPath    = args[0];
  if (!videoPath  && args[1]) videoPath  = args[1];
  if (!outputPath && args[2]) outputPath = args[2];
}

// Constants / Configuration
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY || '';
const PEXELS_API_KEY    = process.env.PEXELS_API_KEY || '';
const ICONSCOUT_API_KEY    = process.env.ICONSCOUT_API_KEY || '';
const ICONSCOUT_CLIENT_ID  = process.env.ICONSCOUT_CLIENT_ID || '';
// ── Background removal config (local AI, không giới hạn) ─────────
const REMOVEBG = {
  enabled:        true,  // tắt nếu không cần xóa nền
  onlyCardImages: true,  // chỉ xử lý ảnh card overlay
};

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

// ── Audio config (Section 6 — CNFI Master Codex) ─────────────────
const SFX_VOLUME_DB          = -10;   // card SFX under voice (−8 to −12 dB)
const HOOK_SFX_VOLUME_DB     = -8;    // hook whoosh — slightly louder for impact
const BROLL_SFX_VOLUME_DB    = -13;   // b-roll cut-in whoosh
const AUDIO_COMP_THRESHOLD   = -18;   // dB — voice compressor threshold
const AUDIO_COMP_RATIO       = 3;     // 3:1 ratio
const AUDIO_COMP_ATTACK_MS   = 5;     // ms
const AUDIO_COMP_RELEASE_MS  = 80;    // ms
const AUDIO_LUFS_TARGET      = -14;   // integrated loudness (LUFS)
const AUDIO_TRUE_PEAK_DB     = -1;    // dBTP ceiling
const AUDIO_LRA              = 7;     // loudness range
// ── Studio voice chain ───────────────────────────────────────────
// ── Video zoom config ────────────────────────────────────────────
const ZOOM_HOOK_PEAK     = 1.06;    // peak zoom lúc hook (6%)
const ZOOM_HOOK_DURATION = 2.0;    // giây punch-in
const ZOOM_EASE_DURATION = 1.0;    // giây ease về Ken Burns
const ZOOM_KB_BASE       = 1.03;   // điểm bắt đầu Ken Burns (3%)
const ZOOM_KB_RATE       = 0.00015; // tốc độ zoom mỗi frame
const ZOOM_KB_MAX        = 1.06;   // trần Ken Burns
// ── Studio voice chain ───────────────────────────────────────────
const AUDIO_HIGHPASS_HZ      = 80;    // cắt rumble phòng thu
const AUDIO_DENOISE_FLOOR    = -25;   // dB — ngưỡng noise floor (afftdn)
const AUDIO_GATE_THRESHOLD   = 0.001; // noise gate open threshold (~-30dBFS)
const AUDIO_GATE_ATTACK_MS   = 20;    // ms — gate open speed
const AUDIO_GATE_RELEASE_MS  = 250;   // ms — gate close speed
const AUDIO_EQ_MUD_HZ        = 250;   // EQ band: giảm muddy
const AUDIO_EQ_MUD_GAIN      = -2;    // dB
const AUDIO_EQ_DESS_HZ       = 7500;  // de-esser center (âm s/ch chói)
const AUDIO_EQ_DESS_GAIN     = -3;    // dB
const AUDIO_EQ_PRESENCE_HZ   = 3000;  // EQ band: boost clarity/presence
const AUDIO_EQ_PRESENCE_GAIN = 3;     // dB
const AUDIO_EQ_AIR_HZ        = 8000;  // EQ band: subtle air/brightness
const AUDIO_EQ_AIR_GAIN      = 1;     // dB

// ── Layout config — tất cả số vị trí ở đây, không chỗ nào khác ──
const LAYOUT = {
  canvas:     { w: 1080, h: 1920 },
  card: {
    defaultTop:    1100,   // px — INFO card top (lower third: ~57% of 1920)
    statTop:       900,    // px — STAT card top (giữ nguyên vị trí STAT)
    offscreenLeft: -700,   // px — vị trí ngoài màn hình (legacy, không dùng cho float-up)
    neonBarLeft:   70,     // px — vị trí thanh neon dọc (boundary trái của visual content)
    infoLeft:      80,     // px — centered: (1080 - 920) / 2 = 80
    statLeft:      70,     // px — STAT card slide-in target (bắt đầu từ neon bar)
    introX:        -160,   // px — legacy, không dùng
    width:         920,    // px — INFO card width (wider: ~85% of 1080, centered)
    height:        175,    // px — INFO card height (reference only, CSS dùng auto)
    lottieRatio:   0.34,   // legacy — lottie cell đã removed khỏi card layout
    lottieIconSize: 200,   // px — float Lottie animation free-floating (TYB style, no circle)
    statWidth:     920,    // px — STAT card width
    statMinHeight: 250,    // px — STAT card min-height
    stackOffset:   160,    // px — đẩy card xuống nếu 2 card cùng lúc
    exitX:         -34,    // px — hướng slide ra (âm = trái, dương = phải)
    titleFontSize:       42,  // px — INFO card title (must dominate body)
    bodyFontSize:        26,  // px — INFO card body (supporting detail, smaller than title)
    listTitleFontSize:   26,  // px — list card title (progressive/slam/check)
    listDetailFontSize:  22,  // px — list card detail
  },
  visualRow: {
    // width KHÔNG định nghĩa ở đây — tự tính từ card.width / card.statWidth
    left:       70,     // px — bắt đầu tại neon bar, không bao giờ vượt trái
    top:        975,    // px — ngay dưới INFO card (820+155)
    statTop:    1150,   // px — ngay dưới STAT card (900+250)
    height:     320,    // px — chiều cao visual row
    imageWidth: 420,    // px — chiều rộng image cell (bên phải primitive)
    introX:     -24,    exitX: -16,
  },
  subtitle: {
    top:         1520,  // px — normal container top (lower third)
    peakTop:     1050,  // px — peak: chest level (~55% of 1920 canvas)
    left: 40, width: 1000, height: 340,
    maxWords: 6,
    // ── 2-mode display sizes ──────────────────────────────────────
    normalFontSize:            34,  // px — standard pill karaoke
    // ── TYB peak chunk types (5 types, Gemini-labeled) ────────────
    peakConnectorSize:         28,  // px — L5: glue words, rất nhỏ — chỉ là context glue
    peakRegularSize:           52,  // px — L4: context phrase, middle step rõ hơn
    peakAnchorSize:            124, // px — L1: key concept — focal point dominant (to nhất)
    peakScriptSize:            68,  // px — L3: italic accent (DVN Grandy mờ) — TYB small italic style
    peakScriptClimaxSize:      96,  // px — L2: cursive accent — style/màu nổi, size nhường anchor làm focal
    peakScriptClimaxFont:      'DVN Grandy',  // local font — assets/fonts/DVN-Grandy-gehcaa.ttf
    peakScriptClimaxLineHeight: 0.82, // cursive font em-box lớn hơn ExtraBold — tighten để giảm dead space
    // peakScriptClimaxTopOffset — derived below từ font size × 0.13 (tỉ lệ dead-space trên của DVN Grandy)
    peakIndentStep:            16,  // px — subtle cascade indent (magazine feel)
    // legacy (kept for fallback)
    peakRegularFontSize:       48,
    peakRegularBottomFontSize: 36,
    peakKeyFontSize:           64,
  },
  hook: {
    fadeOutAt:  4.2,  // giây — hook bắt đầu fade out
    safeStart:  4.8,  // card không được xuất hiện trước thời điểm này
  },
  colors: {
    accent:    '#a6ff3d',
    accentRgb: '166,255,61',
    warning:   '#ff4444',
    yellow:    '#f5c518',
    darkBg:    '#0a0a0a',
    statBg:    'rgba(5,5,5,0.92)',
  },
  // ── Cinematic grade — drives both HTML vignette overlay and FFmpeg color grade ──
  cinematic: {
    // FFmpeg eq filter on final composited video output
    colorGrade: {
      enabled:    true,
      brightness: 0.00,   // neutral
      contrast:   1.10,   // cinematic punch
      saturation: 1.12,   // màu tươi nhưng không lòe loẹt
      gamma:      0.91,   // mids tối — cảm giác depth
      gammaR:     1.07,   // highlight ấm cam — skin tone đẹp
      gammaG:     0.98,   // mids hơi lạnh — complement lime green
      gammaB:     0.90,   // shadow teal — teal-orange contrast
    },
    // CSS radial-gradient vignette baked into PNG overlay frames
    vignette: {
      enabled:    true,
      opacity:    0.72,   // max darkness at edges/corners (0–1)
      ellipseX:   55,     // % — X-radius of clear center ellipse
      ellipseY:   32,     // % — Y-radius of clear center ellipse
      centerX:    50,     // % — gradient origin X
      centerY:    42,     // % — gradient origin Y (above center = face framing)
      clearAt:    30,     // % — inner fully-transparent stop
      fadeAt:     72,     // % — mid-fade transition stop
    },
    // CSS linear-gradient ở phần dưới — tăng cảm giác depth & cinematic ở 1/4 dưới video
    bottomGrad: {
      enabled:    true,
      opacity:    0.62,   // max darkness tại đáy (0–1) — đủ cinematic, không che subject
      heightPct:  27,     // % canvas height từ dưới lên mà gradient phủ
      midOpacity: 0.18,   // opacity tại điểm giữa gradient (tạo curve mềm, không linear)
    },
  },
};
// Derived: cursive font (DVN Grandy) tạo dead-space ở trên glyph ~12% của font-size
// → margin-top âm để kéo chunk script_climax lên, loại bỏ khoảng trắng thừa
LAYOUT.subtitle.peakScriptClimaxTopOffset = -Math.round(LAYOUT.subtitle.peakScriptClimaxSize * 0.12);

// ── Peak chunk validation rules — đặt ở LAYOUT để dễ điều chỉnh, không hardcode trong logic ──
LAYOUT.peak = {
  maxClimaxPerSentence: 1,          // số script_climax tối đa mỗi peak sentence
  maxChunks:            4,          // TYB max 3-4 dòng — Gemini hay trả 5-6, cần cap

  // Anchor KHÔNG được kết thúc bằng giới từ/liên từ — "lập trình cho" → anchor sai
  // Rule: anchor phải là semantic unit độc lập (noun/verb), không trailing preposition
  anchorEndBlockPattern: /\s+(cho|về|trong|trên|dưới|từ|với|đến|tới|qua|sau|trước|theo|tại|ở|của|mà|và|hay|hoặc|nhưng|vì|nếu|khi|để|như|bằng|ngoài|suốt|cùng|giữa|là|thì|mà)\s*$/i,

  // Anchor bắt đầu bằng động từ hành động → split: verb → connector, phần còn lại → anchor
  // "giảm các triệu chứng" → anchor sai → split: connector="giảm", anchor="triệu chứng"
  // Classifier/article ở đầu anchor cũng split tương tự
  // RULE: dùng FULL compound verb phrases (không dùng âm tiết lẻ để tránh false match)
  // Longer phrases first → regex tries them before shorter alternatives
  // "tăng cường sức mạnh" → connector="tăng cường", regular="sức mạnh" (anchor guarantee picks "sức mạnh")
  // "mang lại lợi ích"    → connector="mang lại", regular="lợi ích" → anchor="lợi ích"
  // "giảm triệu chứng"    → connector="giảm", regular="triệu chứng" → anchor="triệu chứng"
  anchorVerbHeadPattern: /^(tăng cường|cải thiện|hỗ trợ|bảo vệ|phòng ngừa|điều trị|phục hồi|duy trì|kiểm soát|loại bỏ|thúc đẩy|mang lại|đem lại|kích thích|ức chế|giảm thiểu|giúp|giảm|tăng)\s+/i,
  // Classifier/article KHÔNG được đứng cuối anchor → trailing classifier → demote toàn anchor
  anchorTrailingClassifierPattern: /\s+(các|cái|những|một|mỗi|này|đó|kia|ấy)\s*$/i,

  // Cross-chunk compound noun repair — linguistic rule, không hardcode từ cụ thể
  // Nếu từ CUỐI của chunk[i] khớp pattern → có thể đang là nửa đầu từ ghép 2 âm tiết
  // → merge từ đầu tiên của chunk[i+1] vào chunk[i] để phục hồi từ ghép
  // RULE: Dùng dạng ASCII (foldText) để tránh Unicode NFC/NFD collision từ Gemini API
  // Gemini có thể trả về diacritics ở NFD form, trong khi regex source code là NFC → không match
  // → Luôn test bằng foldText(lastWord) thay vì raw lastWord
  // Guard currWords.length <= 2 đảm bảo chỉ fix chunk đơn hoặc chunk 2-từ cuối là compound prefix
  compoundPrefixPattern: /^(hieu|te|thu|khang|trao|xuc|thi|thinh|vi|khuu|sinh|ly|cau|chuc|tac|tich|uc|dan|bien|trieu|ket|tham|gia|tri|oxy|mo|he|tong|nguyen|tieu|tiet|chuyen|hap|tuan|dac|hau|co|ao|than)$/i,
  // Loại bỏ: 'hoa'(hóa) → collision với "hoa"(flower); 'ho'(hô) → collision với "ho"(cough); 'qua'(quá) → collision với "qua"(pass)

  // Regex patterns: phrase khớp bất kỳ rule nào → KHÔNG được là script_climax
  // Nguyên tắc: structural linguistic rules (giới từ, đại từ sở hữu, mẫu ngữ pháp)
  // — KHÔNG liệt kê từ/cụm từ nội dung cụ thể (đó mới là hardcode)
  climaxBlockRules: [
    // 1. Bắt đầu bằng giới từ / liên từ / copula → đây là mệnh đề phụ thuộc, không phải concept độc lập
    // "là ..." = mệnh đề mô tả/phân loại; "thì ..." = mệnh đề điều kiện — đều không phải impact line
    /^(cho|của|với|trong|trên|dưới|về|từ|đến|tới|mà|và|hay|hoặc|nhưng|vì|nếu|khi|để|như|bằng|qua|sau|trước|ngoài|theo|tại|ở|suốt|cùng|khỏi|giữa|là|thì)\s/i,
    // 2. Kết thúc bằng đại từ sở hữu → phrase phụ thuộc, không độc lập
    /của\s+(bạn|mình|tôi|tớ|họ|nó|ta|chúng\s*ta|mọi\s*người)\s*$/i,
    // 3. Bắt đầu bằng từ chỉ mức độ (modifier, không phải concept)
    /^(rất|quá|cực|vô cùng|hết sức|khá|hơi|chút|siêu)\s+\S/i,
    // 4. Bắt đầu bằng từ chỉ tần suất / thời điểm (time expression không phải concept)
    /^(mỗi|hàng|suốt|cả|từng)\s+(ngày|tuần|tháng|năm|giờ|phút|lần|buổi|sáng|chiều|tối)\s*$/i,
    // 5. Filler / discourse marker — không mang nội dung semantic
    /^(như vậy|như thế|vậy thôi|mà thôi|thôi|vậy đó|thế đó|đó thôi|chỉ vậy|không hơn)\s*$/i,
    // 6. Bắt đầu bằng từ chỉ mục đích → bổ ngữ mục đích, không phải concept chính
    /^(để|nhằm|nhằm mục đích|hướng tới|hướng đến)\s/i,
  ],

  // ── Smart cascade indent — tự động canh lề line 2 & 3 theo font size, không hardcode px ──
  // Rule: line 2 bắt đầu sau ký tự đầu tiên của anchor (line 1)
  //       line 3 bắt đầu tại vị trí ước tính cuối line 2
  //       → tạo visual "right-staircase" thay vì các bước nhỏ đều nhau (16px/32px)
  peakSmartIndentEnabled:   true,
  peakSmartFirstCharRatio:  0.50,   // width ký tự đầu anchor ≈ anchorFontSize × ratio
  peakSmartRegCharRatio:    0.55,   // avg char advance ≈ fontSize × ratio (regular/connector)
  peakSmartScriptCharRatio: 0.48,   // avg char advance của DVN Grandy cursive (hẹp hơn một chút)
  peakSmartAvgWordChars:    3.0,    // trung bình số ký tự/từ tiếng Việt
  peakSmartClimaxTopPullRatio: 0.35, // pull-up tỷ lệ với font size của line 2 — tự scale khi font thay đổi
                                   // ví dụ: regular 44px → pull = round(44×0.35) = 15px
                                   //        connector 34px → pull = round(34×0.35) = 12px

  // ── TYB Per-word adaptive sizing ─────────────────────────────────────────────
  // Rule 1: Function words (sẽ, lại, của...) trong anchor chunk → nhỏ xíu inline
  //         Content words (giảm, đốt, kết quả...) → full chunk size
  //         Ví dụ: anchor "sẽ đốt cơ" → "sẽ" hiện ≈35px, "đốt cơ" hiện 124px (TYB: "lại GIẢM")
  peakFunctionWordScale:    0.28,   // function_word_size = chunkFontSize × 0.28
  peakFunctionWordMinSize:  18,     // px — sàn tối thiểu (tránh quá nhỏ không đọc được)

  // Rule 2: Cascade không có anchor → climax TRỞ THÀNH hero (lớn nhất), regular thành label
  //         Cascade có anchor   → anchor là hero, climax là accent, regular là support
  //         Ví dụ no-anchor: "thì đạt được cái" (28px) + "điểm số cao hơn" (100px) → climax dominates
  peakRegularSizeFaded:     28,     // px — regular xuống connector size khi ko có anchor
  peakClimaxSizeHero:       100,    // px — climax hero size khi ko có anchor (gần anchor để dominant)
  // Indent cho no-anchor cascade: climax indent lớn hơn step mặc định để staircase visible
  peakNoAnchorClimaxIndent: 32,    // px — min indent climax hero (no anchor) vs 16px default step

  // ── Anchor guarantee system ───────────────────────────────────────────────────
  // TYB rule: mọi cascade PHẢI có anchor (focal point trắng đậm) + script_climax (gold accent)
  // Nếu Gemini không assign anchor → pipeline tự promote regular phù hợp → anchor
  anchorMaxWords:       3,     // anchor tối đa 3 từ (tránh overflow 124px × n words)
  anchorPromoteEnabled: true,  // bật/tắt tính năng tự promote regular → anchor
};

// ── Peak animation timing — all values in LAYOUT, no magic numbers in GSAP code ──
// Hiệu ứng: các hàng xuất hiện từ dưới lên (bottom-first stagger), thoát từ trên xuống
LAYOUT.peakAnim = {
  enterY:        18,             // px  — chunk bắt đầu bên dưới vị trí đúng, slide lên
  enterX:        -5,             // px  — nhích trái nhẹ khi enter
  enterDuration: 0.22,           // s   — mỗi chunk enter mất bao lâu
  enterEase:    'back.out(1.5)', //     — hơi nảy nhẹ cho "uyển chuyển"
  enterStagger:  0.09,           // s   — delay giữa mỗi chunk (bottom chunk đầu tiên)
  exitY:         -8,             // px  — drift lên nhẹ khi exit
  exitDuration:  0.18,           // s
  exitEase:     'power2.in',
  exitStagger:   0.04,           // s   — top chunk exit đầu tiên
};

// ── Derived LAYOUT values (tính sau khi object đã định nghĩa xong) ──
// infoLeft: căn giữa card — (canvas.w - card.width) / 2, không hardcode
LAYOUT.card.infoLeft = Math.round((LAYOUT.canvas.w - LAYOUT.card.width) / 2);
// peakSmartFirstCharWidth: ước tính width ký tự đầu tiên của anchor (116px bold)
// = anchorFontSize × firstCharRatio → tự scale nếu peakAnchorSize thay đổi
LAYOUT.subtitle.peakSmartFirstCharWidth = Math.round(
  LAYOUT.subtitle.peakAnchorSize * LAYOUT.peak.peakSmartFirstCharRatio
);
// visualRow.top: an toàn phía trên subtitle, không overlap
// Constraint: top + height < subtitle.top → top < 1520 - 320 = 1200
// Giữ 975 (giữa màn hình ~50%) — visual row xuất hiện khi B-roll, không phải lúc card on screen
// LAYOUT.visualRow.top giữ nguyên = 975 (đã định nghĩa trong LAYOUT object ở trên)

// -------------------------------------------------------------
// Pexels — auto-fetch B-roll (video) + card images (photo)
// -------------------------------------------------------------
const PEXELS_VI_TO_EN = [
  ['đi bộ',        'person walking park outdoor'],
  ['chạy bộ',      'person running jogging street'],
  ['tập thể dục',  'woman man exercising gym workout'],
  ['gym',          'gym dumbbell lifting weights'],
  ['cơ bắp',       'muscular fit body workout'],
  ['mỡ bụng',      'woman measuring waist belly slim'],
  ['giảm cân',     'woman scale weight loss healthy'],
  ['ăn uống',      'person eating healthy meal bowl'],
  ['thực phẩm',    'fresh healthy food preparation kitchen'],
  ['rau củ',       'fresh vegetables colorful market'],
  ['hoa quả',      'fresh fruits bowl colorful'],
  ['protein',      'grilled chicken eggs meat protein'],
  ['insulin',      'doctor syringe injection medical'],
  ['tim mạch',     'heartbeat pulse medical cardiology'],
  ['nhịp tim',     'person checking pulse fitness tracker'],
  ['ngủ',          'person sleeping bed peaceful night'],
  ['uống nước',    'person drinking water glass hydration'],
  ['sức khỏe',     'healthy active lifestyle woman man'],
  ['tiêu hóa',     'stomach healthy digestion gut food'],
  ['hạt chia',     'chia seeds bowl spoon superfood'],
  ['chất xơ',      'whole grain fiber bread oats cereal'],
  ['năng lượng',   'energetic active running person sunrise'],
  ['béo phì',      'overweight person walking lifestyle change'],
  ['calo',         'person counting calories food journal'],
  ['bước chân',    'close up feet walking steps pavement'],
  ['cơ thể',       'healthy fit body person athletic'],
  ['đốt mỡ',       'person sweating cardio exercise intense'],
  ['dinh dưỡng',   'nutritious meal prep healthy ingredients'],
  ['trao đổi chất','person active metabolism workout sweat'],
  ['zone 2',       'person slow jogging steady pace cardio'],
  ['cortisol',     'stressed person tired work office'],
  ['hormone',      'woman man healthy lifestyle balance'],
  ['viêm',         'inflammation medical health treatment'],
  ['đường huyết',  'blood glucose test finger prick'],
  ['bữa sáng',     'healthy breakfast morning meal table'],
  ['bữa tối',      'dinner healthy meal evening'],
  ['nhịn ăn',      'person fasting water glass clock'],
  ['căng thẳng',   'stressed person relaxation meditation'],
  ['thiền',        'person meditating yoga peaceful'],
  ['vitamin',      'vitamin supplements pills capsules'],
  ['omega',        'fish salmon healthy fat food'],
];

function pexelsExtractQueries(srtText, max = PEXELS.broll.maxDictQueries) {
  const lower = srtText.toLowerCase();
  // Đếm tần suất xuất hiện — keyword nào nhiều hơn ưu tiên hơn
  const scored = [];
  for (const [vi, en] of PEXELS_VI_TO_EN) {
    let count = 0;
    let pos = 0;
    while ((pos = lower.indexOf(vi, pos)) !== -1) { count++; pos += vi.length; }
    if (count > 0) scored.push({ en, count });
  }
  scored.sort((a, b) => b.count - a.count);
  const hits = scored.map(s => s.en);
  if (hits.length < 2) {
    hits.push('person healthy active lifestyle');
    hits.push('healthy food nutrition meal');
  }
  return hits.slice(0, max);
}

function pexelsDetectCategory(tagStr) {
  if (/food|eat|vegetable|fruit|cook|nutrition|meal|ingredient/.test(tagStr)) return 'food';
  if (/gym|workout|fitness|exercise|muscle|training|sport/.test(tagStr)) return 'fitness';
  if (/doctor|medical|hospital|anatomy|scan|clinic/.test(tagStr)) return 'medical';
  if (/body|skin|fat|weight|belly|slim|physique/.test(tagStr)) return 'body';
  return 'lifestyle';
}

function pexelsDownload(url, dest) {
  return new Promise((resolve, reject) => {
    function get(u, redirects = 0) {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      https.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          get(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
      }).on('error', reject);
    }
    get(url);
  });
}

async function fetchPexelsBroll(srtText, maxNewClips = PEXELS.broll.maxDictPass, geminiQueriesEn = []) {
  const brollDir = path.resolve('assets/Broll');
  const indexFile = path.resolve('broll_index.json');
  if (!fs.existsSync(brollDir)) fs.mkdirSync(brollDir, { recursive: true });

  let existingIndex = [];
  try { existingIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch {}
  const existingFiles = new Set(existingIndex.map(c => c.filename.toLowerCase()));

  // Ưu tiên dùng query từ Gemini, fallback về từ điển nếu không có
  const queries = geminiQueriesEn.length >= PEXELS.broll.minGeminiCount
    ? geminiQueriesEn.slice(0, PEXELS.broll.maxGeminiQueries)
    : pexelsExtractQueries(srtText, PEXELS.broll.maxDictQueries);
  console.log(`\n[pexels] B-roll queries (${geminiQueriesEn.length ? 'Gemini' : 'dictionary'}): ${queries.join(' | ')}`);

  const newEntries = [];
  for (const query of queries) {
    if (newEntries.length >= maxNewClips) break;
    try {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${PEXELS.broll.perPage}&orientation=portrait&size=medium`;
      const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
      if (!res.ok) throw new Error(`Pexels Videos ${res.status}`);
      const videos = (await res.json()).videos || [];

      for (const video of videos) {
        if (newEntries.length >= maxNewClips) break;
        const filename = `pexels_${video.id}.mp4`;
        if (existingFiles.has(filename.toLowerCase())) continue;

        const files = (video.video_files || []).filter(f => f.file_type === 'video/mp4');
        const fileInfo = files.sort((a, b) => {
          const score = f => (f.quality === 'hd' ? 20 : f.quality === 'sd' ? 10 : 0) + (f.height > f.width ? 5 : 0);
          return score(b) - score(a);
        })[0];
        if (!fileInfo) continue;

        const destPath = path.join(brollDir, filename);
        if (!fs.existsSync(destPath)) {
          process.stdout.write(`[pexels] ${filename} (${query}) ... `);
          try { await pexelsDownload(fileInfo.link, destPath); console.log('✓'); }
          catch (e) { console.log(`✗ ${e.message}`); continue; }
        }

        const tags = (video.tags || []).map(t => (typeof t === 'string' ? t : t.title) || '').filter(Boolean);
        const tagStr = [...tags, ...query.split(' ')].join(' ').toLowerCase();
        newEntries.push({ filename, path: `assets/Broll/${filename}`, keywords_en: tags.length ? tags.slice(0, 8) : query.split(' '), keywords_vi: [], description: `Pexels #${video.id} — ${query}`, category: pexelsDetectCategory(tagStr) });
        existingFiles.add(filename.toLowerCase());
      }
    } catch (err) { console.warn(`[pexels] "${query}" failed: ${err.message}`); }
  }

  if (newEntries.length) {
    fs.writeFileSync(indexFile, JSON.stringify([...existingIndex, ...newEntries], null, 2));
    console.log(`[pexels] +${newEntries.length} clips added to broll_index.json\n`);
  } else {
    console.log(`[pexels] No new clips (all already cached)\n`);
  }
  return newEntries;
}

// ── Lottie — fetch animation JSON từ LottieFiles API theo query của Gemini ──
const LOTTIE_DIR = path.resolve('assets/lottie');
const ICONSCOUT_API = 'https://api.iconscout.com/v3';

async function searchLottieJson(query) {
  // Search IconScout for FREE Lottie animations matching the query
  const searchHeaders = {
    'Authorization': `Bearer ${ICONSCOUT_API_KEY}`,
    'Client-ID': ICONSCOUT_CLIENT_ID,
    'Accept': 'application/json'
  };
  const url = `${ICONSCOUT_API}/search?query=${encodeURIComponent(query)}&asset=lottie&per_page=5&price=free`;
  const res = await fetch(url, { headers: searchHeaders });
  if (!res.ok) throw new Error(`IconScout search ${res.status}`);
  const data = await res.json();
  const items = data?.response?.items?.data;
  if (!items?.length) return null;

  const uuid = items[0]?.uuid;
  if (!uuid) return null;

  // Download API requires Client-Secret header
  const dlHeaders = {
    'Client-ID': ICONSCOUT_CLIENT_ID,
    'Client-Secret': ICONSCOUT_API_KEY,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
  const dlRes = await fetch(`${ICONSCOUT_API}/items/${uuid}/api-download`, {
    method: 'POST',
    headers: dlHeaders,
    body: JSON.stringify({ format: 'json' })
  });
  if (!dlRes.ok) throw new Error(`IconScout download ${dlRes.status}`);
  const dlData = await dlRes.json();
  const fileUrl = dlData?.response?.download?.url;
  if (!fileUrl) return null;

  // Fetch the actual Lottie JSON file
  const jsonRes = await fetch(fileUrl);
  if (!jsonRes.ok) throw new Error(`Lottie JSON fetch ${jsonRes.status}`);
  return await jsonRes.json();
}

// Fuzzy-match a query against cached Lottie filenames by word overlap score
function findBestCachedLottie(query, usedPaths = new Set()) {
  if (!fs.existsSync(LOTTIE_DIR)) return null;
  const raw = fs.readdirSync(LOTTIE_DIR).filter(f => f.endsWith('.json'));
  // Shuffle trước để tránh bias theo alphabet — khi score bằng nhau sẽ ra file khác nhau
  const files = [...raw].sort(() => Math.random() - 0.5);
  if (!files.length) return null;

  const queryWords = new Set(
    query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  );
  if (!queryWords.size) return null;

  let best = null, bestScore = 0;
  for (const file of files) {
    const fullPath = path.join(LOTTIE_DIR, file);
    if (usedPaths.has(fullPath)) continue; // bỏ qua file đã dùng

    const stem = file.replace(/\.json$/, '').replace(/_/g, ' ');
    const fileWords = stem.split(/\s+/).filter(w => w.length > 2);
    let score = 0;
    for (const w of fileWords) {
      if (queryWords.has(w)) score += 2;
      else {
        for (const qw of queryWords) {
          if (w.startsWith(qw) || qw.startsWith(w)) score += 1;
        }
      }
    }
    if (score > bestScore) { bestScore = score; best = file; }
  }
  // Threshold >= 4: cần ít nhất 2 word match chính xác (mỗi word = 2pt)
  // Ngăn fuzzy pick lung tung khi không có file phù hợp → card render full-width
  return bestScore >= 4 ? path.join(LOTTIE_DIR, best) : null;
}

async function fetchLottieForOverlays(overlays) {
  fs.mkdirSync(LOTTIE_DIR, { recursive: true });
  let fetched = 0, cached = 0, fuzzy = 0;
  const usedPaths = new Set(); // runtime dedup — mỗi animation chỉ dùng 1 lần

  for (const overlay of overlays) {
    if ((overlay.type || '').toUpperCase() === 'STAT') continue; // STAT dùng MetricRenderer, không cần lottie
    const q = (overlay.lottie_query_en || '').trim();
    if (!q) continue;
    const safeKey = q.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 50);
    const cacheFile = path.join(LOTTIE_DIR, `${safeKey}.json`);

    // 1. Exact cache hit — chỉ dùng nếu chưa bị dùng bởi card khác
    if (fs.existsSync(cacheFile) && !usedPaths.has(cacheFile)) {
      overlay.lottie_path = cacheFile;
      usedPaths.add(cacheFile);
      cached++;
      continue;
    }

    // 2. Try IconScout API
    let downloaded = false;
    if (!fs.existsSync(cacheFile)) {
      try {
        process.stdout.write(`[lottie] "${q.slice(0,40)}" ... `);
        const json = await searchLottieJson(q);
        if (json) {
          fs.writeFileSync(cacheFile, JSON.stringify(json));
          if (!usedPaths.has(cacheFile)) {
            overlay.lottie_path = cacheFile;
            usedPaths.add(cacheFile);
            fetched++;
            downloaded = true;
          }
          console.log('✓ (api)');
        } else {
          console.log('(no result)');
        }
      } catch (e) {
        console.log(`✗ ${e.message}`);
      }
    }

    // 3. Fuzzy fallback — tìm file chưa dùng gần nhất
    if (!downloaded && !overlay.lottie_path) {
      const fuzzyFile = findBestCachedLottie(q, usedPaths);
      if (fuzzyFile) {
        overlay.lottie_path = fuzzyFile;
        usedPaths.add(fuzzyFile);
        fuzzy++;
        console.log(`[lottie] "${q.slice(0,40)}" → fuzzy: ${path.basename(fuzzyFile)}`);
      }
    }
  }
  logSuccess(`Lottie: +${fetched} api, ${cached} exact cache, ${fuzzy} fuzzy match`);
}

// fetchPexelsPhotos — disabled, replaced by Lottie
async function fetchPexelsPhotos(srtText, maxNewPhotos = 0) {
  return [];
  const photoDir   = path.resolve('assets/Health visuals');
  const assetIndex = path.resolve('asset_index.json');
  if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

  let existingIndex = [];
  try { existingIndex = JSON.parse(fs.readFileSync(assetIndex, 'utf8')); } catch {}
  const existingKeys = new Set(existingIndex.map(e => e.key));

  const queries = pexelsExtractQueries(srtText, PEXELS.photos.maxDictQueries);
  console.log(`\n[pexels-photos] Searching: ${queries.join(' | ')}`);

  const newEntries = [];
  for (const query of queries) {
    if (newEntries.length >= maxNewPhotos) break;
    try {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${PEXELS.photos.perPage}&orientation=portrait&size=medium`;
      const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
      if (!res.ok) throw new Error(`Pexels Photos ${res.status}`);
      const photos = (await res.json()).photos || [];

      for (const photo of photos) {
        if (newEntries.length >= maxNewPhotos) break;
        const key = `pexels-img-${photo.id}`;
        if (existingKeys.has(key)) continue;

        const src = photo.src?.portrait || photo.src?.large || photo.src?.medium;
        if (!src) continue;

        const filename = `pexels_img_${photo.id}.jpg`;
        const destPath = path.join(photoDir, filename);
        if (!fs.existsSync(destPath)) {
          process.stdout.write(`[pexels-photos] ${filename} (${query}) ... `);
          try { await pexelsDownload(src, destPath); console.log('✓'); }
          catch (e) { console.log(`✗ ${e.message}`); continue; }
        }

        const altWords = (photo.alt || query).split(/[\s,]+/).filter(Boolean);
        const tagStr   = altWords.join(' ').toLowerCase();
        newEntries.push({ key, path: `assets/Health visuals/${filename}`, blend_mode: 'screen', description: photo.alt || query, keywords_en: altWords.slice(0, 8), keywords_vi: [], category: pexelsDetectCategory(tagStr), keywords: [key, ...altWords.slice(0, 4)] });
        existingKeys.add(key);
      }
    } catch (err) { console.warn(`[pexels-photos] "${query}" failed: ${err.message}`); }
  }

  if (newEntries.length) {
    fs.writeFileSync(assetIndex, JSON.stringify([...existingIndex, ...newEntries], null, 2));
    console.log(`[pexels-photos] +${newEntries.length} photos added to asset_index.json\n`);
  } else {
    console.log(`[pexels-photos] No new photos (all already cached)\n`);
  }
  return newEntries;
}

// assignPexelsPhotoToOverlays — disabled, replaced by fetchLottieForOverlays
async function assignPexelsPhotoToOverlays(overlays) { return; }
async function _assignPexelsPhotoToOverlays_disabled(overlays) {
  const photoDir   = path.resolve('assets/Health visuals');
  const assetIndex = path.resolve('asset_index.json');
  if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

  let existingIndex = [];
  try { existingIndex = JSON.parse(fs.readFileSync(assetIndex, 'utf8')); } catch {}
  const existingByKey = new Map(existingIndex.map(e => [e.key, e]));

  const newEntries = [];

  for (const overlay of overlays) {
    // Đã có ảnh — kiểm tra xem đã xóa nền chưa
    if (overlay.image_key && existingByKey.has(overlay.image_key)) {
      const existing = existingByKey.get(overlay.image_key);
      if (existing.blend_mode !== 'transparent' && REMOVEBG.enabled && REMOVEBG.onlyCardImages) {
        const srcPath = path.resolve(existing.path);
        if (fs.existsSync(srcPath)) {
          const nobgPath = await removeBackground(srcPath);
          if (nobgPath) {
            existing.blend_mode = 'transparent';
            existing.path = `assets/Health visuals/${path.basename(nobgPath)}`;
            try {
              const idx = JSON.parse(fs.readFileSync(assetIndex, 'utf8'));
              const i = idx.findIndex(e => e.key === overlay.image_key);
              if (i >= 0) { idx[i] = existing; fs.writeFileSync(assetIndex, JSON.stringify(idx, null, 2)); }
            } catch {}
          }
        }
      }
      continue;
    }

    // Ưu tiên dùng image_query_en từ Gemini — chính xác hơn nhiều so với dịch thủ công
    const query = (overlay.image_query_en || '').trim().slice(0, 80)
      || (() => {
           // Fallback: làm sạch tiếng Việt nếu Gemini không sinh query
           return `${overlay.title || ''} ${overlay.detail || ''}`
             .toLowerCase()
             .replace(/[^\w\s]/g, ' ')
             .replace(/\b(là|của|và|với|cho|trong|sau|trước|khi|thì|mà|đó|này|nhé|ko|không|được)\b/g, '')
             .replace(/\s+/g, ' ').trim().slice(0, 80);
         })();

    if (!query || query.length < 4) continue;

    const key = `pexels-card-${overlay.startTime}-${overlay.type}`.replace(/[^a-z0-9-]/g, '-');
    if (existingByKey.has(key)) {
      // Ảnh đã có — nhưng nếu chưa xóa nền thì xử lý ngay bây giờ
      const existing = existingByKey.get(key);
      if (existing.blend_mode !== 'transparent' && REMOVEBG.enabled && REMOVEBG.onlyCardImages) {
        const srcPath = path.resolve(existing.path);
        if (fs.existsSync(srcPath)) {
          const nobgPath = await removeBackground(srcPath);
          if (nobgPath) {
            existing.blend_mode = 'transparent';
            existing.path = `assets/Health visuals/${path.basename(nobgPath)}`;
            // Cập nhật lại index
            try {
              const idx = JSON.parse(fs.readFileSync(assetIndex, 'utf8'));
              const i = idx.findIndex(e => e.key === key);
              if (i >= 0) { idx[i] = existing; fs.writeFileSync(assetIndex, JSON.stringify(idx, null, 2)); }
            } catch {}
          }
        }
      }
      overlay.image_key = key;
      continue;
    }

    try {
      // Luôn thêm suffix để Pexels ưu tiên ảnh nền trắng → multiply blend mode hoạt động đúng
      const cardQuery = `${overlay.image_query_en || query} ${PEXELS.photos.cardBgSuffix}`;
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(cardQuery)}&per_page=${PEXELS.photos.perPage}&size=medium`;
      const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
      if (!res.ok) continue;
      const photos = (await res.json()).photos || [];
      // Ưu tiên ảnh portrait (tỉ lệ dọc) — phù hợp hơn cho card 9:16
      const photo = photos.find(p => p.height > p.width) || photos[0];
      if (!photo) continue;

      const src = photo.src?.portrait || photo.src?.large || photo.src?.medium;
      if (!src) continue;

      const filename = `pexels_card_${photo.id}.jpg`;
      const destPath = path.join(photoDir, filename);
      if (!fs.existsSync(destPath)) {
        process.stdout.write(`[pexels-card] "${query.slice(0,35)}" → ${filename} ... `);
        try { await pexelsDownload(src, destPath); console.log('✓'); }
        catch (e) { console.log(`✗ ${e.message}`); continue; }
      }

      // Xóa nền bằng Remove.bg — trả về PNG transparent, cache lại để tái sử dụng
      const nobgPath = REMOVEBG.onlyCardImages ? await removeBackground(destPath) : null;
      const finalFilename = nobgPath ? path.basename(nobgPath) : filename;
      const finalBlendMode = nobgPath ? 'transparent' : 'multiply';

      const altWords = (photo.alt || query).split(/[\s,]+/).filter(Boolean);
      const entry = {
        key,
        path:        `assets/Health visuals/${finalFilename}`,
        blend_mode:  finalBlendMode,
        description: photo.alt || query,
        keywords_en: altWords.slice(0, 8),
        keywords_vi: [],
        category:    pexelsDetectCategory(altWords.join(' ').toLowerCase()),
        keywords:    [key, ...altWords.slice(0, 4)]
      };

      newEntries.push(entry);
      existingByKey.set(key, entry);
      overlay.image_key = key;
    } catch (err) {
      console.warn(`[pexels-card] failed for "${query.slice(0,35)}": ${err.message}`);
    }
  }

  if (newEntries.length) {
    fs.writeFileSync(assetIndex, JSON.stringify([...existingIndex, ...newEntries], null, 2));
    console.log(`[pexels-card] +${newEntries.length} card photos assigned\n`);
  }
}

const CARD_SFX_CATEGORY_PREFERENCES = {
  STAT:    ["impact", "pop", "cinematic", "rise", "whoosh"],
  ACTION:  ["whoosh", "transition", "rise", "cinematic", "zoom"],
  WARNING: ["notification", "alert", "ui", "impact", "cinematic"],
};

const SFX_CATEGORY_KEYWORDS = [
  { category: "notification", keywords: ["notification", "notify", "alert", "alarm", "warning", "beep"] },
  { category: "whoosh", keywords: ["whoosh", "swoosh", "swish"] },
  { category: "transition", keywords: ["transition"] },
  { category: "rise", keywords: ["riser", "rise", "build", "swell"] },
  { category: "cinematic", keywords: ["cinematic", "dramatic", "trailer", "scary"] },
  { category: "impact", keywords: ["impact", "hit", "boom", "punch", "slam", "scary", "stop"] },
  { category: "pop", keywords: ["pop"] },
  { category: "ui", keywords: ["ui", "click"] },
  { category: "zoom", keywords: ["zoom"] },
  { category: "music", keywords: ["music", "instrumental", "intro", "motivational", "upbeat", "podcast"] }
];

if (reportOnly) {
  if (!srtPath) {
    logError("--report mode requires --srt <srt_path>");
    console.log(`\nUsage:\n  node pipeline.js --srt <srt_path> --report`);
    process.exit(1);
  }
} else if (!videoPath || !outputPath || (!skipGemini && !srtPath)) {
  logError("Missing required arguments!");
  console.log(`\nUsage:\n  node pipeline.js --srt <srt_path> --video <video_path> --output <output_path> [--skip-gemini]`);
  process.exit(1);
}

function sfxTempOutputPath(finalOutputPath) {
  const ext = path.extname(finalOutputPath) || ".mp4";
  const base = path.basename(finalOutputPath, ext);
  return path.join(path.dirname(finalOutputPath), `${base}_sfx_tmp${ext}`);
}

function normalizeSfxFileName(fileName) {
  return String(fileName ?? "").toLowerCase().replace(/[_\s]+/g, "-");
}

function classifySfxFile(fileName) {
  const normalizedName = normalizeSfxFileName(fileName);
  const categories = new Set();

  for (const rule of SFX_CATEGORY_KEYWORDS) {
    if (rule.keywords.some(keyword => normalizedName.includes(keyword))) {
      categories.add(rule.category);
    }
  }

  return [...categories];
}

function discoverSfxFiles() {
  const sfxDir = path.resolve("assets", "sfx");
  if (!fs.existsSync(sfxDir)) return [];

  return fs.readdirSync(sfxDir)
    .filter(fileName => /\.mp3$/i.test(fileName))
    .map(fileName => {
      const filePath = path.join(sfxDir, fileName);
      return {
        fileName,
        filePath,
        categories: classifySfxFile(fileName)
      };
    })
    .filter(item => item.categories.length > 0 && fs.existsSync(item.filePath));
}

function scoreSfxForCardType(item, cardType) {
  const normalizedType = String(cardType ?? "").trim().toUpperCase();
  const preferences = CARD_SFX_CATEGORY_PREFERENCES[normalizedType] || [];
  if (!preferences.length) return 0;

  const normalizedName = normalizeSfxFileName(item.fileName);
  let score = 0;

  for (const category of item.categories) {
    const preferenceIndex = preferences.indexOf(category);
    if (preferenceIndex !== -1) {
      score = Math.max(score, (preferences.length - preferenceIndex) * 100);
    }
  }

  if (item.categories.includes("music")) score -= 500;

  if (normalizedType === "STAT") {
    if (item.categories.includes("impact")) score += 45;
    if (normalizedName.includes("scary")) score += 25;
    if (item.categories.includes("pop")) score += 20;
  } else if (normalizedType === "ACTION") {
    if (item.categories.includes("whoosh")) score += 45;
    if (item.categories.includes("transition")) score += 20;
    if (item.categories.includes("rise")) score += 10;
  } else if (normalizedType === "WARNING") {
    if (item.categories.includes("notification")) score += 70;
    if (item.categories.includes("alert")) score += 35;
    if (item.categories.includes("ui")) score += 15;
  }

  return score;
}

// Trả về pool top-N files per card type (thay vì 1 file duy nhất)
// → mỗi card trong cùng loại sẽ rotate qua pool → không lặp âm thanh
const SFX_POOL_SIZE = 4; // lấy tối đa 4 file khác nhau cho mỗi loại

function buildSfxPoolByCardType() {
  const sfxFiles = discoverSfxFiles();
  const sfxPool = {};

  for (const cardType of Object.keys(CARD_SFX_CATEGORY_PREFERENCES)) {
    const ranked = sfxFiles
      .map(item => ({ item, score: scoreSfxForCardType(item, cardType) }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score || a.item.fileName.localeCompare(b.item.fileName))
      .slice(0, SFX_POOL_SIZE)
      .map(m => m.item.filePath);

    if (ranked.length) sfxPool[cardType] = ranked;
  }

  return sfxPool;
}

// Giữ tương thích — trả về file đầu tiên của pool (dùng ở nơi chỉ cần 1 file)
function buildSfxMapByCardType() {
  const pool = buildSfxPoolByCardType();
  return Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, v[0]]));
}

async function removeBackground(srcPath) {
  if (!REMOVEBG.enabled) return null;
  const ext = path.extname(srcPath);
  const pngPath = srcPath.replace(new RegExp(`\\${ext}$`, 'i'), '_nobg.png');
  if (fs.existsSync(pngPath)) {
    logSuccess(`BG remove: cache → ${path.basename(pngPath)}`);
    return pngPath;
  }
  try {
    const { removeBackground: removeBg } = await import('@imgly/background-removal-node');
    process.stdout.write(`[bg-remove] ${path.basename(srcPath)} ... `);
    const mime = /\.png$/i.test(srcPath) ? 'image/png' : 'image/jpeg';
    const blob = new Blob([fs.readFileSync(srcPath)], { type: mime });
    const result = await removeBg(blob);
    fs.writeFileSync(pngPath, Buffer.from(await result.arrayBuffer()));
    console.log('✓');
    return pngPath;
  } catch (e) {
    logWarning(`BG remove: ${path.basename(srcPath)} failed — ${e.message}`);
    return null;
  }
}

function measureLoudnormStats(videoPath) {
  try {
    const raw = execSync(
      `ffmpeg -i "${videoPath}" -vn -af "loudnorm=I=${AUDIO_LUFS_TARGET}:TP=${AUDIO_TRUE_PEAK_DB}:LRA=${AUDIO_LRA}:print_format=json" -f null - 2>&1`,
      { encoding: 'utf8' }
    );
    const match = raw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const match = out.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

function hasAudioStream(filePath) {
  try {
    const out = execSync(`ffmpeg -i "${filePath}"`, { stdio: 'pipe' }).toString();
    return out.includes('Audio:');
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    return out.includes('Audio:');
  }
}

function mixOverlaySfxIntoOutput(finalOutputPath, overlayEvents) {
  const validEvents = [];
  const seen = new Set();
  const sfxPool = buildSfxPoolByCardType();
  // Đếm số lần đã dùng mỗi loại → rotate qua pool
  const typeCounter = {};

  for (const event of overlayEvents || []) {
    const type = String(event.type ?? "").trim().toUpperCase();
    const pool = sfxPool[type];
    if (!pool?.length) continue;

    // Rotate: card thứ N của type X → dùng pool[N % pool.length]
    const idx = typeCounter[type] ?? 0;
    const filePath = pool[idx % pool.length];
    typeCounter[type] = idx + 1;

    if (!fs.existsSync(filePath)) continue;

    const startTime = toSeconds(event.startTime ?? event.start_ms, 0);
    const key = `${type}|${Math.round(startTime * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    validEvents.push({ type, filePath, delayMs: Math.max(0, Math.round(startTime * 1000)) });
  }

  if (!validEvents.length) return false;

  const tempOutputPath = sfxTempOutputPath(finalOutputPath);
  const sfxInputs = validEvents.map(event => `-i "${event.filePath}"`).join(" ");
  const delayedLabels = validEvents.map((event, index) => {
    const inputIndex = index + 1;
    return `[${inputIndex}:a]volume=${SFX_VOLUME_DB}dB,adelay=${event.delayMs}|${event.delayMs}[sfx${index}]`;
  });
  const mixInputs = ["[0:a]", ...validEvents.map((_, index) => `[sfx${index}]`)].join("");
  const filterComplex = `${delayedLabels.join(";")};${mixInputs}amix=inputs=${validEvents.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`;
  const mixCmd = `ffmpeg -y -i "${finalOutputPath}" ${sfxInputs} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${tempOutputPath}"`;

  logStep(`Mixing ${validEvents.length} overlay SFX event(s) into final output...`);
  console.log(`Running: ${mixCmd}\n`);
  try {
    execSync(mixCmd, { stdio: 'inherit' });
    fs.copyFileSync(tempOutputPath, finalOutputPath);
    fs.rmSync(tempOutputPath, { force: true });
    logSuccess("Overlay SFX mix complete.");
    return true;
  } catch (e) {
    logWarning(`Overlay SFX mix failed: ${e.message}`);
    if (fs.existsSync(tempOutputPath)) fs.rmSync(tempOutputPath, { force: true });
    return false;
  }
}

// Hook SFX — whoosh/impact tại t=0 khi opening hook xuất hiện (Section 6A)
function addHookSfx(outputPath) {
  const sfxFiles = discoverSfxFiles();
  const preferred = ['whoosh', 'cinematic', 'impact'];

  const hookFile = sfxFiles
    .map(f => {
      const score = preferred.findIndex(cat => f.categories.includes(cat));
      return { f, score: score === -1 ? 999 : score };
    })
    .sort((a, b) => a.score - b.score)[0]?.f;

  if (!hookFile || !fs.existsSync(hookFile.filePath)) {
    logWarning('Hook SFX: no suitable file found in assets/sfx/');
    return;
  }

  const tempPath = sfxTempOutputPath(outputPath);
  const cmd = [
    `ffmpeg -y`,
    `-i "${outputPath}"`,
    `-i "${hookFile.filePath}"`,
    `-filter_complex "[1:a]volume=${HOOK_SFX_VOLUME_DB}dB,adelay=0|0[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"`,
    `-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${tempPath}"`
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'inherit' });
    fs.copyFileSync(tempPath, outputPath);
    fs.rmSync(tempPath, { force: true });
    logSuccess(`Hook SFX: "${hookFile.fileName}" at t=0`);
  } catch (e) {
    logWarning(`Hook SFX failed: ${e.message}`);
  }
}

// B-roll cut-in SFX — whoosh nhẹ khi B-roll xuất hiện (content-driven, không random)
function addBrollSfx(outputPath, brollSegs) {
  if (!brollSegs?.length) return;

  const sfxFiles = discoverSfxFiles();
  if (!sfxFiles.length) return;

  // Pool top-3 whoosh/transition cho B-roll
  const brollPool = sfxFiles
    .map(f => ({ f, score: ['whoosh', 'transition'].findIndex(c => f.categories.includes(c)) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(x => x.f);

  if (!brollPool.length) return;

  const events = [];
  let bi = 0;
  for (const seg of brollSegs) {
    const t = toSeconds(seg.startTime, 0);
    const f = brollPool[bi % brollPool.length]; bi++;
    events.push({ filePath: f.filePath, delayMs: Math.round(t * 1000), vol: BROLL_SFX_VOLUME_DB });
    logSuccess(`B-roll SFX: ${f.fileName} at t=${t.toFixed(1)}s`);
  }

  if (!events.length) return;

  const tempPath = sfxTempOutputPath(outputPath);
  const inputs   = events.map(e => `-i "${e.filePath}"`).join(' ');
  const delays   = events.map((e, i) =>
    `[${i+1}:a]volume=${e.vol}dB,adelay=${e.delayMs}|${e.delayMs}[s${i}]`
  );
  const mixIn    = ['[0:a]', ...events.map((_, i) => `[s${i}]`)].join('');
  const filter   = `${delays.join(';')};${mixIn}amix=inputs=${events.length+1}:duration=first:dropout_transition=0:normalize=0[aout]`;
  const cmd      = `ffmpeg -y -i "${outputPath}" ${inputs} -filter_complex "${filter}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${tempPath}"`;

  try {
    execSync(cmd, { stdio: 'inherit' });
    fs.copyFileSync(tempPath, outputPath);
    fs.rmSync(tempPath, { force: true });
    logSuccess(`B-roll SFX: ${events.length} event(s) mixed`);
  } catch (e) {
    logWarning(`B-roll SFX failed: ${e.message}`);
  }
}

// -------------------------------------------------------------
// B-roll: keyword scoring, scheduling, ffmpeg filter builder
// -------------------------------------------------------------
// Archetype → preferred B-roll category
const ARCHETYPE_CATEGORY = {
  MECHANISM:  ['medical', 'body'],
  BENEFIT:    ['fitness', 'lifestyle', 'body'],
  WARNING:    ['medical', 'lifestyle'],
  TIMELINE:   ['lifestyle', 'fitness'],
  METRIC:     ['medical', 'body', 'fitness'],
  ACTION:     ['fitness', 'lifestyle'],
  INGREDIENT: ['food'],
  PROCESS:    ['medical', 'body'],
  COMPARISON: ['lifestyle', 'fitness'],
  TRANSFORMATION: ['fitness', 'body'],
};

function extractWords(text) {
  // Unicode-aware: captures Vietnamese words with diacritics
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
}

function buildVideoPool(overlays, hook, poolSize = 25) {
  if (!brollIndex.length) return [];

  // Build fingerprint từ TOÀN BỘ nội dung video
  const allText = [
    hook?.kicker, hook?.title, hook?.punch,
    ...overlays.map(ov => `${ov.title} ${ov.detail}`)
  ].filter(Boolean).join(' ');

  const words = extractWords(allText);
  const preferredCats = [...new Set(
    overlays.flatMap(ov => ARCHETYPE_CATEGORY[ov.archetype] || [])
  )];

  const scored = brollIndex.map(clip => {
    const kws = [...(clip.keywords_en || []), ...(clip.keywords_vi || [])]
      .map(k => k.toLowerCase());
    const desc = extractWords(clip.description || '');
    const kwHits  = words.filter(w => kws.some(k => k.includes(w) || w.includes(k))).length;
    const descHits = words.filter(w => desc.includes(w)).length;
    const catBonus = preferredCats.includes(clip.category) ? 3 : 0;
    return { clip, score: kwHits * 3 + descHits + catBonus };
  }).sort((a, b) => b.score - a.score);

  const pool = scored.filter(s => s.score > 0).slice(0, poolSize).map(s => s.clip);

  // Nếu pool quá ít, thêm clips theo category
  if (pool.length < 8) {
    const catClips = brollIndex.filter(c =>
      preferredCats.includes(c.category) && !pool.find(p => p.filename === c.filename)
    );
    pool.push(...catClips.slice(0, 10));
  }

  logSuccess(`B-roll pool: ${pool.length} clips relevant to video topic`);
  return pool;
}

function selectBestFromPool(spokenText, pool, usedFilenames) {
  if (!pool.length) return null;
  const words = extractWords(spokenText);

  const scored = pool.map(clip => {
    const kws = [...(clip.keywords_en || []), ...(clip.keywords_vi || [])].map(k => k.toLowerCase());
    const desc = extractWords(clip.description || '');
    const kwHits  = words.filter(w => kws.some(k => k.includes(w) || w.includes(k))).length;
    const descHits = words.filter(w => desc.includes(w)).length;
    let score = kwHits * 3 + descHits;
    if (usedFilenames.has(clip.filename)) score -= 4;
    return { clip, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.clip || null;
}

function scheduleBroll(overlays, totalDuration, geminiHook, cues) {
  const BROLL_INTERVAL = 9;
  const BROLL_DURATION = 4;
  const MIN_DUR        = 1.5;
  const HOOK_SKIP      = 2.0;

  // Build pool từ toàn bộ video — đảm bảo mọi clip đều liên quan chủ đề
  const pool = buildVideoPool(overlays, geminiHook);
  if (!pool.length) {
    logWarning('B-roll: không tìm được clip phù hợp chủ đề video.');
    return [];
  }

  // Find naked stretches
  const coveredWindows = overlays
    .map(ov => ({ start: toSeconds(ov.startTime, 0), end: toSeconds(ov.endTime, 0) }))
    .sort((a, b) => a.start - b.start);

  const nakedStretches = [];
  let cursor = HOOK_SKIP;
  for (const ov of coveredWindows) {
    if (ov.start - cursor > MIN_DUR) nakedStretches.push({ start: cursor, end: ov.start - 0.3 });
    cursor = Math.max(cursor, ov.end + 0.3);
  }
  if (totalDuration - cursor > MIN_DUR) nakedStretches.push({ start: cursor, end: totalDuration - 0.5 });

  const segments = [];
  let poolIdx = 0;
  const used = new Set();

  for (const stretch of nakedStretches) {
    let pos = stretch.start;
    while (pos + MIN_DUR <= stretch.end) {
      const dur = Math.min(BROLL_DURATION, stretch.end - pos);
      if (dur < MIN_DUR) break;

      const windowText = (cues || [])
        .filter(c => c.endTime >= pos && c.startTime <= pos + dur)
        .map(c => c.text).join(' ');

      const clip = windowText.trim()
        ? selectBestFromPool(windowText, pool, used)
        : pool[poolIdx % pool.length];
      poolIdx++;

      if (clip && fs.existsSync(clip.path)) {
        used.add(clip.filename);
        segments.push({ startTime: pos, endTime: pos + dur, clipPath: clip.path, filename: clip.filename });
        logSuccess(`B-roll ${pos.toFixed(1)}s–${(pos + dur).toFixed(1)}s → "${clip.filename.slice(0, 40)}"`);
      }
      pos += BROLL_INTERVAL;
    }
  }

  const coveredSec = segments.reduce((s, seg) => s + seg.endTime - seg.startTime, 0);
  logSuccess(`B-roll: ${segments.length} segments, ${coveredSec.toFixed(1)}s / ${totalDuration}s (${(coveredSec / totalDuration * 100).toFixed(0)}% coverage)`);
  return segments;
}

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

async function detectPresenterSide(videoPath) {
  const tmpDir = path.join(path.dirname(path.resolve(videoPath)), '.face_probe');
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const dur = (() => {
      try {
        const out = execSync(
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
        execSync(`ffmpeg -y -ss ${t} -i "${videoPath}" -vframes 1 -q:v 3 "${p}"`, { stdio: 'pipe' });
        return fs.existsSync(p) ? p : null;
      } catch { return null; }
    }).filter(Boolean);

    if (!probeFrames.length) return 'right';

    const fBrowser = await puppeteer.launch({
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
  const margin = LAYOUT.card.neonBarLeft; // dùng neonBarLeft (70px) làm margin chuẩn — nhất quán 2 bên
  if (side === 'left') {
    // Người quay bên trái → card bên phải
    LAYOUT.card.infoLeft   = LAYOUT.canvas.w - LAYOUT.card.width - margin;
    LAYOUT.card.statLeft   = LAYOUT.canvas.w - LAYOUT.card.statWidth - margin;
    LAYOUT.card.neonBarLeft = LAYOUT.card.infoLeft;  // neon rail theo card edge
    LAYOUT.card.introX     =  160;
    LAYOUT.card.exitX      =   34;
    LAYOUT.visualRow.left  = LAYOUT.canvas.w - LAYOUT.card.width - margin;
    LAYOUT.visualRow.introX =  24;
    LAYOUT.visualRow.exitX  =  16;
    logSuccess(`Presenter: LEFT → cards positioned on RIGHT (margin: ${margin}px)`);
  } else if (side === 'center') {
    // Người quay giữa → card xuống thấp hơn để tránh mặt
    LAYOUT.card.defaultTop = LAYOUT.card.defaultTop + 50;
    logSuccess(`Presenter: CENTER → cards positioned lower (+50px)`);
  } else {
    logSuccess(`Presenter: RIGHT → cards centered (infoLeft: ${LAYOUT.card.infoLeft}px)`);
  }
}

function buildZoomExpr(videoFps) {
  const hf  = Math.round(ZOOM_HOOK_DURATION * videoFps);
  const ef  = Math.round(ZOOM_EASE_DURATION * videoFps);
  const eef = hf + ef;
  const hookRise = (ZOOM_HOOK_PEAK - 1.0).toFixed(4);
  const easeDown = (ZOOM_HOOK_PEAK - ZOOM_KB_BASE).toFixed(4);
  return `if(lt(on,${hf}),1.0+on/${hf}*${hookRise},if(lt(on,${eef}),${ZOOM_HOOK_PEAK.toFixed(4)}-(on-${hf})/${ef}*${easeDown},min(${ZOOM_KB_BASE.toFixed(4)}+(on-${eef})*${ZOOM_KB_RATE.toFixed(6)},${ZOOM_KB_MAX.toFixed(4)})))`;
}

// Builds FFmpeg eq filter chain for warm cinematic color grade
// inLabel/outLabel e.g. '[composited]' → '[outv]'
function buildColorGradeFilter(inLabel, outLabel) {
  const cg = LAYOUT.cinematic.colorGrade;
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

function buildBrollFilter(segs, pngInputIndex, mainW, mainH, videoFps = 30) {
  const zExpr   = buildZoomExpr(videoFps);
  const zFilter = `[0:v]zoompan=z='${zExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=${videoFps}:s=${mainW}x${mainH}[zv]`;

  const gradeFilter = buildColorGradeFilter('[composited]', '[outv]');

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

// -------------------------------------------------------------
// 2. SRT Parsing Engine
// -------------------------------------------------------------
function parseSRT(srtContent) {
  const normalized = srtContent.replace(/\r\n/g, '\n').trim();
  const blocks = normalized.split(/\n\s*\n/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
    if (!timeMatch) continue;

    const startSec = timeToSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
    const endSec = timeToSeconds(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
    const text = lines.slice(2).join(' ');

    cues.push({
      index,
      startTime: startSec,
      endTime: endSec,
      text
    });
  }
  return cues;
}

function timeToSeconds(hrs, mins, secs, ms) {
  return parseInt(hrs, 10) * 3600 + parseInt(mins, 10) * 60 + parseInt(secs, 10) + parseInt(ms, 10) / 1000;
}

// -------------------------------------------------------------
// 3. Gemini API Client (Strict JSON Schema)
// -------------------------------------------------------------
// Lấy danh sách key từ cache Lottie (dùng để inject vào prompt)
function getLottieCacheKeys() {
  if (!fs.existsSync(LOTTIE_DIR)) return [];
  return fs.readdirSync(LOTTIE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, '').replace(/_/g, ' '));
}

async function callGemini(cues, apiKey) {
  const lottieKeys = getLottieCacheKeys();
  const promptText = `
You are a subtitle editor and motion designer for CNFI, a Vietnamese health/fitness channel.
Analyze the transcript cues below and return structured data.

═══════════════════════════════════════════
STEP 0 — READ THE FULL TRANSCRIPT FIRST (mandatory)
═══════════════════════════════════════════
Before doing anything else, read ALL cues from start to finish as a complete piece of content.
Identify:
  (a) The video's single core topic (e.g. "walking after eating burns fat")
  (b) The 3-5 most surprising or counterintuitive claims made
  (c) The narrative arc: what problem is raised → what mechanism explains it → what action should viewer take

Only after understanding the FULL context, proceed to subtitle cleanup, sentence grouping, and overlay creation.
Every decision you make must be grounded in the complete video meaning — not isolated word matching.

═══════════════════════════════════════════
SEMANTIC ACCURACY RULES (apply to all outputs)
═══════════════════════════════════════════
- A sentence or overlay must reflect what the SPEAKER is actually saying in that moment — including the surrounding context.
- Never create an overlay from a sentence fragment. The overlay title + detail must be a complete communicable idea.
- If a cue says "tốc độ chậm" (slow speed), that alone is not an overlay. But if surrounding cues say "đi bộ sau ăn với tốc độ chậm kích hoạt đốt mỡ" → the complete concept is "đi bộ chậm sau ăn → kích hoạt đốt mỡ" → that is an ACTION overlay with a FLOW pattern.
- The pattern must represent WHAT IS PHYSICALLY OR CONCEPTUALLY HAPPENING, derived from reading title + detail together as one sentence, not from individual words.

SUBTITLE STYLE RULES:
Assign a "style" field to each sentence. This controls the visual display mode.

style "normal" (default — all sentences that are not peak):
  → Standard pill background, karaoke word highlight.
  Use for: regular narration, transitions, context setup, background info, filler.

style "peak" (use at EVERY high-impact moment — typically 4–8 times per video):
  → Cinematic multi-line display. Each line = 1 SEMANTIC CHUNK with its own visual style.
  → Split by MEANING — never by word count.

  ⚠️ MANDATORY: fill "peak_lines" as array of {text, type} objects. Each object = 1 displayed line.
  CHUNK TYPES (5 types):
    "connector"     — tiny glue word (36px, dim white): "về", "của", "như", "để", "mà" — use sparingly
    "regular"       — context phrase (44px, white): sets up who/what/when/why — reads first
    "anchor"        — key concept (90px, bold white): THE BIGGEST LINE — core subject, shocking verb, named term
    "script"        — emotional support (72px, white ExtraBold): strong supporting phrase, not the climax
    "script_climax" — THE HERO (72px, premium cursive + CNFI lime): stands out through FONT+COLOR not size.
                      This is the emotional apex — the line that makes them stop scrolling.
                      RULE: max 1 script_climax per peak sentence. Choose the most powerful phrase only.

  DESIGN RULES:
  1. Every peak sentence MUST have BOTH 1 "anchor" AND 1 "script_climax" — both are MANDATORY, never omit either.
     "anchor" = focal concept (white bold, impact by SIZE — the "what" that hits hardest visually).
     "script_climax" = emotional punchline (gold cursive, style impact — the "feel" that resonates).
     Together they create the TYB dual-focal visual hierarchy. A cascade with only one is incomplete.
  2. Script types ("script" / "script_climax") = the most emotionally charged chunk(s).
  3. "anchor" = the most conceptually impactful word/phrase (bold white, stands out by SIZE).
  4. "connector" used only for functional glue words — max 1–2 connectors per sentence.
  5. All texts concatenated = sentence "text" field. No words may be omitted or added.
  6. Minimum 3 chunks, maximum 6 chunks.
  ⛔ script_climax MUST be the MOST POWERFUL phrase — the one that stops scrolling. NEVER assign script_climax to:
     - generic filler: "cho sức khỏe", "của bạn", "rất tốt", "như vậy" — always "regular" or "connector"
     - location/scope modifiers: "hành tinh", "trên đời", "thế giới", "trong cơ thể" — these are just modifiers, NEVER script_climax
     - trailing 1-2 word tags that only describe WHERE/WHO/HOW: "của mình", "với bạn", "mỗi ngày"
     - the LAST phrase just because it's last — assign by MEANING, not position

  CORRECT EXAMPLES of script_climax assignment:
     ✅ "mà nó còn dành cho trí não của bạn"
        → [{text:"mà nó còn", type:"connector"}, {text:"dành cho", type:"connector"}, {text:"trí não", type:"script_climax"}, {text:"của bạn", type:"regular"}]
        ⛔ SAI: "dành cho trí" / "não của bạn" — cắt giữa từ ghép "trí não"
        ⛔ SAI: "não của bạn" là script_climax — đây là possessive modifier
     ✅ "mang lại hiệu quả cao nhất hành tinh"
        → [{text:"mang lại", type:"connector"}, {text:"hiệu quả", type:"anchor"}, {text:"cao nhất", type:"script_climax"}, {text:"hành tinh", type:"regular"}]
        ⛔ NEVER: [{text:"mang lại hiệu quả cao", type:"regular"}, {text:"nhất hành tinh", type:"script_climax"}] ← SAI
        ⛔ NEVER: [{text:"mang lại hiệu quả cao nhất", type:"anchor"}, {text:"hành tinh", type:"script_climax"}] ← SAI
        "nhất hành tinh" và "hành tinh" LUÔN LUÔN là regular — không có ngoại lệ.
        anchor = "hiệu quả" (focal concept), script_climax = "cao nhất" (superlative punch) — cả hai PHẢI có mặt.
     ✅ "mang lại lợi ích khổng lồ cho sức khỏe"
        → [{text:"mang lại", type:"connector"}, {text:"lợi ích", type:"anchor"}, {text:"khổng lồ", type:"script_climax"}, {text:"cho sức khỏe", type:"regular"}]
        anchor = "lợi ích" (focal noun), script_climax = "khổng lồ" (superlative modifier) — cả hai PHẢI có mặt.
     ✅ "insulin giúp glucose vào thẳng tế bào cơ"
        → [{text:"insulin", type:"script_climax"}, {text:"giúp", type:"connector"}, {text:"glucose", type:"anchor"}, {text:"vào thẳng tế bào cơ", type:"regular"}]

  ⛔ LINE BREAK RULE — MOST IMPORTANT: Each chunk = 1 COMPLETE SEMANTIC PHRASE. NEVER split mid-phrase.

  COMPOUND NOUN RULE (từ ghép) — STRUCTURAL, apply to ANY word, not just the list below:
  A compound is 2+ syllables that together form ONE inseparable concept.

  SELF-TEST at every chunk boundary (last word of chunk A, first word of chunk B):
    → Can [last word of chunk A] stand alone with the SAME meaning in this context?
      YES (has standalone meaning) = boundary is OK.
      NO  (needs next word to complete its meaning) = COMPOUND — keep both words in chunk A.

  Self-test examples:
    "trí não"   → "trí" alone ≠ brain             → compound → never split
    "thụ thể"   → "thụ" alone ≠ receptor          → compound → never split
    "giả dược"  → "giả" alone ≠ placebo            → compound → never split
    "bí kíp"    → "bí" alone ≠ secret technique    → compound → never split
    "tế bào"    → "tế" alone ≠ cell                → compound → never split
    "hiệu ứng"  → "hiệu" alone ≠ effect/phenomenon → compound → never split
    "tiểu đường"→ "tiểu" alone ≠ diabetes          → compound → never split
    "cơ chế"    → "cơ" alone ≠ mechanism           → compound → never split
    "tác dụng"  → "tác" alone ≠ effect/action      → compound → never split
    "mấu chốt"  → "mấu" alone ≠ key point          → compound → never split

  RULE: This test applies to EVERY word pair at every chunk boundary, not just known words.
  When in doubt → keep in same chunk.

  BAD: "dành cho trí" | "não của bạn"    ← "trí não" split → SAI
  GOOD: "dành cho" | "trí não" | "của bạn"  ← ĐÚNG
  BAD: "gọi là hiệu" | "ứng giả dược"   ← "hiệu ứng" split → SAI
  GOOD: "gọi là" | "hiệu ứng giả dược"  ← ĐÚNG
  BAD: "giả" | "dược"                    ← compound split + 1-word chunks → SAI
  GOOD: "giả dược"                       ← ĐÚNG
  BAD: "bí" | "kíp hack"                 ← "bí kíp" split → SAI
  GOOD: "bí kíp hack"                    ← ĐÚNG
  BAD: "giúp bạn tăng" | "cường sức mạnh" ← "tăng cường" split → SAI
  GOOD: "giúp bạn" | "tăng cường" | "sức mạnh" | "cơ bắp"  ← ĐÚNG
  BAD: "mang lại" | "kết quả"           ← "kết quả" split → SAI (kết = first syllable)
  GOOD: "mang lại" | "kết quả cao nhất"  ← ĐÚNG
  BAD: "lợi ích" | "khổng lồ"           ← "khổng lồ" split → SAI (khổng ≠ không)
  GOOD: "lợi ích" | "khổng lồ"          ← ĐÚNG (khổng lồ = enormous, KHÔNG PHẢI "không + lồ")

  ⛔ script_climax BLACKLIST — những phrase sau KHÔNG BAO GIỜ là script_climax dù ở vị trí nào:
  - Possessive endings: "của bạn", "của mình", "của t", "của họ", "của cơ thể"
  - Location/scope: "hành tinh", "thế giới", "trong cơ thể", "trên đời"
  - Beneficiary: "cho sức khỏe", "cho não", "cho bạn", "cho cơ thể"
  - Generic modifiers: "rất tốt", "như vậy", "như thế", "mà thôi"
  Test trước khi assign script_climax: phrase này có ý nghĩa độc lập không? "não của bạn" → không (cần biết "não của bạn" để làm gì). "trí não" → có (từ ghép mang nghĩa). → "trí não" = script_climax, "của bạn" = regular.

  WORD COUNT: Every chunk must have ≥ 2 words, EXCEPT "anchor" (can be 1 keyword: "GLUT4", "insulin") and "connector" (glue words: "về", "của").

  CHUNK COUNT: Tổng số chunks = 3 hoặc 4. KHÔNG BAO GIỜ 5+.
  - 3 chunks (lý tưởng): [connector/regular] + [anchor] + [script_climax]
  - 4 chunks (mạnh nhất): [connector] + [regular] + [anchor] + [script_climax]
  ⚠ anchor VÀ script_climax phải CÙNG CÓ MẶT trong mỗi cascade — không thể thiếu một trong hai.
  - 5+ chunks: SAI — phải merge các chunk nhỏ liền nhau

  ANCHOR SEMANTIC RULE: anchor = 1-3 từ CORE — phải là DANH TỪ hoặc CỤM DANH TỪ (noun/noun phrase).
  anchor là CONCEPT (khái niệm), không phải ACTION (hành động).

  ⛔ KHÔNG BAO GIỜ dùng động từ hành động làm anchor:
  BAD: anchor = "giảm các"       ← "giảm" là động từ, "các" là classifier → SAI
  BAD: anchor = "cải thiện cái"  ← "cải thiện" là động từ, "cái" là classifier → SAI
  BAD: anchor = "tăng cường"     ← động từ thuần túy → SAI
  BAD: anchor = "hỗ trợ"        ← động từ → SAI
  GOOD: connector = "giảm", anchor = "triệu chứng", script_climax = "bệnh trầm cảm"
  GOOD: connector = "cải thiện", anchor = "chức năng nhận thức"
  GOOD: connector = "tăng cường", anchor = "sức mạnh", script_climax = "cơ bắp"

  ⛔ Classifier/article KHÔNG BAO GIỜ đứng cuối anchor:
  BAD: "giảm các"       ← "các" là classifier → đừng đặt vào anchor
  BAD: "cải thiện cái"  ← "cái" là classifier/article → đừng đặt vào anchor
  BAD: "những lợi"      ← "những" là classifier → đừng đặt vào anchor
  RULE: "các", "cái", "những", "một", "mỗi" → LUÔN là connector hoặc regular, KHÔNG bao giờ cuối anchor.

  ⛔ anchor KHÔNG bao giờ kết thúc bằng giới từ:
  BAD: "lập trình cho"  ← kết thúc bằng giới từ "cho" → SAI
  BAD: "vận hành dựa"  ← kết thúc bằng "dựa" (cần "trên" → incomplete)
  GOOD: anchor = danh từ/cụm danh từ độc lập có nghĩa đầy đủ không cần từ tiếp theo

  REAL TYB EXAMPLES (copy this pattern):
  Sentence: "dễ chon những cách quen thuộc nhất"
  → [{text:"dễ chon", type:"regular"}, {text:"những cách", type:"anchor"}, {text:"quen thuộc nhất", type:"script_climax"}]

  Sentence: "cho những ai đang gặp vấn đề về mỡ"
  → [{text:"cho những ai", type:"regular"}, {text:"đang gặp", type:"regular"}, {text:"vấn đề", type:"anchor"}, {text:"về", type:"connector"}, {text:"mỡ", type:"script_climax"}]

  Sentence: "1 góc nhìn về cách cơ thể bạn phản ứng"
  → [{text:"1 góc nhìn", type:"regular"}, {text:"về cách", type:"connector"}, {text:"cơ thể", type:"anchor"}, {text:"phản ứng", type:"script_climax"}]
  ⚡ anchor = "cơ thể" (focal concept — what the sentence is ABOUT), script_climax = "phản ứng" (punchline — the REACTION). Cả hai PHẢI có mặt.

  Sentence: "họ rất dễ bị cơ thể của mình đánh bại"
  → [{text:"họ rất dễ bị", type:"regular"}, {text:"cơ thể", type:"anchor"}, {text:"của mình", type:"connector"}, {text:"đánh bại", type:"script_climax"}]
  ⚡ anchor = "cơ thể" (focal noun — the agent that defeats them), script_climax = "đánh bại" (emotional punchline — defeated by own body). Cả hai PHẢI có mặt.

  Sentence: "cảm thấy hành trình của họ nhẹ hơn rồi"
  → [{text:"cảm thấy", type:"regular"}, {text:"hành trình", type:"anchor"}, {text:"của họ", type:"script"}, {text:"nhẹ hơn rồi", type:"script_climax"}]

  Sentence: "những tín hiệu đang bị nhiễu hết cả lên rồi"
  → [{text:"những tín hiệu", type:"script_climax"}, {text:"đang bị", type:"connector"}, {text:"nhiễu", type:"anchor"}, {text:"hết cả lên rồi", type:"regular"}]

  Sentence: "insulin giúp glucose vào thẳng tế bào cơ"
  → [{text:"insulin", type:"script_climax"}, {text:"giúp", type:"connector"}, {text:"glucose", type:"anchor"}, {text:"vào thẳng tế bào cơ", type:"regular"}]

  Sentence: "người được thông báo ngủ sâu đạt điểm cao hơn đáng kể"
  → [{text:"người được thông báo", type:"regular"}, {text:"ngủ sâu", type:"anchor"}, {text:"đạt điểm cao hơn đáng kể", type:"script_climax"}]
  ⚡ Lead-in "người được thông báo" = 3 từ → CHẤP NHẬN (pipeline sẽ tự split thành normal+peak nếu cần)

  ⛔ SENTENCE-LEVEL PEAK RULES — QUAN TRỌNG:

  RULE A — Câu hỏi KHÔNG BAO GIỜ là peak:
  Bất kỳ câu nào có dấu "?" hoặc mang cấu trúc hỏi → style = "normal", không bao giờ "peak".
  BAD: "bạn có biết bí kíp hack đỉnh nhất hành tinh là gì không?" → style: "peak"  ← SAI
  GOOD: "bạn có biết bí kíp hack đỉnh nhất hành tinh là gì không?" → style: "normal"  ← ĐÚNG
  Detect: câu kết thúc "?", "không?", "chứ?", "nhỉ?", "hả?", hoặc có cấu trúc "có ... không/chưa".
  Reason: questions build suspense — assigning peak kills the hook tension by prematurely resolving it.

  RULE B — Lead-in dài trước anchor → KHÔNG dùng peak:
  Nếu phần regular/connector nằm TRƯỚC anchor đầu tiên trong peak_lines chiếm > 3 từ → gán câu đó style "normal".
  BAD: peak với [{text:"bạn có biết rằng đây là", type:"regular"}, {text:"bí kíp", type:"anchor"}, ...]
    ← "bạn có biết rằng đây là" = 5 từ lead-in → dùng "normal" thay vì "peak"
  GOOD: peak chỉ khi impact bắt đầu sớm — lead-in (regular/connector) trước anchor ≤ 3 từ.
  OK PATTERN: [{text:"người được thông báo", type:"regular"}, {text:"ngủ sâu", type:"anchor"}, ...]
    ← lead-in = 3 từ → CHẤP NHẬN
  Reason: pipeline tự split long lead-in thành normal sentence — nhưng Gemini không nên tạo ra pattern xấu ngay từ đầu.

  RULE C — Câu phức (mệnh đề quan hệ / đại từ lặp) → KHÔNG bao giờ là peak:
  Các câu SAU ĐÂY không thể tạo cascade đẹp → bắt buộc style = "normal":
  • Câu chứa "mà nó", "mà còn", "mà vẫn", "mà không" (relative clause) — cascade sẽ dài và rối
  • Câu lặp cùng cụm sở hữu 2 lần trở lên: "của bạn...của bạn", "cho bạn...cho bạn" — trailing dư thừa
  • Câu quá dài (> 10 từ) với nhiều cụm phụ (connector phrase > 4 từ bắt đầu bằng của/cho/mà/nó/nếu)
  BAD: "cơ bắp của bạn mà nó còn dành cho trí não của bạn" → style: "peak"  ← SAI (relative clause + lặp "của bạn")
  GOOD: "cơ bắp của bạn mà nó còn dành cho trí não của bạn" → style: "normal"  ← ĐÚNG
  Lưu ý: nếu câu quá phức nhưng muốn làm peak, HÃY chọn câu KHÁC trong đoạn gần đó có nội dung rõ ràng hơn.

  Use for: surprising premise reveal, shocking stat, mechanism climax, emotional hook, closing conclusion.
  RULES:
  - Peak NOT before 5s — hook owns that window.
  - Minimum 8s gap between two consecutive peak sentences — never cluster.
  - Peak must NOT overlap any card time window (cards and peaks occupy the same visual channel).
  - No hard cap on count — use as many as the content justifies.

CONTENT-TYPE MIXING GUIDE (for rhythm and flow):
  Hook / intro (first 15%): 1 peak for the hook climax (first moment that stops the scroll)
  Body (middle 70%): peak at every genuinely surprising fact, mechanism reveal, or emotional turn — roughly 1 peak per major sub-point
  Conclusion / CTA (last 15%): 1 peak for the final payoff line

STYLE EXAMPLES:
  "hạt chia chứa 10 gam chất xơ" → normal  (factual, no drama)
  "nó hút nước gấp 12 lần trọng lượng" → peak  (shocking ratio — STOP SCROLL moment)
  "bạn đang chiến đấu với não của chính mình" → peak  (emotional hook — strong mechanism)
  "đây là lý do bạn không thể giảm cân" → peak  (hook climax)
  "và đó là sự thật về tiểu đường" → peak  (final conclusion)
  "hôm nay chúng ta sẽ nói về hạt chia" → normal  (intro setup)
  "được trồng tại Mexico từ hàng nghìn năm trước" → normal  (background context)

STRICT SUBTITLE RULES:
1. Each sentence should be one readable semantic phrase, usually 4-8 words and never more than 9 words.
2. Do not split one complete idea into tiny fragments just to make subtitles shorter.
3. Do not merge unrelated cues into one long sentence.
4. Split long cues at natural phrase boundaries.
5. Preserve transcript timing. Do not invent timestamps.
6. Words array must contain only words from the transcript.
7. Remove filler words when they do not change meaning.
8. ANTI-DUPLICATE RULE: If a subtitle sentence's text is identical or nearly identical (≥80% word overlap) to a card title that appears at the same time window, REPHRASE the subtitle OR shift its timing so they do not appear simultaneously. A viewer should never see the same text in both the subtitle and the card at the same moment — it is redundant and visually noisy.

SEMANTIC OVERLAY RULES:
1. Select overlays by meaning and full sentence context, not by keyword matching alone.
2. For every overlay, assign one archetype that describes what kind of information it conveys:
   MECHANISM  — how something physically or chemically works: absorption, transport, gel formation, enzyme reaction, protein synthesis, any process inside the body
   BENEFIT    — a positive outcome or effect: satiety, energy, recovery, reduced inflammation, better sleep, weight control, improved focus, reduced bloating
   WARNING    — a risk, mistake, or contraindication: overexertion, wrong timing, dehydration, dangerous habit, side effect
   TIMELINE   — a duration or timing window expressed as a range: 15-30 minutes, 8 hours, within 30 minutes after eating
   METRIC     — a single measurable number with unit: 21%, 150 kcal, 120 bpm, 10000 steps
   ACTION     — a concrete step or habit the viewer should do: walk slowly after eating, drink water first, eat before workout
   INGREDIENT — use ONLY when naming or quantifying a substance itself: "hạt chia chứa omega-3", "5g chất xơ mỗi muỗng canh". If the overlay says what the substance DOES (giảm viêm, hỗ trợ tiêu hóa, xây dựng cơ bắp), use BENEFIT or MECHANISM instead
   PROCESS    — an ongoing or recurring bodily activity: digestion, metabolism, fat oxidation, blood circulation, hormonal regulation
3. Single-value metrics such as "21%", "150 kcal", "10000 buoc", "120 bpm" → archetype METRIC, type STAT.
4. Range/time metrics such as "15-30 phut" → archetype TIMELINE, type STAT.
5. Mechanism concepts such as "GLUT4", "enzyme", "receptor", "absorption" → archetype MECHANISM, type ACTION.
6. Zone or scale concepts such as "Zone 2" → archetype METRIC, type ACTION.
7. The archetype field is the primary signal the rendering engine uses to select the correct visual. Set it based on what the overlay is actually communicating, not on the topic of the video.
8. Do not use English labels in Vietnamese overlay copy. Use "duong", "te bao co", "tinh bot", "van dong" unless the scientific term itself is standard, such as GLUT4 or Zone 2.
9. Write title and detail based on the actual sentence content. Do not assume or add topic-specific framing.
10. Do not use a blood-sugar or glucose frame unless the transcript explicitly discusses blood sugar, glucose, insulin, or GLUT4.
11. MULTIPLIER FORMAT: When a card title expresses a multiplier or "times better" claim, write it as "Xn" (X2, X3, X4, X10) — NEVER "nX" (2X, 3X, 4X). Example: "HIỆU QUẢ X4" ✓, "HIỆU QUẢ 4X" ✗. This is the standard Vietnamese health content convention.

OVERLAY CARD RULES:
1. Create 7 to 10 overlay cards per video. ACTION is the dominant type — aim for at least 5 ACTION cards per video. WARNING and STAT are secondary.
2. Card types:
   - ACTION (dominant — use most): tip, mechanism, movement, nutrition concept, key fact, practical explanation. Use for anything the viewer should know, do, or remember.
   - WARNING (use sparingly — 1 to 2 max): risk, mistake, contraindication, dangerous habit.
   - STAT (use when a number stands alone): measurable numeric health metric or numeric timeline.
3. For STAT cards:
   - title: metric value with unit only (e.g. "28G", "30 PHÚT", "21%"). UPPERCASE. No extra words.
   - detail: short meaning or context, maximum 8 words. Sentence case — chữ đầu viết hoa, còn lại viết thường.
   - RESULT vs BASELINE rule: when a sentence has both a result metric AND a comparison baseline,
     ALWAYS use the RESULT metric as title — NEVER the baseline.
     RESULT = the improvement/outcome (e.g. "gấp 4 lần", "giảm 40%", "tăng 2x")
     BASELINE = what appears after "so với", "hơn", "thay vì", "compared to"
     BAD: "cải thiện gấp 4 lần so với đi bộ 10.000 bước" → STAT "10.000 BƯỚC"  ← baseline, WRONG
     GOOD: same sentence → STAT "GẤP 4 LẦN" + detail "Cải thiện huyết áp so với đi bộ thường"
4. For ACTION/WARNING cards:
   - title: short subject or hook, maximum 6 words. UPPERCASE.
   - detail: result, mechanism, risk, or practical meaning, maximum 10 words. Sentence case — chữ đầu viết hoa, còn lại viết thường.
5. Cards should not overlap each other when avoidable.
6. PEAK SEPARATION RULE (mandatory): A card must NEVER share a time window with a peak-style sentence.
   - First, finalize all peak sentence time windows (startTime → endTime).
   - Then, place every card entirely OUTSIDE those windows — before or after, never during.
   - If a natural card moment falls inside a peak window, shift the card to the nearest non-peak gap (≥0.5s clear on both sides).
   - A card and a peak sentence showing at the same time is always wrong — they occupy the same visual channel.
7. Card duration: 3.5 to 6.0 seconds. Use longer end of range (5.0–6.0s) for PROCESS/METHOD/CHECKLIST cards that describe multi-step sequences.
8. REPEAT rule: PROCESS and METHOD cards (cards describing a sequence of steps, a protocol, or a workflow) MAY appear 2 times — once near the start of the topic section, once near the end as a recap. Use the same title and detail. Space them at least 15 seconds apart. Do NOT repeat STAT, WARNING, or single-fact cards.

CARD TEXT QUALITY RULES (critical):
- NEVER copy raw transcript text into title or detail. Always rephrase into clean, standalone statements.
- NEVER include filler words: "thì", "mà", "là", "đó", "này", "nhé", "chắc chắn là", "bạn đang nghĩ", "uh", "um" or any speech hesitation.
- NEVER use incomplete thoughts or mid-sentence fragments. Every title and detail must make sense on its own without watching the video.
- title and detail must be clean, publishable Vietnamese that a viewer can read and immediately understand.
- If the source sentence is not clear enough to produce a clean card, skip it — do not create a card for that moment.

DETAIL TEXT EXAMPLES — study these carefully:
BAD (fragment copied from ASR): "kết quả mang lại hiệu quả đến mức"   → rejected: cut off mid-sentence
BAD (fragment copied from ASR): "cuộc họp quan trọng và lặp lại điều"  → rejected: "điều" is incomplete
BAD (fragment copied from ASR): "chiến lược tiến bộ đó là bạn có"      → rejected: "bạn có" is incomplete
GOOD (for 30 PHÚT STAT):        "Duy trì mỗi ngày để tích lũy kết quả" → complete thought, clear meaning
GOOD (for 10.000 BƯỚC STAT):    "Giảm 30% nguy cơ bệnh tim mạch"       → complete, stands alone
GOOD (for 40-45 PHÚT STAT):     "Đốt mỡ tối ưu ở cường độ Zone 2"      → complete, meaningful
The detail must answer "this number/fact means WHAT exactly?" in a complete phrase.
- FIX ALL ASR ERRORS before using any text in card title or detail:
  - Numbers run together: "1530" → "15-30", "2030" → "20-30", "10000" → "10.000"
  - Abbreviations: "ko" → "không", "dc" → "được", "vs" → "và", "k" → "không"
  - Words merged without space: split them correctly
  - Wrong tone marks: correct obvious mispronunciations from speech recognition
  - Never leave ASR artifacts in the final card text — rewrite from the intended meaning

NUMBERED LIST DETECTION RULES (MANDATORY — read carefully):
You MUST detect and tag lists whenever the transcript contains ANY of these patterns:

EXPLICIT triggers (speaker clearly enumerates):
- Numbers: "3 cách", "5 bước", "4 lý do", "2 điều", "cách 1... cách 2...", "bước 1... bước 2..."
- Ordinals: "thứ nhất... thứ hai... thứ ba", "đầu tiên... tiếp theo... cuối cùng"
- Sequence words: "một là... hai là... ba là", "trước tiên... sau đó... cuối cùng"

IMPLICIT triggers (speaker gives parallel items without numbering):
- 3 or more parallel "you can do X" items in sequence (e.g. "bạn có thể thêm vào nước... ăn kèm sữa chua... trộn vào sinh tố...")
- 3 or more health tips/benefits listed back-to-back with similar sentence structure
- Any section where the speaker clearly switches between distinct sub-topics of the same theme

RULES:
1. Assign the same list_group string to ALL items (e.g., "chia-usage", "fat-burn-steps", "sleep-tips")
2. Set list_index (1, 2, 3...) and list_total
3. NEVER create a list with only 1 item. Minimum 2 items required.
4. Choose list_style:
   - "progressive": 2–3 independent tips (most common for health tips)
   - "steps_overview": 4–5 sequential steps forming a protocol
   - "number_slam": items tied to a key number/stat
   - "checklist": do/don't habit items
5. During a list window: NO non-list overlays allowed.
6. When in doubt — TAG IT AS A LIST. Missing a list is worse than over-tagging.

LOTTIE ANIMATION RULE:
For each overlay, set "lottie_query_en" to the EXACT key from the AVAILABLE ANIMATIONS list below that best matches the overlay content.

Rules:
- You MUST pick from the list. Do NOT invent or modify a key.
- Each overlay MUST use a DIFFERENT key — no two overlays may share the same lottie_query_en.
- ⚠️ VARIETY IS MANDATORY: scan the FULL list before picking. Do NOT default to the first matching word. Force yourself to consider at least 5 different candidate keys before choosing.
- VISUAL QUALITY RULE: prefer animations that are COLORFUL, BRIGHT, HIGH-CONTRAST:
  • GOOD picks: fire/flame, trophy, star, lightning, rocket, growth chart, target, confetti, shield, diamond, crown, coin, medal, calendar, alarm, brain (colorful), heart pulse
  • AVOID: keys with "dark", "shadow", "night", "gray", "black" in the name. Also avoid overly clinical/anatomical keys that tend to be monochrome.
- STRONGLY PREFER visual/abstract/object icons over anatomical/body-part icons:
  • "insulin resistance" → "shield protection lock" or "target goal success" (NOT blood/organ)
  • "fat burning" → "fire flame burn" or "energy power lightning" (NOT anatomy)
  • "blood sugar stable" → "balance scale steady" or "graph line stable" (NOT blood drop)
  • Body stats → prefer chart/progress/counter keys, NOT anatomical imagery
- Use anatomical icons ONLY when the overlay is EXPLICITLY about a body part/organ
- ⚠️ MATCH THE TITLE SUBJECT FIRST — the animation must represent WHAT the card is about (its noun/topic), NOT the sentiment/quality of the detail text.
  • "CREATINE CHO MỌI NGƯỜI" + detail "an toàn" → pick "creatine supplement" (topic = creatine), NOT "shield" (sentiment = safe)
  • "INSULIN KHÁNG" + detail "nguy hiểm" → pick "insulin resistance" or "hormone balance", NOT "warning sign"
  • "NGỦ ĐỦ GIẤC" + detail "phục hồi cơ" → pick "sleep recovery" or "8 hours sleep", NOT "muscle"
- Match SEMANTICALLY — think about what the overlay COMMUNICATES as a visual concept:
  • Outcome/benefit → checkmark, trophy, star, medal, crown
  • Warning/risk → warning, danger, alert, alarm
  • Statistic/number → chart, progress bar, counter, percentage
  • Food/nutrition → food item, ingredient, leaf, fruit
  • Process/habit → gear, cycle, calendar, clock, routine
- For STAT cards: match the UNIT visually:
  "45 PHÚT" → "timer countdown clock" or "alarm clock morning"
  "GẤP 4 LẦN" → "chart statistics graph" or "growth increase arrow up" or "bar grow taller"
  "40%" → "percentage progress bar" or "loading progress circle"
- Output the key exactly as it appears in the list (spaces, not underscores).

AVAILABLE ANIMATIONS:
${(() => { const keys = [...lottieKeys]; for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; } return keys.join(', '); })()}

color field:
- "accent"  (default) — green, for positive/informational/neutral content
- "warning"           — red, for danger, risk, mistake, harmful accumulation

OPENING HOOK RULES:
Write one opening hook that captures the single most surprising or counterintuitive insight in this video.
- kicker: 2-4 uppercase words naming the topic (e.g., "SỨC KHỎE", "DINH DƯỠNG", "HẠT CHIA", "GIẤC NGỦ")
- title: 5-9 uppercase words that create tension or surprise. Start with "ĐỪNG" / "BẠN ĐANG" / "SAI LẦM" / "ÍT AI BIẾT" to provoke curiosity. Do not reveal the answer.
- punch: 4-7 uppercase words that hint at the insight without fully explaining it. Start with a verb.

B-ROLL QUERY RULES:
Before scheduling, add "broll_queries_en" at the root level: 4-6 English search queries for Pexels Videos.
Rules:
- English only. Each query must describe a SPECIFIC SCENE from this video's content — not a generic topic.
- Think: what would a camera crew film to illustrate THIS specific moment in the video?
- Include WHO + doing WHAT + WHERE/HOW. 4-7 words per query.
- Good: "person walking slowly after dinner street", "elderly man interval walk park", "woman checking fitness watch heart rate outdoor"
- Bad: "walking", "exercise", "health lifestyle", "fitness person" — too vague, useless for matching
- Each query should match a DIFFERENT key moment discussed in the transcript.
- Portrait orientation preferred (vertical video).

B-ROLL SCHEDULING RULES:
B-roll is OPTIONAL. Only schedule a clip if it specifically and clearly illustrates what the speaker is saying.
- Only in gaps between overlay cards (no card showing)
- Each clip 3-4 seconds
- If no clip closely matches the spoken content → skip that gap entirely. Talking head is fine.
- Do NOT force clips just to fill time. Irrelevant B-roll is worse than no B-roll.
- If no B-roll fits → skip that gap entirely (empty entry, no filler)
- Each item must have "filename" (video clip)
- NEVER use the same filename more than once across the entire schedule
- filename must be EXACTLY as listed in B-roll clips below

Available B-roll clips (video):
${brollIndex.map(c => `  ${c.filename} — ${c.description || (c.keywords_en||[]).slice(0,4).join(', ')}`).join('\n')}

Input Cues:
${JSON.stringify(cues, null, 2)}
`;

  const payload = {
    contents: [{
      parts: [{ text: promptText }]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          sentences: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                index: { type: "INTEGER" },
                text: { type: "STRING" },
                startTime: { type: "NUMBER" },
                endTime: { type: "NUMBER" },
                words: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                },
                style: { type: "STRING", enum: ["normal", "peak"] },
                peak_lines: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      text: { type: "STRING" },
                      type: { type: "STRING", enum: ["connector", "regular", "anchor", "script", "script_climax"] }
                    },
                    required: ["text", "type"]
                  }
                }
              },
              required: ["index", "text", "startTime", "endTime", "words", "style", "peak_lines"]
            }
          },
          overlays: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                type: { type: "STRING", enum: ["WARNING", "ACTION", "STAT"] },
                archetype: { type: "STRING", enum: ["MECHANISM","BENEFIT","WARNING","TIMELINE","METRIC","ACTION","INGREDIENT","PROCESS","COMPARISON","TRANSFORMATION"] },
                title: { type: "STRING" },
                detail: { type: "STRING" },
                startTime: { type: "NUMBER" },
                endTime: { type: "NUMBER" },
                visual_value: { type: "NUMBER" },
                metric_direction: { type: "STRING", enum: ["up","down","multiply","min","max","cycle","approx","neutral"] },
                lottie_query_en: { type: "STRING" },
                list_group:      { type: "STRING" },
                list_index:  { type: "INTEGER" },
                list_total:  { type: "INTEGER" },
                list_style:  { type: "STRING", enum: ["progressive","steps_overview","number_slam","checklist"] }
              },
              required: ["type", "archetype", "title", "detail", "startTime", "endTime", "visual_value", "lottie_query_en"]
            }
          },
          hook: {
            type: "OBJECT",
            properties: {
              kicker: { type: "STRING" },
              title:  { type: "STRING" },
              punch:  { type: "STRING" }
            },
            required: ["kicker", "title", "punch"]
          },
          broll_schedule: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                startTime: { type: "NUMBER" },
                endTime:   { type: "NUMBER" },
                filename:  { type: "STRING" }
              },
              required: ["startTime", "endTime", "filename"]
            }
          },
          broll_queries_en: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["sentences", "overlays", "hook", "broll_schedule"]
      }
    }
  };

  const models = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
  let lastErr = null;
  for (const model of models) {
    let attempts = 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        console.log(`[gemini] Calling API using model: ${model} (Attempt ${attempt}/${attempts})...`);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API error: ${response.status} - ${errText}`);
        }

        const resultJson = await response.json();
        const textContent = resultJson.candidates[0].content.parts[0].text;
        return JSON.parse(textContent);
      } catch (err) {
        lastErr = err;
        console.log(`\n⚠  Gemini API call with ${model} failed (Attempt ${attempt}/${attempts}): ${err.message}`);
        if (attempt < attempts) {
          console.log(`Retrying in 4 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }
    }
  }
  throw lastErr;
}

// -------------------------------------------------------------
// 4. Dynamic HTML Composition Generator
// -------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function foldText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function toSeconds(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function fromMs(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / 1000 : fallback;
}

function normalizeWord(word) {
  if (typeof word === "string") return word;
  if (word && typeof word === "object") {
    return String(word.w ?? word.text ?? word.word ?? "");
  }
  return "";
}

function normalizeSentence(sentence, index) {
  const startTime = sentence.startTime ?? fromMs(sentence.start_ms, 0);
  const endTime = sentence.endTime ?? fromMs(sentence.end_ms, startTime + 0.8);
  const text = String(sentence.text ?? "");
  // Các từ trong sentence.text (dùng làm nguồn tách Case C)
  const textWords = text ? text.split(/\s+/).filter(Boolean) : [];

  let words = Array.isArray(sentence.words)
    ? sentence.words.map(normalizeWord).filter(Boolean)
        // Case B: Gemini trả token có space bên trong → split thành từng từ
        .flatMap(w => w.split(/\s+/).filter(Boolean))
        // Case C: token không có space nhưng là nhiều từ ghép → đối chiếu sentence.text
        // Root-cause bug cũ: dùng toLowerCase() → sai khi NFC vs NFD khác nhau
        //   và concat.length > w.length break sớm khi combining chars khác nhau
        // Fix: dùng foldText() — strip diacritics + normalize → so sánh base Latin
        // Ví dụ: "chấtxơ" → foldText="chatxo", textWords=["chất","xơ"]
        //   foldText("chất")+foldText("xơ")="chatxo" === "chatxo" → tách đúng
        .flatMap(w => {
          if (/\s/.test(w)) return [w];  // Case B đã xử lý
          if (!textWords.length) return [w];
          const wf = foldText(w);
          for (let start = 0; start < textWords.length; start++) {
            let cf = "";  // folded concat
            for (let end = start; end < textWords.length; end++) {
              cf += foldText(textWords[end]);
              if (cf === wf) {
                if (end > start) return textWords.slice(start, end + 1); // ≥2 từ → tách
                break; // 1 từ khớp đúng → giữ nguyên
              }
              if (cf.length > wf.length) break; // vượt → thử start tiếp theo
            }
          }
          return [w];
        })
    : [];

  if (!words.length && text) {
    words = text.split(/\s+/).filter(Boolean);
  }

  // ── Final safety: nếu số words < số textWords nhưng content khớp → dùng textWords
  // Catch-all cho mọi trường hợp join còn sót: "chấtxơ"+"hòa"+"tan" vs "chất"+"xơ"+"hòa"+"tan"
  if (words.length < textWords.length && textWords.length > 0) {
    const wordsFolded = words.map(foldText).join("");
    const textFolded  = textWords.map(foldText).join("");
    if (wordsFolded === textFolded) {
      // Content khớp hoàn toàn — Gemini join sai, dùng text-based split cho đúng
      words = [...textWords];
    }
  }

  // ── Mid-sentence capitalization fix ─────────────────────────────────────────
  // SRT đôi khi viết hoa giữa câu (vd: "Ra", "Cho", "Mà") — không phải danh từ riêng
  // → lowercase tất cả từ trừ từ đầu tiên của câu
  if (words.length > 1) {
    words = words.map((w, i) => {
      if (i === 0) return w; // giữ hoa đầu câu
      // Chỉ lowercase nếu chữ cái đầu là hoa VÀ phần còn lại là thường (pattern: "Ra", "Cho")
      // Không đụng đến ALL-CAPS (viết tắt) hoặc tên riêng nhiều chữ hoa
      if (/^[A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ][a-záàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ]+$/.test(w)) {
        return w.charAt(0).toLowerCase() + w.slice(1);
      }
      return w;
    });
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Validate style — default "normal" if missing or unrecognised
  const VALID_STYLES = ["normal", "peak"];
  const style = VALID_STYLES.includes(sentence.style) ? sentence.style : "normal";

  // peak_lines: Gemini-provided [{text, type}] — semantic chunks with visual type labels
  // types: "connector" | "regular" | "anchor" | "script" | "script_climax"
  const VALID_CHUNK_TYPES = new Set(["connector","regular","anchor","script","script_climax"]);
  let peakLines = null;
  if (style === "peak" && Array.isArray(sentence.peak_lines) && sentence.peak_lines.length >= 2) {
    const parsed = sentence.peak_lines
      .filter(item => item && typeof item === "object" && item.text)
      .map(item => ({
        text: String(item.text).trim(),
        type: VALID_CHUNK_TYPES.has(item.type) ? item.type : "regular"
      }))
      .filter(item => item.text);
    if (parsed.length >= 2) peakLines = parsed;
  }

  // ── FALLBACK: peak_lines thiếu (Gemini bỏ qua field) → auto-chunk từ textWords ────
  // Root cause: peak_lines không nằm trong `required` của JSON schema
  //   → Gemini 3.5 Flash omit field → peakLines = null → toàn bộ post-processing bỏ qua
  //   → cascade render bằng fallback path (flat layout, không có anchor)
  // Fix: nếu style='peak' nhưng peakLines vẫn null → tự sinh chunks từ textWords
  // Algorithm (scalable, không hardcode):
  //   - 2 words: [regular, sc]
  //   - 3 words: [connector, regular, sc]
  //   - 4+ words: last 2 = sc (bảo toàn compound ở cuối câu), còn lại chia đôi = connector + regular
  // Anchor guarantee ở bên dưới sẽ tự promote regular tốt nhất → anchor
  if (style === "peak" && !peakLines && textWords.length >= 2) {
    const n = textWords.length;
    if (n === 2) {
      peakLines = [
        { text: textWords[0], type: 'regular' },
        { text: textWords[1], type: 'script_climax' }
      ];
    } else if (n === 3) {
      peakLines = [
        { text: textWords[0], type: 'connector' },
        { text: textWords[1], type: 'regular' },
        { text: textWords[2], type: 'script_climax' }
      ];
    } else {
      // n >= 4: last 2 → sc, remaining → split at midpoint
      const sc = textWords.slice(n - 2).join(' ');
      const rem = textWords.slice(0, n - 2);
      if (rem.length <= 2) {
        peakLines = [
          { text: rem.join(' '), type: 'regular' },
          { text: sc, type: 'script_climax' }
        ];
      } else {
        const mid = Math.ceil(rem.length / 2);
        peakLines = [
          { text: rem.slice(0, mid).join(' '), type: 'connector' },
          { text: rem.slice(mid).join(' '), type: 'regular' },
          { text: sc, type: 'script_climax' }
        ];
      }
    }
    console.warn(`[peak-fallback] ⚠ peak_lines missing → auto-chunked (${n} words): [${peakLines.map(c => `"${c.text}"(${c.type})`).join(' | ')}]`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Fix Case C trong chunk text của peakLines — cùng logic foldText như sentence.words
  // "chấtxơ" trong chunk.text → "chất xơ" qua đối chiếu textWords
  // Đảm bảo: sum(chunk word count) === sentence.words.length → HTML spans = GSAP loop count
  if (peakLines && textWords.length > 0) {
    peakLines = peakLines.map(chunk => ({
      ...chunk,
      text: chunk.text.split(/\s+/).filter(Boolean)
        .flatMap(token => {
          const tf = foldText(token);
          for (let s = 0; s < textWords.length; s++) {
            let cf = "";
            for (let e = s; e < textWords.length; e++) {
              cf += foldText(textWords[e]);
              if (cf === tf) {
                if (e > s) return textWords.slice(s, e + 1); // joined → split
                break;
              }
              if (cf.length > tf.length) break;
            }
          }
          return [token]; // không khớp → giữ nguyên
        })
        .join(" ")
    }));

    // Merge chunks bị ngắt giữa chừng: regular/script chunk chỉ có 1 từ → merge vào chunk kế
    // VD: "thụ" (regular,1 word) + "thể vận" (regular) → "thụ thể vận" (regular)
    // Giữ nguyên: anchor (1 từ keyword OK), connector (1 từ glue word OK)
    const ALLOW_SINGLE = new Set(["anchor", "connector"]);
    const merged = [];
    for (let i = 0; i < peakLines.length; i++) {
      const chunk = peakLines[i];
      const wordCount = chunk.text.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < 2 && !ALLOW_SINGLE.has(chunk.type) && merged.length > 0) {
        // Merge vào chunk trước
        const prev = merged[merged.length - 1];
        prev.text = (prev.text + " " + chunk.text).trim();
        // Giữ type của chunk có priority cao hơn (script_climax > script > anchor > regular > connector)
        const priority = { script_climax: 5, script: 4, anchor: 3, regular: 2, connector: 1 };
        if ((priority[chunk.type] || 0) > (priority[prev.type] || 0)) prev.type = chunk.type;
      } else {
        merged.push({ ...chunk });
      }
    }
    if (merged.length >= 2) peakLines = merged;
  }

  // ── POST-PROCESS: script_climax validator — reads rules from LAYOUT.peak ────
  // Gemini là LLM, không đảm bảo tuân rules 100%.
  // Logic validator ở đây; rules cụ thể nằm trong LAYOUT.peak (configurable, không hardcode).
  if (peakLines) {
    // ── Step 0: Cross-chunk compound noun repair ─────────────────────────────
    // Phát hiện từ ghép bị cắt ngang ranh giới chunk (vd: "hiệu" | "ứng giả dược")
    // Pattern: nếu từ CUỐI chunk[i] là nửa đầu từ ghép → merge từ ĐẦU chunk[i+1] vào chunk[i]
    const { compoundPrefixPattern } = LAYOUT.peak;
    if (compoundPrefixPattern) {
      let i = 0;
      while (i < peakLines.length - 1) {
        const curr = peakLines[i];
        const next = peakLines[i + 1];
        const currWords = curr.text.trim().split(/\s+/).filter(Boolean);
        const nextWords = next.text.trim().split(/\s+/).filter(Boolean);
        const lastWord = currWords[currWords.length - 1];
        const firstWord = nextWords[0];
        // Guard: chỉ fix single-word chunk (=== 1) hoặc chunk 2-từ có lastWord là compound prefix (<= 2)
        // KHÔNG bỏ guard → cascade vô tận: "và mang" → merge "lại" → merge "hiệu" → merge "quả" → ...
        // foldText(lastWord): bắt buộc để tránh Unicode NFC/NFD mismatch — Gemini API có thể trả NFD
        // nhưng regex pattern trong source code là NFC → test raw sẽ không match!
        // Thêm guard: chỉ merge nếu next chunk còn >1 từ SAU khi bị lấy mất 1 từ,
        // OR nếu next chunk không phải script_climax — tránh làm trống script_climax
        const nextHasSurplus = nextWords.length > 1 || next.type !== 'script_climax';
        if (lastWord && firstWord && currWords.length <= 2 && nextHasSurplus && compoundPrefixPattern.test(foldText(lastWord))) {
          console.warn(`[peak-compound] ⚠ compound split: "${lastWord}|${firstWord}" → merging`);
          // Absorb firstWord of next into curr
          peakLines[i] = { ...curr, text: [...currWords, firstWord].join(' ') };
          if (nextWords.length > 1) {
            peakLines[i + 1] = { ...next, text: nextWords.slice(1).join(' ') };
          } else {
            // next chunk becomes empty → remove
            peakLines.splice(i + 1, 1);
          }
          // Don't advance i — re-check this chunk (cascading fix)
        } else {
          i++;
        }
      }
      // Remove any chunks that ended up empty
      peakLines = peakLines.filter(c => c.text.trim().length > 0);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { climaxBlockRules, maxClimaxPerSentence } = LAYOUT.peak;

    // ── Anchor word-count guard ───────────────────────────────────────────────
    // anchor = key concept word(s) — 1-3 từ. Nếu Gemini assign anchor cho phrase dài
    // → 116px × nhiều từ tràn màn hình. Demote về regular.
    peakLines = peakLines.map(chunk => {
      if (chunk.type !== 'anchor') return chunk;
      const wc = chunk.text.trim().split(/\s+/).filter(Boolean).length;
      if (wc > LAYOUT.peak.anchorMaxWords) {
        console.warn(`[peak-sanitize] ⚠ anchor → regular (${wc} words > anchorMaxWords=${LAYOUT.peak.anchorMaxWords}): "${chunk.text}"`);
        return { ...chunk, type: 'regular' };
      }
      // Anchor kết thúc bằng giới từ → không phải semantic unit độc lập
      if (LAYOUT.peak.anchorEndBlockPattern && LAYOUT.peak.anchorEndBlockPattern.test(chunk.text)) {
        console.warn(`[peak-sanitize] ⚠ anchor → regular (trailing preposition): "${chunk.text}"`);
        return { ...chunk, type: 'regular' };
      }
      // Anchor kết thúc bằng classifier/article ("các", "cái", "những"...) → demote về regular
      if (LAYOUT.peak.anchorTrailingClassifierPattern && LAYOUT.peak.anchorTrailingClassifierPattern.test(chunk.text)) {
        console.warn(`[peak-sanitize] ⚠ anchor → regular (trailing classifier): "${chunk.text}"`);
        return { ...chunk, type: 'regular' };
      }
      return chunk;
    });

    // ── Anchor verb-head split ────────────────────────────────────────────────
    // "giảm các triệu chứng" → anchor/regular sai vì bắt đầu bằng động từ
    // → split: verb đầu → connector mới, phần còn lại → regular (anchor guarantee quyết định sau)
    // Chạy trên CẢ anchor VÀ regular để bắt case demoted từ trailing-classifier
    if (LAYOUT.peak.anchorVerbHeadPattern) {
      const newLines = [];
      for (const chunk of peakLines) {
        if (chunk.type === 'anchor' || chunk.type === 'regular') {
          const words = chunk.text.trim().split(/\s+/).filter(Boolean);
          const match = chunk.text.match(LAYOUT.peak.anchorVerbHeadPattern);
          if (match && words.length >= 2) {
            const verbWord = match[0].trim();
            const rest = chunk.text.slice(match[0].length).trim();
            if (rest.length > 0) {
              console.warn(`[peak-sanitize] ⚡ verb-head split (${chunk.type}): "${verbWord}" → connector + "${rest}" → regular`);
              newLines.push({ text: verbWord, type: 'connector' });
              newLines.push({ text: rest, type: 'regular' }); // regular → anchor guarantee quyết định
              continue;
            }
          }
        }
        newLines.push(chunk);
      }
      peakLines = newLines;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Max chunks cap (TYB = 3-4 dòng) ─────────────────────────────────────
    // Nếu Gemini trả quá nhiều chunk → merge các connector/regular liền kề nhỏ nhất
    const maxChunks = LAYOUT.peak.maxChunks || 4;
    if (peakLines.length > maxChunks) {
      // Merge strategy: tìm cặp adjacent chunk cùng type (regular/connector) và merge
      while (peakLines.length > maxChunks) {
        let mergeIdx = -1;
        // Ưu tiên merge 2 connector hoặc 2 regular liền nhau
        for (let i = 0; i < peakLines.length - 1; i++) {
          const a = peakLines[i].type, b = peakLines[i + 1].type;
          if ((a === 'connector' && b === 'connector') ||
              (a === 'regular'   && b === 'regular')   ||
              (a === 'connector' && b === 'regular')    ||
              (a === 'regular'   && b === 'connector')) {
            mergeIdx = i; break;
          }
        }
        if (mergeIdx === -1) mergeIdx = 0; // fallback: merge first 2
        const merged = {
          text: peakLines[mergeIdx].text + ' ' + peakLines[mergeIdx + 1].text,
          type: peakLines[mergeIdx].type === 'regular' ? 'regular' : peakLines[mergeIdx + 1].type,
        };
        console.warn(`[peak-sanitize] ⚠ merge chunks (maxChunks): "${peakLines[mergeIdx].text}" + "${peakLines[mergeIdx+1].text}"`);
        peakLines = [...peakLines.slice(0, mergeIdx), merged, ...peakLines.slice(mergeIdx + 2)];
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    let climaxCount = 0;
    peakLines = peakLines.map(chunk => {
      if (chunk.type !== 'script_climax') return chunk;

      const lower = chunk.text.trim().toLowerCase();

      // Kiểm tra từng rule từ LAYOUT.peak.climaxBlockRules
      if (climaxBlockRules.some(rx => rx.test(lower))) {
        console.warn(`[peak-sanitize] ⚠ script_climax → regular: "${chunk.text}"`);
        return { ...chunk, type: 'regular' };
      }

      // Enforce max climax per sentence (từ LAYOUT.peak.maxClimaxPerSentence)
      climaxCount++;
      if (climaxCount > maxClimaxPerSentence) {
        console.warn(`[peak-sanitize] ⚠ script_climax → script (max exceeded): "${chunk.text}"`);
        return { ...chunk, type: 'script' };
      }

      return chunk;
    });

    // Nếu không còn script_climax → promote chunk "script" đầu tiên
    if (!peakLines.some(c => c.type === 'script_climax')) {
      const idx = peakLines.findIndex(c => c.type === 'script');
      if (idx !== -1) {
        console.warn(`[peak-sanitize] ↑ promote script → script_climax: "${peakLines[idx].text}"`);
        peakLines = peakLines.map((c, i) => i === idx ? { ...c, type: 'script_climax' } : c);
      }
    }

    // ── POST-OPT: Anchor guarantee ─────────────────────────────────────────────
    // TYB rule: mỗi cascade PHẢI có anchor (focal white bold). Nếu Gemini ko assign
    // → tự promote regular candidate tốt nhất → anchor.
    if (LAYOUT.peak.anchorPromoteEnabled && !peakLines.some(c => c.type === 'anchor')) {
      // Tập candidates: regular chunks, ≤ anchorMaxWords, có ít nhất 1 content word
      const candidates = peakLines
        .map((chunk, idx) => ({ chunk, idx }))
        .filter(({ chunk }) => chunk.type === 'regular')
        .filter(({ chunk }) => {
          const words = chunk.text.trim().split(/\s+/).filter(Boolean);
          if (words.length > LAYOUT.peak.anchorMaxWords) return false;
          // Phải có ít nhất 1 content word (không phải function word toàn bộ)
          return words.some(w => !PEAK_FUNCTION_WORDS.has(foldText(w)));
        })
        .sort((a, b) => {
          // Ưu tiên 1: từ ĐẦU chunk là content word (không phải function word)
          // "sức mạnh" (sức=content) > "của cơ bắp" (của=function) → anchor đúng nghĩa hơn
          const aFirstFold = foldText(a.chunk.text.trim().split(/\s+/).filter(Boolean)[0] || '');
          const bFirstFold = foldText(b.chunk.text.trim().split(/\s+/).filter(Boolean)[0] || '');
          const aFirstContent = !PEAK_FUNCTION_WORDS.has(aFirstFold);
          const bFirstContent = !PEAK_FUNCTION_WORDS.has(bFirstFold);
          if (aFirstContent !== bFirstContent) return aFirstContent ? -1 : 1;
          // Ưu tiên 2: chunk ở giữa (không phải đầu/cuối) → visual anchor at center
          const aMiddle = a.idx > 0 && a.idx < peakLines.length - 1;
          const bMiddle = b.idx > 0 && b.idx < peakLines.length - 1;
          if (aMiddle !== bMiddle) return aMiddle ? -1 : 1;
          // Ưu tiên 3: ít từ hơn → impact mạnh hơn ở kích thước 124px
          const aWc = a.chunk.text.trim().split(/\s+/).filter(Boolean).length;
          const bWc = b.chunk.text.trim().split(/\s+/).filter(Boolean).length;
          return aWc - bWc;
        });
      if (candidates.length > 0) {
        const { idx: bestIdx, chunk: bestChunk } = candidates[0];
        console.warn(`[peak-sanitize] ↑ promote regular → anchor (TYB guarantee): "${bestChunk.text}"`);
        peakLines = peakLines.map((c, i) => i === bestIdx ? { ...c, type: 'anchor' } : c);
      } else {
        // Không có regular candidate phù hợp (quá dài hoặc toàn function word)
        // → dùng script → anchor nếu có (TYB dứt khoát phải có anchor)
        const scriptIdx = peakLines.findIndex(c => c.type === 'script');
        if (scriptIdx !== -1) {
          const wc = peakLines[scriptIdx].text.trim().split(/\s+/).filter(Boolean).length;
          if (wc <= LAYOUT.peak.anchorMaxWords) {
            console.warn(`[peak-sanitize] ↑ promote script → anchor (TYB fallback): "${peakLines[scriptIdx].text}"`);
            peakLines = peakLines.map((c, i) => i === scriptIdx ? { ...c, type: 'anchor' } : c);
          }
        } else {
          // Last resort: split đầu script_climax → tách 1-2 từ đầu thành anchor
          // Case: cascade chỉ có connector + script_climax (không có regular/script)
          // Ví dụ: "và" + "mang lại hiệu quả cao nhất" → anchor="hiệu quả", sc="cao nhất"
          const scIdx = peakLines.findIndex(c => c.type === 'script_climax');
          if (scIdx !== -1) {
            const scWords = peakLines[scIdx].text.trim().split(/\s+/).filter(Boolean);
            // Tìm anchor words từ đầu script_climax (bỏ qua function words đầu)
            let anchorEnd = 0;
            for (let wi = 0; wi < Math.min(3, scWords.length - 1); wi++) {
              if (!PEAK_FUNCTION_WORDS.has(foldText(scWords[wi]))) {
                anchorEnd = wi + 1;
                // Lấy tối đa 2 từ content (đủ anchor, không overflow)
                if (anchorEnd >= 2) break;
              }
            }
            if (anchorEnd >= 1 && anchorEnd < scWords.length) {
              const anchorText = scWords.slice(0, anchorEnd).join(' ');
              const remainText = scWords.slice(anchorEnd).join(' ');
              const hasContent = anchorText.split(/\s+/).some(w => !PEAK_FUNCTION_WORDS.has(foldText(w)));
              if (hasContent && remainText.length > 0) {
                console.warn(`[peak-sanitize] ⚡ split script_climax head → anchor: "${anchorText}" | sc: "${remainText}"`);
                const anchorChunk = { text: anchorText, type: 'anchor' };
                const newSc = { ...peakLines[scIdx], text: remainText };
                peakLines = [
                  ...peakLines.slice(0, scIdx),
                  anchorChunk,
                  newSc,
                  ...peakLines.slice(scIdx + 1),
                ];
              }
            }
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Demote over-long regular chunks starting with function word → connector ──
    // Pattern: regular("của bạn mà nó còn dành cho") = 7 từ bắt đầu FW → cạnh tranh visual với anchor
    // FIX: đổi thành connector (28px dim) — không cạnh tranh, words vẫn covered (tránh safety-fallback)
    {
      peakLines = peakLines.map(chunk => {
        if (chunk.type !== 'regular') return chunk;
        const _rw = chunk.text.trim().split(/\s+/).filter(Boolean);
        if (_rw.length > 4 && PEAK_FUNCTION_WORDS.has(foldText(_rw[0]))) {
          console.warn(`[peak-sanitize] ↓ long FW-regular → connector: "${chunk.text}"`);
          return { ...chunk, type: 'connector' };
        }
        return chunk;
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Demote trailing possessive chunk → connector ───────────────────────────
    // Pattern: chunk CUỐI là regular chỉ gồm "của/cho + đại từ" → line thừa lơ lửng
    // FIX: đổi type thành connector (28px dim) thay vì DROP — giữ words trong peakLines
    //      để tránh HTML safety-fallback tạo ra orphan script-climax("của bạn").
    // Root cause of bug: nếu DROP → sentence.words vẫn có đủ từ → wPtr < canonWords.length
    //   → HTML gen tạo extra div với type = lastChunk.type = "script_climax" → bug!
    // Vd: anchor("cơ bắp") | connector("...") | sc("trí não") | regular("của bạn") → connector
    {
      const _tp = peakLines[peakLines.length - 1];
      if (_tp && _tp.type === 'regular') {
        const _tpw = _tp.text.trim();
        if (/^(của|cho)\s+(bạn|mình|tôi|tớ|họ|nó|ta|chúng\s+ta|mọi\s+người)\s*$/i.test(_tpw)
            && peakLines.length > 2) {
          console.warn(`[peak-sanitize] ↓ trailing possessive → connector (prevent orphan sc): "${_tpw}"`);
          peakLines = peakLines.map((c, i) => i === peakLines.length - 1 ? { ...c, type: 'connector' } : c);
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Paranoid cap sau tất cả transforms — đảm bảo không bao giờ > maxChunks ─
    // climaxBlockRules có thể thay đổi type nhưng không tăng count
    // Cap chạy lại ở đây để chắc chắn (render-time cũng có cap riêng)
    while (peakLines.length > maxChunks) {
      let _pmi = peakLines.findIndex((_, i) =>
        i < peakLines.length - 1 &&
        ['connector','regular'].includes(peakLines[i].type) &&
        ['connector','regular'].includes(peakLines[i + 1].type)
      );
      if (_pmi === -1) _pmi = peakLines.findIndex((_, i) =>
        i < peakLines.length - 1 &&
        (peakLines[i].type === 'connector' || peakLines[i + 1].type === 'connector')
      );
      if (_pmi === -1) _pmi = 0;
      const _pm = { text: peakLines[_pmi].text + ' ' + peakLines[_pmi + 1].text,
                    type: peakLines[_pmi].type === 'regular' ? 'regular' : peakLines[_pmi + 1].type };
      peakLines = [...peakLines.slice(0, _pmi), _pm, ...peakLines.slice(_pmi + 2)];
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  return {
    index: sentence.index ?? index,
    text,
    startTime: toSeconds(startTime, 0),
    endTime: Math.max(toSeconds(endTime, startTime + 0.8), toSeconds(startTime, 0) + 0.1),
    words,
    style,
    peakLines  // null for normal; [line1, line2, punchline] for peak
  };
}

function normalizeOverlayType(type, title, detail = "") {
  return classifyOverlayType(type, title, detail);
}

function normalizeOverlay(overlay, index) {
  const title = String(overlay.title ?? overlay.metric ?? "");
  const detail = String(overlay.detail ?? overlay.desc ?? overlay.description ?? "");
  const startTime = overlay.startTime ?? fromMs(overlay.start_ms, 0);
  const endTime = overlay.endTime ?? (
    overlay.duration_ms != null
      ? toSeconds(startTime, 0) + fromMs(overlay.duration_ms, 3.5)
      : toSeconds(startTime, 0) + 3.8
  );

  return {
    index,
    type: normalizeOverlayType(overlay.type ?? overlay.visual_type, title, detail),
    title,
    detail,
    startTime: toSeconds(startTime, 0),
    endTime: Math.max(toSeconds(endTime, 0), toSeconds(startTime, 0) + 0.8),
    visual_value:        Number(overlay.visual_value ?? 0),
    archetype:           overlay.archetype           || null,
    badgeLabel:          overlay.badgeLabel          || overlay.badge_label || null,
    semantic_intent:     overlay.semantic_intent     || null,
    semantic_visual_type:overlay.semantic_visual_type|| null,
    semantic_variant:    overlay.semantic_variant    || overlay.semanticVariant || null,
    metric_kind:         overlay.metric_kind         || null,
    metric_direction:    overlay.metric_direction    || null,
    lottie_query_en:     overlay.lottie_query_en     || null,
    lottie_path:         overlay.lottie_path         || null,
    list_group:          overlay.list_group           || null,
    list_index:          overlay.list_index           || null,
    list_total:          overlay.list_total           || null,
    list_style:          overlay.list_style           || null
  };
}

// Mức 1: translate Gemini's visual_params object into renderPattern params
function resolveVisualParams(vp, defaultColor) {
  const color   = vp.color === "warning" ? "#ff4b4b" : defaultColor;
  const pattern = String(vp.pattern || "NONE").toUpperCase();
  const count   = (typeof vp.count === "number" && vp.count > 0) ? Math.round(vp.count) : null;
  const mag     = typeof vp.magnitude === "number" ? Math.max(0.05, Math.min(1, vp.magnitude)) : null;
  const dir     = String(vp.direction || "LTR").toUpperCase();

  switch (pattern) {
    case "FLOW":
      return { overridePattern: "FLOW",        direction: dir === "RTL" ? "RTL" : "LTR", particleCount: count ?? 3, hasGate: vp.has_barrier ?? false, subjectColor: color };
    case "FILL":
      return { overridePattern: "FILL",        magnitude: mag ?? 0.85,  hasConfirm: true,  particleCount: count ?? 3, subjectColor: color };
    case "PULSE":
      return { overridePattern: "PULSE",       repeatCount: count ?? 2, hasConfirm: false,                            subjectColor: color };
    case "WAVE":
      return { overridePattern: "WAVE",        barCount: count ?? 7,    amplitude: mag ?? 0.8,                        subjectColor: color };
    case "GAUGE":
      return { overridePattern: "GAUGE",       level: mag ?? 0.72,                                                    subjectColor: color };
    case "STACK":
      return { overridePattern: "STACK",       rowCount: count ?? 3,                                                  subjectColor: color };
    case "NETWORK":
      return { overridePattern: "NETWORK",     nodeCount: count ?? 4,                                                 subjectColor: color };
    case "CLOCK_ARC":
      return { overridePattern: "CLOCK_ARC",   sweepFraction: mag ?? 0.75,                                            subjectColor: color };
    case "STEPS":
      return { overridePattern: "STEPS",       stepCount: count ?? 3,                                                 subjectColor: color };
    case "BARRIER":
      return { overridePattern: "BARRIER",     opens: vp.opens !== false, particleCount: count ?? 3,                  subjectColor: color };
    case "SCALE":
      return { overridePattern: "SCALE",       tiltDirection: dir === "RTL" ? "right" : dir === "LTR" ? "left" : "right", subjectColor: color };
    case "ARROW":
      return { overridePattern: "ARROW",       direction: dir === "RTL" ? "left" : dir === "UP" ? "up" : dir === "DOWN" ? "down" : "right", subjectColor: color };
    case "STREAM":
      return { overridePattern: "STREAM",      particleCount: count ?? 5,                                             subjectColor: color };
    case "PULSE_SPIKE":
      return { overridePattern: "PULSE_SPIKE", spikeCount: count ?? 2,                                                subjectColor: color };
    case "PROGRESS":
      return { overridePattern: "PROGRESS",    steps: count ?? 6, variant: "range",                                   subjectColor: color };
    case "ALERT":
      return { overridePattern: "ALERT",       dotCount: count ?? 3, ringCount: 2,                                    subjectColor: "#ff4b4b" };
    case "COMPARE":
      return { overridePattern: "COMPARE", subjectColor: color };
    case "NONE":
    default:
      return { overridePattern: "NONE", subjectColor: color };
  }
}

function paramsForCard(card) {
  const isWarning    = card.type === "WARNING";
  const defaultColor = isWarning ? "#ff4b4b" : "#a6ff3d";

  // Smart override: STAT cards with giờ/phút/giây unit → force CLOCK_ARC
  // Gemini thường chọn PROGRESS/STEPS sai cho time duration — override luôn
  if (card.type === "STAT") {
    const descriptor = parseOverlayTitle(card.title || "");
    if (descriptor && descriptor.unit) {
      const sym = (descriptor.unit.symbol || "").toLowerCase().trim();
      if (sym === "phút" || sym === "giờ" || sym === "giây") {
        const rawVal = descriptor.kind === "range_value"
          ? ((descriptor.valueFrom || 0) + (descriptor.valueTo || descriptor.valueFrom || 0)) / 2
          : (descriptor.valueFrom || 0);
        // Normalize to fraction of 60 min (cap 1.0, floor 0.08)
        const minutes = sym === "giờ" ? rawVal * 60 : sym === "giây" ? rawVal / 60 : rawVal;
        const sweepFraction = Math.min(1.0, Math.max(0.08, minutes / 60));
        // suppressImage: CLOCK_ARC is already the visual — no need for Pexels image alongside
        return { overridePattern: "CLOCK_ARC", sweepFraction, subjectColor: defaultColor, suppressImage: true };
      }
    }
  }

  // Mức 1 — Gemini fills visual_params object (primary path)
  if (card.visual_params && card.visual_params.pattern) {
    return resolveVisualParams(card.visual_params, defaultColor);
  }

  // Fallback — archetype-based pattern (no visual_params from Gemini)
  const variant = String(card.semantic_variant || "");
  const pattern = String(card.pattern || "");
  switch (pattern) {
    case "FLOW":        return { particleCount: 3, direction: "LTR",     subjectColor: defaultColor };
    case "FILL":        return { magnitude: 0.85,  hasConfirm: true, particleCount: 3, subjectColor: defaultColor };
    case "PULSE":       return { repeatCount: 2,   hasConfirm: false,    subjectColor: defaultColor };
    case "PROGRESS":    return { steps: variant === "minimum_time" ? 4 : 6, variant: variant || "range", subjectColor: defaultColor };
    case "ALERT":       return { dotCount: 3, ringCount: 2,               subjectColor: "#ff4b4b" };
    case "WAVE":        return { barCount: 7, amplitude: 0.8,             subjectColor: defaultColor };
    case "GAUGE":       return { level: 0.72,                             subjectColor: defaultColor };
    case "STACK":       return { rowCount: 3,                             subjectColor: defaultColor };
    case "NETWORK":     return { nodeCount: 4,                            subjectColor: defaultColor };
    case "CLOCK_ARC":   return { sweepFraction: 0.75,                     subjectColor: defaultColor };
    case "STEPS":       return { stepCount: 3,                            subjectColor: defaultColor };
    case "BARRIER":     return { opens: true, particleCount: 3,           subjectColor: defaultColor };
    case "SCALE":       return { tiltDirection: "right",                  subjectColor: defaultColor };
    case "ARROW":       return { direction: "right",                      subjectColor: defaultColor };
    case "STREAM":      return { particleCount: 5,                        subjectColor: defaultColor };
    case "PULSE_SPIKE": return { spikeCount: 2,                           subjectColor: defaultColor };
    default:            return { subjectColor: defaultColor };
  }
}

function semanticSceneHtml(card, index) {
  const sceneId = `semantic-scene-${index}`;

  // visual_params (Gemini Mức 1) → overridePattern, or archetype → pattern fallback
  const params          = paramsForCard(card);
  const effectivePattern = params.overridePattern || String(card.pattern || "");
  if (effectivePattern === "NONE") return "";
  if (effectivePattern) {
    const result = renderPattern(effectivePattern, params, sceneId,
      toSeconds(card.startTime, 0),
      toSeconds(card.endTime, toSeconds(card.startTime, 0) + 3.5)
    );
    if (result.html) return result.html;
  }

  // Legacy path: PROGRESS, ALERT, and old visual types without archetype
  const visualType = String(card.semantic_visual_type || "");
  if (!visualType || visualType === "action_card") return "";
  const semanticVariant = String(card.semantic_variant || "").replace(/[^a-z0-9_-]/gi, "");
  const variant = `variant-${index % 3}${semanticVariant ? ` semantic-${semanticVariant}` : ""}`;

  if (visualType === "timeline_progression") {
    return `
      <div class="semantic-scene scene-timeline ${variant}" id="${sceneId}" aria-hidden="true">
        <div class="scene-rail"><span class="scene-rail-fill"></span><span class="scene-rail-node"></span></div>
        <div class="scene-footsteps">
          <span class="scene-foot foot-1"></span>
          <span class="scene-foot foot-2"></span>
          <span class="scene-foot foot-3"></span>
          <span class="scene-foot foot-4"></span>
          <span class="scene-foot foot-5"></span>
          <span class="scene-foot foot-6"></span>
          <span class="scene-foot foot-7"></span>
          <span class="scene-foot foot-8"></span>
        </div>
      </div>`;
  }

  if (visualType === "movement_guidance") {
    return `
      <div class="semantic-scene scene-movement ${variant}" id="${sceneId}" aria-hidden="true">
        <div class="pace-line"></div>
        <span class="pace-foot p1"></span>
        <span class="pace-foot p2"></span>
        <span class="pace-foot p3"></span>
        <span class="pace-foot p4"></span>
      </div>`;
  }

  if (visualType === "animated_metric_counter" || visualType === "static_metric_range") {
    return "";
  }

  return "";
}

// Dùng chung cho tất cả chỗ render ảnh — đổi filter ở PEXELS.imageFilter là đổi toàn bộ
function buildImageStyle(entry, extraStyle = '') {
  const base = `max-width:100%;max-height:100%;object-fit:contain;${extraStyle}`;
  // 'transparent' = ảnh đã được Remove.bg xóa nền → render trực tiếp, không cần blend
  if (!entry.blend_mode || entry.blend_mode === 'transparent') return base;
  return base + (PEXELS.imageFilter[entry.blend_mode] || '');
}

function visualImgHtml(card, index) {
  if (!card.image_key) return "";
  const entry = assetMap.get(card.image_key);
  if (!entry) return "";
  const imgId = `visual-img-${index}`;
  const src   = entry.path.replace(/\\/g, '/');
  return `\n    <div class="visual-img-wrap" id="${imgId}" aria-hidden="true"><img src="${src}" style="${buildImageStyle(entry)}" alt=""></div>`;
}

function semanticLayerHtml(overlays) {
  return overlays.map((card, index) => semanticSceneHtml(card, index) + visualImgHtml(card, index)).join("");
}

function buildOpeningHook(sentences, overlays, geminiHook) {
  if (geminiHook && geminiHook.kicker && geminiHook.title && geminiHook.punch) {
    return {
      kicker: String(geminiHook.kicker).toUpperCase(),
      title:  String(geminiHook.title).toUpperCase(),
      punch:  String(geminiHook.punch).toUpperCase()
    };
  }
  return {
    kicker: "SỨC KHỎE",
    title:  "MỘT THÓI QUEN NHỎ",
    punch:  "CÓ THỂ ĐỔI KẾT QUẢ"
  };
}

function semanticLayerGSAP(sceneId, card, startTime, endTime) {
  // visual_params (Gemini Mức 1) → overridePattern, or archetype → pattern fallback
  const params           = paramsForCard(card);
  const effectivePattern = params.overridePattern || String(card.pattern || "");
  if (effectivePattern === "NONE") return "";
  if (effectivePattern) {
    const result = renderPattern(effectivePattern, params, sceneId, Number(startTime), Number(endTime));
    if (result.gsapCode) return result.gsapCode;
  }

  // Legacy path: PROGRESS, ALERT, and old visual types without archetype
  const visualType = String(card.semantic_visual_type || "");
  if (!visualType || visualType === "action_card") return "";
  const start = Number(startTime);
  const end = Number(endTime);
  const outro = Math.max(start + 0.7, end - 0.42);
  const semanticVariant = String(card.semantic_variant || "");

  let code = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});`;

  if (visualType === "timeline_progression") {
    const railX = semanticVariant === "minimum_time" ? 285
                : semanticVariant === "optimal_time" ? 500
                : 390;
    code += `
      fromToIfPresent("#${sceneId} .scene-rail-fill", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 1.45, ease: "power2.out" }, ${(start + 0.16).toFixed(3)});
      fromToIfPresent("#${sceneId} .scene-rail-node", { x: 0 }, { x: ${railX}, duration: 1.45, ease: "power2.out" }, ${(start + 0.16).toFixed(3)});
      fromToIfPresent("#${sceneId} .scene-foot", { y: 18, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.15, duration: 0.42, ease: "back.out(1.6)" }, ${(start + 0.32).toFixed(3)});`;
  } else if (visualType === "movement_guidance") {
    code += `
      fromToIfPresent("#${sceneId} .pace-foot", { x: -32, y: 18, opacity: 0 }, { x: 0, y: 0, opacity: 1, stagger: 0.14, duration: 0.44, ease: "back.out(1.6)" }, ${(start + 0.2).toFixed(3)});
      fromToIfPresent("#${sceneId} .pace-line", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.9, ease: "power2.out" }, ${(start + 0.18).toFixed(3)});`;
  } else if (visualType === "animated_metric_counter" || visualType === "static_metric_range") {
    code += `
      fromToIfPresent("#${sceneId} .metric-halo", { scale: 0.8, opacity: 0.16 }, { scale: 1.12, opacity: 0.62, duration: 0.9, ease: "power2.out" }, ${(start + 0.12).toFixed(3)});
      fromToIfPresent("#${sceneId} .metric-scan", { y: -70, opacity: 0.25 }, { y: 80, opacity: 0.72, duration: 1.0, ease: "power2.inOut" }, ${(start + 0.22).toFixed(3)});`;
  }

  return code;
}

function generateLegacyHTML(sentences, overlays, totalDuration) {
  // Generate the DOM for cards
  let cardsHtml = "";
  for (let i = 0; i < overlays.length; i++) {
    const card = overlays[i];
    const cardId = `card-${i}`;
    if (card.type === "STAT") {
      // Parse số từ title để animate counter
      const rawNum = card.title;
      cardsHtml += `
        <!-- Card ${i} (STAT) -->
        <div class="card-stat" id="${cardId}" data-stat-value="${rawNum}">
          <div class="stat-neon-bar"></div>
          <div class="stat-content">
            <div class="stat-number" id="stat-num-${i}">${rawNum}</div>
            <div class="stat-divider"></div>
            <div class="stat-label">${card.detail}</div>
          </div>
        </div>`;
    } else {
      const badgeText = card.semantic_variant === "insulin_sensitivity"
        ? "CẢI THIỆN"
        : card.type === "WARNING" ? "CẢNH BÁO" : "HÀNH ĐỘNG";
      const badgeClass = card.type === "WARNING" ? "warning-badge" : "success-badge";
      cardsHtml += `
        <!-- Card ${i} (${card.type}) -->
        <div class="card" id="${cardId}">
          <div class="card-header">
            <span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>
            <span class="card-title">${card.title}</span>
          </div>
          <div class="card-body">
            ${card.detail}
          </div>
        </div>`;
    }
  }

  // Generate the DOM for sentences and words
  let subtitlesHtml = "";
  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    const sentence = sentences[sIdx];
    const sId = `sentence-${sIdx}`;
    let wordsHtml = "";
    for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
      const wId = `s${sIdx}-w${wIdx}`;
      wordsHtml += `\n          <span class="word" id="${wId}">${sentence.words[wIdx]}</span>`;
    }
    subtitlesHtml += `
        <!-- Sentence ${sIdx} (${sentence.startTime}s - ${sentence.endTime}s) -->
        <div class="sentence" id="${sId}">${wordsHtml}
        </div>`;
  }

  // Generate the GSAP JS code
  let gsapCode = `
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      // ==========================================
      // 1. CARDS TRANSITIONS
      // ==========================================`;

  for (let i = 0; i < overlays.length; i++) {
    const card = overlays[i];
    const cardId = `card-${i}`;
    const slideInTime = card.startTime;
    const fadeOutTime = Math.max(card.startTime + 0.5, card.endTime - 0.5);
    gsapCode += `
      // Card ${i} active: ${card.startTime}s to ${card.endTime}s
      tl.to("#${cardId}", { left: 40, opacity: 1, duration: 0.5, ease: "power3.out" }, ${slideInTime});
      tl.to("#${cardId}", { opacity: 0, duration: 0.5, ease: "power2.in" }, ${fadeOutTime});`;
  }

  gsapCode += `

      // ==========================================
      // 2. SUBTITLE SENTENCE FADE IN/OUT
      // ==========================================`;

  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    const sentence = sentences[sIdx];
    const sId = `sentence-${sIdx}`;
    gsapCode += `
      // Sentence ${sIdx} (${sentence.startTime}s - ${sentence.endTime}s)
      tl.to("#${sId}", { opacity: 1, duration: 0.1 }, ${sentence.startTime});
      tl.to("#${sId}", { opacity: 0, duration: 0.15 }, ${sentence.endTime});`;
  }

  gsapCode += `

      // ==========================================
      // 3. WORD-LEVEL KARAOKE TIMINGS
      // ==========================================
      const activeStyle = {
        color: "#a6ff3d",
        opacity: 1,
        scale: 1.15,
        textShadow: "0 0 20px rgba(154, 201, 59, 0.8), 0 6px 12px rgba(0, 0, 0, 0.9)",
        duration: 0.12,
        ease: "back.out(1.7)"
      };

      const inactiveStyle = {
        color: "#ffffff",
        opacity: 0.35,
        scale: 1.0,
        textShadow: "0 6px 12px rgba(0, 0, 0, 0.9), 0 0 10px rgba(0, 0, 0, 0.6)",
        duration: 0.12,
        ease: "power2.out"
      };`;

  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    const sentence = sentences[sIdx];
    const sDuration = sentence.endTime - sentence.startTime;
    const wordCount = Math.max(1, sentence.words.length);
    const wordDuration = sDuration / wordCount;

    gsapCode += `\n\n      // Sentence ${sIdx} word karaoke`;
    for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
      const wId = `s${sIdx}-w${wIdx}`;
      const wStart = (sentence.startTime + wIdx * wordDuration).toFixed(3);
      const wEnd = (sentence.startTime + (wIdx + 1) * wordDuration).toFixed(3);
      gsapCode += `
      tl.to("#${wId}", activeStyle, ${wStart});
      tl.to("#${wId}", inactiveStyle, ${wEnd});`;
    }
  }

  gsapCode += `

      // Register timeline
      window.__timelines["elegant-maxwell"] = tl;

      // ==========================================
      // 4. STAT COUNTER ANIMATION (odometer style)
      // ==========================================
      document.querySelectorAll('.card-stat').forEach(function(card) {
        const numEl = card.querySelector('.stat-number');
        if (!numEl) return;
        const raw = card.dataset.statValue || numEl.textContent.trim();
        // Extract numeric part
        const match = raw.match(/([0-9][0-9.,\-]*)/);
        if (!match) return;
        const numStr = match[1];
        const prefix = raw.substring(0, raw.indexOf(numStr));
        const suffix = raw.substring(raw.indexOf(numStr) + numStr.length);
        const endVal = parseFloat(numStr.replace(/[.,]/g, '').replace('-', ''));
        if (isNaN(endVal) || endVal <= 0) return;

        // Find when this card appears on timeline
        const cardId = card.id;
        const cardIdx = parseInt(cardId.replace('card-', ''));
        // Animate counter when card slides in
        tl.to(numEl, {
          duration: 1.2,
          ease: "power2.out",
          onUpdate: function() {
            const progress = this.progress();
            const current = Math.round(endVal * progress);
            numEl.textContent = prefix + current.toLocaleString('vi-VN') + suffix;
          }
        }, "+=0");
      });
  `;

  // Embed hero font as base64 data URI — guaranteed load in Puppeteer file:// context
  const _heroFontPath = path.resolve('assets/fonts/DVN-Grandy-gehcaa.ttf');
  const _heroFontB64  = fs.existsSync(_heroFontPath)
    ? fs.readFileSync(_heroFontPath).toString('base64')
    : '';
  const _heroFontSrc  = _heroFontB64
    ? `url('data:font/truetype;base64,${_heroFontB64}') format('truetype')`
    : `url('assets/fonts/DVN-Grandy-gehcaa.ttf') format('truetype')`;

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>CNFI Premium TikTok Composition</title>
    
    <!-- Local fonts -->
    <style>
      @font-face {
        font-family: 'Be Vietnam Pro';
        src: url('assets/fonts/be-vietnam-pro-800.ttf') format('truetype');
        font-weight: 800;
      }
      @font-face {
        font-family: 'Be Vietnam Pro';
        src: url('assets/fonts/be-vietnam-pro-900.ttf') format('truetype');
        font-weight: 900;
      }
    </style>
    
    <!-- Hero font — ${LAYOUT.subtitle.peakScriptClimaxFont}: embedded as base64, guaranteed load -->
    <style>
      @font-face {
        font-family: '${LAYOUT.subtitle.peakScriptClimaxFont}';
        src: ${_heroFontSrc};
        font-weight: normal;
        font-style: normal;
      }
    </style>

    <!-- Load GSAP -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.2/dist/gsap.min.js"></script>

    <style>
      :root {
        --cnfi-accent:     ${LAYOUT.colors.accent};
        --cnfi-accent-rgb: ${LAYOUT.colors.accentRgb};
        --cnfi-warning:    ${LAYOUT.colors.warning};
        --cnfi-yellow:     ${LAYOUT.colors.yellow};
        --cnfi-bg:         ${LAYOUT.colors.darkBg};
        --cnfi-stat-bg:    ${LAYOUT.colors.statBg};
      }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      html,
      body {
        margin: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: transparent; /* Transparent for overlay compositing */
        font-family: 'Be Vietnam Pro', sans-serif;
        font-weight: 800;
        -webkit-font-smoothing: antialiased;
      }

      #root {
        position: relative;
        width: 1080px;
        height: 1920px;
        background: transparent;
        overflow: hidden;
      }

      /* ── Cinematic vignette overlay — baked into PNG frames, composited onto video ── */
      #vignette-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: ${LAYOUT.canvas.w}px;
        height: ${LAYOUT.canvas.h}px;
        pointer-events: none;
        z-index: 1;
        display: ${LAYOUT.cinematic.vignette.enabled ? 'block' : 'none'};
        background: radial-gradient(
          ellipse ${LAYOUT.cinematic.vignette.ellipseX}% ${LAYOUT.cinematic.vignette.ellipseY}% at ${LAYOUT.cinematic.vignette.centerX}% ${LAYOUT.cinematic.vignette.centerY}%,
          transparent ${LAYOUT.cinematic.vignette.clearAt}%,
          rgba(0,0,0,${(LAYOUT.cinematic.vignette.opacity * 0.42).toFixed(2)}) ${LAYOUT.cinematic.vignette.fadeAt}%,
          rgba(0,0,0,${LAYOUT.cinematic.vignette.opacity.toFixed(2)}) 100%
        );
      }

      /* ── Bottom cinematic gradient — tăng depth ở 1/4 dưới video ── */
      #bottom-grad {
        position: absolute;
        bottom: 0;
        left: 0;
        width: ${LAYOUT.canvas.w}px;
        height: ${Math.round(LAYOUT.canvas.h * LAYOUT.cinematic.bottomGrad.heightPct / 100)}px;
        pointer-events: none;
        z-index: 1;
        display: ${LAYOUT.cinematic.bottomGrad.enabled ? 'block' : 'none'};
        background: linear-gradient(
          to top,
          rgba(0,0,0,${LAYOUT.cinematic.bottomGrad.opacity.toFixed(2)}) 0%,
          rgba(0,0,0,${LAYOUT.cinematic.bottomGrad.midOpacity.toFixed(2)}) 50%,
          transparent 100%
        );
      }

      .card-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 1080px;
        height: 1920px;
        pointer-events: none;
      }

      /* STAT card — premium neon counter */
      .card-stat {
        position: absolute;
        top: ${LAYOUT.card.defaultTop}px;
        left: ${LAYOUT.card.offscreenLeft}px;
        width: ${LAYOUT.card.statWidth}px;
        border-radius: 0 12px 12px 0;
        background: rgba(5,5,5,0.92);
        padding: 28px 32px 28px 40px;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        opacity: 0;
        box-sizing: border-box;
        overflow: hidden;
      }
      /* Thanh dọc neon bên trái */
      .stat-neon-bar {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 6px;
        background: #a6ff3d;
        box-shadow: 0 0 12px #a6ff3d, 0 0 24px rgba(166,255,61,0.6), 0 0 40px rgba(166,255,61,0.3);
        border-radius: 0 3px 3px 0;
        z-index: 10;
      }
      .stat-content {
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .stat-number {
        font-size: 88px;
        font-weight: 900;
        color: #ffffff;
        line-height: 1;
        letter-spacing: -3px;
        margin-bottom: 10px;
        font-variant-numeric: tabular-nums;
      }
      .stat-divider {
        width: 80px;
        height: 3px;
        background: #a6ff3d;
        box-shadow: 0 0 8px rgba(166,255,61,0.8);
        margin-bottom: 12px;
        border-radius: 2px;
      }
      .stat-label {
        font-size: 24px;
        font-weight: 500;
        color: rgba(255,255,255,0.85);
        text-transform: none;
        letter-spacing: 0.3px;
        line-height: 1.3;
        white-space: nowrap;
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 12px;
      }

      .badge {
        font-size: 18px;
        font-weight: 900;
        padding: 6px 20px;
        border-radius: 16px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .warning-badge {
        background: #ff4444;
        color: #ffffff;
      }

      .success-badge {
        background: #a6ff3d;
        color: #0a0a0a;
      }

      .card-title {
        font-size: ${LAYOUT.card.titleFontSize}px;
        font-weight: 900;
        color: #f5c518;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .card-body {
        font-size: ${LAYOUT.card.bodyFontSize}px;
        font-weight: 700;
        color: #ffffff;
        line-height: 1.4;
        letter-spacing: -0.5px;
        text-transform: none;
      }

      .subtitle-container {
        position: absolute;
        top: ${LAYOUT.subtitle.top}px;
        left: ${LAYOUT.subtitle.left}px;
        width: ${LAYOUT.subtitle.width}px;
        height: ${LAYOUT.subtitle.height}px;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        pointer-events: none;
      }

      .sentence {
        position: absolute;
        width: auto;
        max-width: 960px;
        display: inline-flex;
        flex-wrap: nowrap;
        justify-content: center;
        align-items: center;
        gap: 0 10px;
        opacity: 0;
        background: rgba(0,0,0,0.72);
        border-radius: 12px;
        padding: 10px 20px;
        left: 50%;
        transform: translateX(-50%);
        overflow: visible;
      }

      /* ── MODE: NORMAL (default) ──────────────────────────────────
         Pill background, karaoke highlight, 34px                    */
      .word {
        display: inline-block;
        font-size: ${LAYOUT.subtitle.normalFontSize}px;
        font-weight: 800;
        color: rgba(255,255,255,0.5);
        opacity: 1;
        transform: scale(1);
        margin: 2px 6px;
        text-transform: none;   /* chữ thường — TYB style */
        letter-spacing: -0.5px;
        text-shadow: 0 2px 8px rgba(0,0,0,0.8);
        white-space: nowrap;
        will-change: transform, color;
      }

      /* ── MODE: PEAK — TYB chunk-based cascade ───────────────────── */
      .sentence-peak {
        background: none;
        border-radius: 0;
        padding: 2px 0;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
        flex-wrap: nowrap;
        max-width: ${LAYOUT.subtitle.width}px;
      }
      /* Chunk container — indent set via inline style (lineIdx × peakIndentStep) */
      .peak-chunk {
        display: flex;
        flex-wrap: nowrap;
        justify-content: flex-start;
        align-items: flex-start;
        gap: 0 6px;
        line-height: 0.9;
      }
      /* connector — L3 Context: "về","của","như" — tiny, dim */
      .peak-chunk-connector .word {
        font-size: ${LAYOUT.subtitle.peakConnectorSize}px;
        font-weight: 600;
        color: rgba(255,255,255,0.50);
        letter-spacing: 0;
        text-shadow: 0 2px 8px rgba(0,0,0,0.9);
      }
      /* regular — L3 Context: supporting context, reads first */
      .peak-chunk-regular .word {
        font-size: ${LAYOUT.subtitle.peakRegularSize}px;
        font-weight: 700;
        color: rgba(255,255,255,0.82);
        letter-spacing: -0.2px;
        text-shadow: 0 2px 10px rgba(0,0,0,0.95), 0 4px 18px rgba(0,0,0,0.70);
      }
      /* anchor — L2 Support: main concept, ExtraBold white */
      .peak-chunk-anchor .word {
        font-size: ${LAYOUT.subtitle.peakAnchorSize}px;
        font-weight: 900;
        color: rgba(255,255,255,1.0);
        letter-spacing: -0.5px;
        text-shadow: 0 2px 14px rgba(0,0,0,0.98), 0 5px 24px rgba(0,0,0,0.80);
      }
      /* script — L2 Support: emotional phrase, ExtraBold white */
      .peak-chunk-script .word {
        font-family: 'Be Vietnam Pro', sans-serif;
        font-size: ${LAYOUT.subtitle.peakScriptSize}px;
        font-weight: 800;
        font-style: normal;
        color: rgba(255,255,255,1.0);
        letter-spacing: -0.4px;
        text-shadow: 0 2px 14px rgba(0,0,0,0.98), 0 5px 24px rgba(0,0,0,0.80);
      }
      /* script_climax — L1 HERO: ${LAYOUT.subtitle.peakScriptClimaxFont} — dominates composition */
      /* margin-top âm: cursive/script fonts có em-box tự nhiên lớn (ascender cao)
         → tạo khoảng trống "chết" phía trên visible text → kéo chunk này gần với chunk trên */
      .peak-chunk-script-climax {
        margin-top: ${LAYOUT.subtitle.peakScriptClimaxTopOffset}px;
      }
      .peak-chunk-script-climax .word,
      .peak-chunk-script-climax .word-peak-key {
        font-family: '${LAYOUT.subtitle.peakScriptClimaxFont}', cursive;
        font-size: ${LAYOUT.subtitle.peakScriptClimaxSize}px;
        font-weight: normal;
        font-style: normal;
        line-height: ${LAYOUT.subtitle.peakScriptClimaxLineHeight}; /* override inherited 0.9 — cursive font cần tighter để giảm em-box height */
        color: #C4F040;
        -webkit-text-stroke: 1.5px #C4F040;
        letter-spacing: 0.04em;
        margin-right: 0.28em;
        text-shadow:
          0 0 20px rgba(196,240,64,0.90),
          0 0 40px rgba(196,240,64,0.55),
          0 3px 14px rgba(0,0,0,0.98),
          0 6px 26px rgba(0,0,0,0.80);
      }
    </style>
  </head>
  <body>
    <!-- Font preload: force browser to fetch hero font even when all sentences are visibility:hidden -->
    <div style="position:absolute;opacity:0;pointer-events:none;font-family:'${LAYOUT.subtitle.peakScriptClimaxFont}';font-size:90px;top:-9999px;left:-9999px;" aria-hidden="true">preload</div>
    <div
      id="root"
      data-composition-id="elegant-maxwell"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="1080"
      data-height="1920"
    >
      
      <!-- Cinematic vignette — darkens edges, composited onto video -->
      <div id="vignette-overlay"></div>

      <!-- Bottom cinematic gradient — depth & drama ở 1/4 dưới -->
      <div id="bottom-grad"></div>

      <!-- Brand watermark — top-left corner (HTML/CSS, no image dependency) -->
      <div style="
        position: absolute;
        top: 44px;
        left: 40px;
        z-index: 99;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
        background: rgba(0,0,0,0.32);
        padding: 10px 16px 12px 14px;
        border-radius: 6px;
        backdrop-filter: blur(2px);
      ">
        <div style="
          font-family: 'Be Vietnam Pro', sans-serif;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.16em;
          color: #9AC33B;
          white-space: nowrap;
          line-height: 1;
          margin-bottom: 3px;
        ">CONDITIONING &amp; NUTRITION FATLOSS</div>
        <div style="
          font-family: 'Be Vietnam Pro', sans-serif;
          font-size: 52px;
          font-weight: 900;
          color: #ffffff;
          letter-spacing: -0.02em;
          line-height: 0.88;
          text-shadow: 0 2px 8px rgba(0,0,0,0.5);
        ">CNFI</div>
        <div style="
          width: 100%;
          height: 3px;
          background: #9AC33B;
          margin-top: 6px;
          border-radius: 1px;
        "></div>
      </div>

      <!-- Overlay Cards -->
      <div class="card-container">
        ${cardsHtml}
      </div>

      <!-- Subtitles Karaoke -->
      <div class="subtitle-container">
        ${subtitlesHtml}
      </div>

    </div>

    <!-- GSAP Script Registration -->
    <script>
      ${gsapCode}
    </script>
  </body>
</html>`;
}

// -------------------------------------------------------------
// 4B. Premium Metric Counter Generator
// -------------------------------------------------------------
// ── Card text sanitizer: runs after Gemini, before render ──────────
// Chỉ remove tiếng ồn rõ ràng — không touch từ tiếng Việt hợp lệ
const SPEECH_NOISE = /(?<!\S)(uh|um|uhm|erm|hmm)(?!\S)/gi;
const BAD_PHRASE   = /(bạn đang nghĩ|chắc chắn thì|thì bạn đang|thì chắc chắn|đó là$|nha$)/i;
const BAD_ENDING   = /(thì|và của|cho để)\s*$/i;

function sanitizeText(text) {
  return String(text || '')
    .replace(SPEECH_NOISE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isValidText(text) {
  if (!text || text.length < 4) return false;
  if (BAD_PHRASE.test(text)) return false;
  if (BAD_ENDING.test(text)) return false;
  return text.trim().split(/\s+/).filter(w => w.length > 1).length >= 2;
}

// Detects ASR fragment details — những đoạn bị cắt giữa câu từ transcript.
// Không dựa vào Gemini follow prompt — validate bằng code.
function isDetailFragment(text) {
  if (!text || text.trim().length < 8) return true;
  const t = text.trim().toLowerCase();
  // Bắt đầu bằng liên từ = phần tiếp theo của câu trước
  if (/^(và |hoặc |hay |nhưng |mà |thì |vì |bởi |nên |thậm chí |tuy nhiên |ngoài ra |bên cạnh |đó là )/.test(t)) return true;
  // Kết thúc bằng giới từ lơ lửng
  if (/\s+(đến|của|trong|về|từ|với|cho|theo|ra|vào|sau|trước|qua|tới|ở|tại|lên|xuống)\s*$/.test(t)) return true;
  // Kết thúc bằng liên từ lửng — câu bị cắt giữa chừng
  if (/\s+(hoặc|hay|và|nhưng|mà|thì|vì|nên|mà|hoặc|như)\s*$/.test(t)) return true;
  // Kết thúc bằng từ không thể kết thúc ý hoàn chỉnh
  if (/\s+(mức|điều|gấp|giấc|gì|thế|sao|nào|ấy|kia|vậy)\s*$/.test(t)) return true;
  return false;
}

function postProcessOverlays(overlays) {
  const cleaned = overlays
    .map(ov => {
      const title  = sanitizeText(ov.title);
      let   detail = sanitizeText(ov.detail);
      // Nếu detail là fragment ASR → xoá detail (giữ card), không drop card
      if (detail && isDetailFragment(detail)) {
        logWarning(`Fragment detail cleared: "${title}" / "${detail}"`);
        detail = "";
      }
      return { ...ov, title, detail };
    })
    .filter(ov => {
      const ok = isValidText(ov.title);   // Chỉ title quyết định có giữ card không
      if (!ok) logWarning(`Dropped bad card: "${ov.title}" / "${ov.detail}"`);
      return ok;
    });

  // Build list windows: [startTime, endTime] of each list_group
  const listWindows = [];
  const groups = new Map();
  for (const ov of cleaned) {
    if (!ov.list_group) continue;
    if (!groups.has(ov.list_group)) groups.set(ov.list_group, { start: Infinity, end: -Infinity });
    const g = groups.get(ov.list_group);
    g.start = Math.min(g.start, toSeconds(ov.startTime, 0));
    g.end   = Math.max(g.end,   toSeconds(ov.endTime,   0));
  }
  for (const g of groups.values()) listWindows.push(g);

  // Remove non-list overlays that overlap with any list window
  const filtered = cleaned.filter(ov => {
    if (ov.list_group) return true;
    const start = toSeconds(ov.startTime, 0);
    const end   = toSeconds(ov.endTime,   0);
    const clash = listWindows.some(w => start < w.end && end > w.start);
    if (clash) logWarning(`Dropped overlap with list: "${ov.title}"`);
    return !clash;
  });

  // Đẩy card xuất hiện trong vùng opening hook ra sau khi hook kết thúc
  // List items (list_group) không bị shift — chúng được Gemini định thời cụ thể
  return filtered.map(ov => {
    if (ov.list_group) return ov;
    const start = toSeconds(ov.startTime, 0);
    if (start < LAYOUT.hook.safeStart) {
      const shift = LAYOUT.hook.safeStart - start;
      logWarning(`Hook overlap fix: "${ov.title}" shifted +${shift.toFixed(1)}s`);
      return { ...ov, startTime: LAYOUT.hook.safeStart, endTime: toSeconds(ov.endTime, 0) + shift };
    }
    return ov;
  });
}
// ───────────────────────────────────────────────────────────────────

// rewriteCardText — dùng Gemini Flash để làm sạch title/detail của từng card
// Input:  mảng overlays (in-place mutation)
// Output: mutates ov.title / ov.detail cho những card có text lủng củng từ ASR
async function rewriteCardText(overlays, apiKey) {
  const cards = overlays.filter(ov => ov.title);
  if (!cards.length) return;

  console.log(`[rewriteCards] Cleaning text for ${cards.length} cards via Gemini...`);

  const cardInputs = cards.map(ov => ({
    id:     ov.startTime,        // số thực — unique per card
    title:  ov.title  || "",
    detail: ov.detail || ""
  }));

  const prompt = `Bạn là biên tập viên nội dung tiếng Việt chuyên nghiệp. Làm sạch text của các card dưới đây.
Input là transcript ASR (nhận dạng giọng nói tự động) — có thể chứa từ đệm, câu không hoàn chỉnh, ngữ pháp lủng củng.

QUY TẮC BẮT BUỘC:
1. title: tối đa 6 từ — không từ đệm, nghĩa độc lập, ngắn gọn súc tích, dùng được làm tiêu đề đứng một mình
2. detail: tối đa 15 từ — câu hoàn chỉnh, không từ đệm, thông tin cụ thể rõ ràng, đọc độc lập vẫn hiểu
3. Giữ nguyên ý nghĩa cốt lõi — KHÔNG bịa thêm con số hoặc thông tin mới
4. Chỉ tiếng Việt, giữ nguyên tên riêng/thuật ngữ tiếng Anh nếu có
5. Trả về đúng JSON array, không thêm bất kỳ text giải thích nào

Input JSON:
${JSON.stringify(cardInputs)}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type:     "OBJECT",
          properties: {
            id:     { type: "NUMBER" },
            title:  { type: "STRING" },
            detail: { type: "STRING" }
          },
          required: ["id", "title", "detail"]
        }
      }
    }
  };

  const models = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
  let result = null;

  for (const model of models) {
    try {
      console.log(`[rewriteCards] Trying model: ${model}...`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const json   = await response.json();
      result = JSON.parse(json.candidates[0].content.parts[0].text);
      console.log(`[rewriteCards] ✓ Model ${model} succeeded`);
      break;
    } catch (err) {
      console.log(`[rewriteCards] ✗ ${model} failed: ${err.message}`);
    }
  }

  if (!result || !Array.isArray(result)) {
    console.log("[rewriteCards] ⚠  All models failed — keeping original card text");
    return;
  }

  // Apply rewrites in-place
  const map = new Map(result.map(r => [r.id, r]));
  let applied = 0;
  for (const ov of overlays) {
    const r = map.get(ov.startTime);
    if (!r) continue;
    if (r.title  && r.title.trim())  ov.title  = r.title.trim();
    if (r.detail && r.detail.trim()) ov.detail = r.detail.trim();
    applied++;
  }
  console.log(`[rewriteCards] Applied rewrites to ${applied}/${cards.length} cards`);
}
// ───────────────────────────────────────────────────────────────────

// Từ tiếng Việt thường đứng ĐẦU cụm mới — ưu tiên tách TRƯỚC những từ này
const VIET_PHRASE_STARTERS = new Set([
  'và','hoặc','hay','nhưng','mà','nên','vì','nếu','khi','sau','trước',
  'trong','với','từ','cho','tại','qua','đến','về','theo','bằng','giữa',
  'giúp','làm','có','là','được','tạo','giảm','tăng','cải','hỗ','thúc',
  'omega','vitamin','protein','glucose','glut','cortisol','insulin'
]);

function findSemanticSplitPoint(words, maxWords) {
  const n = words.length;
  const mid = Math.ceil(n / 2);
  // Tìm điểm tách tốt nhất trong khoảng [2, n-2]
  // Ưu tiên: đứng trước từ đầu cụm + gần giữa câu
  let best = mid;
  let bestScore = -Infinity;
  for (let i = 2; i <= n - 2; i++) {
    const leftOk  = i <= maxWords;
    const rightOk = (n - i) <= maxWords;
    if (!leftOk || !rightOk) continue;
    const isPhraseBoundary = VIET_PHRASE_STARTERS.has(words[i].toLowerCase()) ? 20 : 0;
    const nearMid = -Math.abs(i - mid) * 2;
    const score = isPhraseBoundary + nearMid;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function splitLongSentences(sentences, maxWords = LAYOUT.subtitle.maxWords) {
  // While loop: lặp đến khi không còn normal sentence nào > maxWords
  // Cần thiết khi câu dài > 2×maxWords — split 1 lần vẫn còn dư
  let changed = true;
  let current = sentences;
  while (changed) {
    changed = false;
    const out = _splitLongSentencesOnce(current, maxWords);
    if (out.length !== current.length ||
        out.some((s, i) => s !== current[i])) changed = true;
    current = out;
  }
  return current;
}
function _splitLongSentencesOnce(sentences, maxWords) {
  const out = [];
  for (const s of sentences) {
    if (s.style === 'peak') {
      // ── Peak split: leading regular/connector trước anchor → normal, anchor+rest → peak ──
      // Vd: "người được thông báo | ngủ sâu | đạt điểm cao hơn đáng kể"
      //   → normal("người được thông báo") + peak(anchor+script_climax)
      const pl = s.peakLines;
      const anchorIdx = pl ? pl.findIndex(c => c.type === 'anchor') : -1;
      if (anchorIdx > 0) {
        // Đếm từ trong các chunk trước anchor
        const leadWords = pl.slice(0, anchorIdx)
          .reduce((n, c) => n + c.text.trim().split(/\s+/).filter(Boolean).length, 0);
        const remWords  = s.words.length - leadWords;
        // Chỉ split khi lead ≥ 2 từ, phần peak còn lại ≥ 3 từ, câu đủ dài (>6 từ)
        if (leadWords >= 2 && remWords >= 3 && s.words.length > 6) {
          const dur       = s.endTime - s.startTime;
          const splitTime = s.startTime + (leadWords / s.words.length) * dur;
          // Phần normal (lead-in): chạy trước
          out.push({
            ...s,
            words:     s.words.slice(0, leadWords),
            text:      s.words.slice(0, leadWords).join(' '),
            endTime:   splitTime,
            style:     'normal',
            peakLines: null,
          });
          // Phần peak (anchor + rest): re-run normalizeSentence với words thực tế
          // Vấn đề: pl.slice(anchorIdx) chứa chunk texts từ câu GỐC, nhưng phần split
          // có thể có thêm leading words không nằm trong chunk nào (orphaned words)
          // → HTML alignment vỡ (lỗi "một cái / lượng lợi / ích khổng lồ")
          //
          // Fix: synthetic peak_lines = connector(orphaned) + Gemini chunks
          //   Ví dụ: split portion = ["một","cái","lượng","lợi","ích","khổng","lồ","cho","sức","khỏe"]
          //          Gemini chunks = anchor("lợi ích") + sc("khổng lồ") + regular("cho sức khỏe") = 7 words
          //          orphanCount = 10 - 7 = 3 → prepend connector("một cái lượng")
          //          → connector("một cái lượng") | anchor("lợi ích") | sc("khổng lồ") | regular("cho sức khỏe")
          //          → 10 words = words.length ✓, Gemini semantics preserved ✓
          {
            const splitWords = s.words.slice(leadWords);
            const geminiChunks = pl.slice(anchorIdx);

            // ── Smart alignment: tìm vị trí ĐÚNG của từng chunk trong splitWords ──────────
            // Bug cũ: giả định orphan luôn ở ĐẦU → prepend connector("orphan words")
            // Nhưng orphan có thể ở GIỮA (vd: "sức mạnh | của | trí não" — "của" ở giữa)
            // Fix: scan foldText từ trái sang phải, tìm vị trí match của từng gemini chunk
            // Sau đó fill gap giữa các chunk bằng connector
            const _sw = splitWords;
            const _sf = _sw.map(w => foldText(w));
            let _sFrom = 0;
            const _cpos = [];
            for (const _gc of geminiChunks) {
              const _tok = _gc.text.trim().split(/\s+/).filter(Boolean);
              const _tf  = _tok.map(w => foldText(w));
              let _found = false;
              for (let _i = _sFrom; _i <= _sw.length - _tok.length; _i++) {
                let _ok = true;
                for (let _j = 0; _j < _tok.length; _j++) {
                  if (_sf[_i + _j] !== _tf[_j]) { _ok = false; break; }
                }
                if (_ok) {
                  _cpos.push({ chunk: _gc, start: _i, end: _i + _tok.length });
                  _sFrom = _i + _tok.length;
                  _found = true;
                  break;
                }
              }
              if (!_found) {
                // Chunk không khớp foldText (Gemini dùng từ khác) → sequential fallback
                const _end = Math.min(_sFrom + _tok.length, _sw.length);
                _cpos.push({ chunk: _gc, start: _sFrom, end: _end });
                _sFrom = _end;
              }
            }

            // Build syntheticPeakLines: chèn connector cho mọi gap (đầu, giữa, cuối)
            const syntheticPeakLines = [];
            let _pos = 0;
            for (const { chunk: _gc, start: _cs, end: _ce } of _cpos) {
              if (_cs > _pos) {
                syntheticPeakLines.push({ text: _sw.slice(_pos, _cs).join(' '), type: 'connector' });
              }
              syntheticPeakLines.push({ text: _sw.slice(_cs, _ce).join(' '), type: _gc.type });
              _pos = _ce;
            }
            if (_pos < _sw.length) {
              syntheticPeakLines.push({ text: _sw.slice(_pos).join(' '), type: 'connector' });
            }

            console.warn(`[split-align] s${s.index}→ ${syntheticPeakLines.map(c=>`${c.type}("${c.text}")`).join(' | ')}`);

            out.push(normalizeSentence({
              ...s,
              index:     s.index + 0.5,
              words:     splitWords,
              text:      splitWords.join(' '),
              startTime: splitTime,
              style:     'peak',
              peak_lines: syntheticPeakLines.map(c => ({ text: c.text, type: c.type })),
            }));
          }
          continue;
        }
      }
      out.push(s); continue;
    }
    if (s.words.length <= maxWords) { out.push(s); continue; }
    const split = findSemanticSplitPoint(s.words, maxWords);
    const dur = s.endTime - s.startTime;
    const splitTime = s.startTime + (split / s.words.length) * dur;
    out.push({ ...s, words: s.words.slice(0, split), text: s.words.slice(0, split).join(' '), endTime: splitTime });
    out.push({ ...s, index: s.index + 0.5, words: s.words.slice(split), text: s.words.slice(split).join(' '), startTime: splitTime });
  }
  return out;
}

/**
 * getPeakSmartIndents — tính padding-left cho từng chunk trong 3-line peak cascade.
 *
 * Rule (scalable, no hardcode):
 *   • Line 1 (anchor)        → indent = 0
 *   • Line 2 (regular/conn.) → indent = peakSmartFirstCharWidth   (≈ width ký tự đầu anchor)
 *   • Line 3 (script_climax) → indent = line2Start + ước tính độ dài line 2
 *                              (bị cap nếu text line 3 sẽ overflow container)
 *   • Line 4+                → fallback về peakIndentStep × lineIdx
 *
 * Trả về null nếu điều kiện không thoả (2-chunk, anchor không đứng đầu, không có script_climax)
 * → caller dùng fallback lineIdx × peakIndentStep bình thường.
 */
function getPeakSmartIndents(chunks) {
  const LP = LAYOUT.peak;
  const LS = LAYOUT.subtitle;
  if (!LP.peakSmartIndentEnabled)            return null; // feature flag
  if (chunks[0].type !== 'anchor')           return null; // anchor phải đứng đầu
  if (chunks[chunks.length - 1].type !== 'script_climax') return null; // phải kết bằng script_climax

  const firstCharW = LS.peakSmartFirstCharWidth; // = Math.round(anchorSize × 0.50)

  // ── 2-chunk shortcut: anchor + script_climax ──────────────────────────────────────────────
  // Line 2 bắt đầu sau ký tự đầu tiên của anchor → tạo staircase dù chỉ 2 dòng
  if (chunks.length === 2) {
    return {
      indents: [0, firstCharW],
      climaxExtraTopPull: 0,
    };
  }

  // ── Ước tính độ rộng line 2 ──────────────────────────────────────────────────────────────
  const midChunk  = chunks[1];
  const midWords  = midChunk.text.trim().split(/\s+/).filter(Boolean);
  const midFontSz = ({
    connector:    LS.peakConnectorSize,
    regular:      LS.peakRegularSize,
    anchor:       LS.peakAnchorSize,
    script:       LS.peakScriptSize,
    script_climax: LS.peakScriptClimaxSize,
  })[midChunk.type] ?? LS.peakRegularSize;
  const midEstW = Math.round(
    midWords.length * midFontSz * LP.peakSmartRegCharRatio * LP.peakSmartAvgWordChars
  );

  // ── Ước tính độ rộng line 3 (DVN Grandy cursive) — để safety-cap ────────────────────────
  const scChunk = chunks[2];
  const scWords = scChunk.text.trim().split(/\s+/).filter(Boolean);
  const scEstW  = Math.round(
    scWords.length * LS.peakScriptClimaxSize * LP.peakSmartScriptCharRatio * LP.peakSmartAvgWordChars
  );

  // Indent line 3 = firstCharW + ước tính độ rộng line 2
  // Cap: đảm bảo line 3 không overflow container (margin trái 20px)
  const rawLine3Indent = firstCharW + midEstW;
  const maxSafeIndent  = Math.max(LS.width - scEstW - 20, firstCharW);
  const line3Indent    = Math.min(rawLine3Indent, maxSafeIndent);

  // Pull-up tỷ lệ với font size của line 2 (KHÔNG hardcode px cố định)
  // Lý do: khoảng trắng tạo ra bởi line 2 tỷ lệ với font-size của nó
  // → giảm gap cũng phải tỷ lệ với chính font-size đó mới scale đúng
  const climaxExtraTopPull = Math.round(midFontSz * LP.peakSmartClimaxTopPullRatio);

  return {
    indents: chunks.map((_, i) => {
      if (i === 0) return 0;
      if (i === 1) return firstCharW;
      if (i === 2) return line3Indent;
      return i * LS.peakIndentStep; // 4+ chunk: fallback bình thường
    }),
    climaxExtraTopPull,
  };
}

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

function generatePremiumHTML(sentences, overlays, totalDuration, geminiHook = null, imageGapSegments = []) {
  const renderSentences = splitLongSentences((sentences || []).map(normalizeSentence));

  // Suppress overlay cards that overlap with peak sentences — TYB peak IS the card
  // Showing both card + peak for same content is redundant and visually noisy
  const peakWindows = renderSentences
    .filter(s => s.style === "peak")
    .map(s => ({ start: s.startTime, end: s.endTime }));

  const rawOverlays = postProcessOverlays((overlays || []).map(normalizeOverlay));
  const renderOverlays = rawOverlays.filter(card => {
    const cStart = toSeconds(card.startTime, 0);
    const cEnd   = toSeconds(card.endTime,   cStart + 1);
    // Keep card only if it does NOT overlap any peak window
    return !peakWindows.some(p => cStart < p.end && cEnd > p.start);
  });
  const fmt = (value) => Number(toSeconds(value, 0)).toFixed(3);

  // ── Lottie icon brightness analysis (server-side, runs once per card) ─────────
  // Scan tất cả fill/stroke color trong JSON → tính average luminance
  // Mục đích: tự động detect icon tối → apply brightness boost để hiển thị rõ trên nền tối
  function analyzeLottieAvgBrightness(animData) {
    const vals = [];
    function fromShape(s) {
      if (!s) return;
      if ((s.ty === 'fl' || s.ty === 'st') && s.c && s.c.k !== undefined) {
        const k = s.c.k;
        if (Array.isArray(k) && typeof k[0] === 'number' && k.length >= 3) {
          vals.push(0.299 * k[0] + 0.587 * k[1] + 0.114 * k[2]);
        } else if (Array.isArray(k)) {
          k.forEach(kf => {
            if (kf.s && typeof kf.s[0] === 'number')
              vals.push(0.299 * kf.s[0] + 0.587 * kf.s[1] + 0.114 * kf.s[2]);
          });
        }
      }
      if (s.it) s.it.forEach(fromShape);
    }
    function fromLayer(layer) {
      if (!layer) return;
      if (layer.ty === 1) return; // solid bg layer — skip
      const nm = (layer.nm || '').toLowerCase().trim();
      if (nm === 'bg' || nm === 'bkg' || nm === 'background' || nm === 'backdrop') return;
      if (layer.shapes) layer.shapes.forEach(fromShape);
      if (layer.layers) layer.layers.forEach(fromLayer);
    }
    if (animData && animData.layers) animData.layers.forEach(fromLayer);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.5;
  }

  // Tính CSS filter string cho icon — bake vào inline style của div (1 lần, server-side)
  // Quy tắc brightness theo avg luminance của fills:
  //   < 0.20 → near-black (đen, navy đậm)  → brightness(4.5) contrast(0.85)
  //   < 0.40 → dark (xám đậm, màu tối)     → brightness(2.5)
  //   < 0.55 → muted (xám nhạt, trung tính) → brightness(1.6)
  //   ≥ 0.55 → bright/colorful              → giữ nguyên màu gốc
  // Glow CNFI lime/red vẫn được giữ cho mọi loại icon
  function getLottieIconFilter(animData, isWarn) {
    const avg = analyzeLottieAvgBrightness(animData);
    const glow = isWarn
      ? 'drop-shadow(0 0 14px rgba(255,68,68,0.88)) drop-shadow(0 4px 12px rgba(0,0,0,0.55))'
      : 'drop-shadow(0 0 20px rgba(166,255,61,0.88)) drop-shadow(0 4px 12px rgba(0,0,0,0.6))';
    if (avg < 0.20) return `brightness(4.5) contrast(0.85) ${glow}`;
    if (avg < 0.40) return `brightness(2.5) ${glow}`;
    if (avg < 0.55) return `brightness(1.6) ${glow}`;
    return glow;
  }

  // Build inline Lottie data map — keyed by cardId ("card-0", "card-1", ...)
  // Each entry is the parsed JSON or null if no lottie_path
  const lottieDataMap = {};
  for (let i = 0; i < renderOverlays.length; i++) {
    const lp = renderOverlays[i].lottie_path;
    if (lp) {
      try {
        lottieDataMap[`card-${i}`] = JSON.parse(fs.readFileSync(lp, 'utf8'));
      } catch (e) {
        lottieDataMap[`card-${i}`] = null;
      }
    } else {
      lottieDataMap[`card-${i}`] = null;
    }
  }

  const openingHook = buildOpeningHook(renderSentences, renderOverlays, geminiHook);
  const hookDimHtml = `<div class="hook-dim" id="hook-dim" aria-hidden="true"></div>`;
  const hookHtml = `
      <div class="opening-hook" id="opening-hook" aria-hidden="true">
        <div class="hook-kicker">${escapeHtml(openingHook.kicker)}</div>
        <div class="hook-title">${escapeHtml(openingHook.title)}</div>
        <div class="hook-punch">${escapeHtml(openingHook.punch)}</div>
      </div>`;

  let cardsHtml = "";
  let visualRowsHtml = "";
  // metricRenderMap: keyed by cardId, stores generated GSAP code per STAT card
  const metricRenderMap = {};
  // cardHasLottie[i] = true if overlay[i] has a lottie_path — used in GSAP loop
  const cardHasLottie = [];

  for (let i = 0; i < renderOverlays.length; i++) {
    const card = renderOverlays[i];
    const cardId = `card-${i}`;
    const vrId = `vr-${i}`;
    const vrTypeClass = card.type === "STAT" ? " vr-stat" : card.type === "WARNING" ? " vr-warning" : card.list_group ? " vr-list" : "";

    // Animation nằm trong card (card-lottie) — không dùng visual-row nữa
    const hasLottie = !!card.lottie_path;
    cardHasLottie.push(hasLottie);

    if (card.type === "STAT") {
      // Universal Metric Renderer — handles single, range, comparison, text_metric
      // automatically from the card title. No hard-coding of specific values.
      const cardStartSec = toSeconds(card.startTime, 0);
      const cardEndSec   = toSeconds(card.endTime, cardStartSec + 3.5);
      // Enrich direction fallback with transcript sentences overlapping this card's window
      // (e.g. "gấp 4 lần" may be in the spoken sentence but not in card.detail/title)
      const overlapText = renderSentences
        .filter(s => s.endTime > cardStartSec - 0.5 && s.startTime < cardEndSec + 0.5)
        .map(s => s.text || (s.words || []).join(" "))
        .join(" ");
      const directionFallback = `${card.detail || ""} ${card.title || ""} ${overlapText}`.trim();
      const metricResult = renderMetricFromTitle(
        card.title || "",
        `#${cardId}`,
        cardStartSec,
        cardEndSec,
        card.metric_direction || null,
        directionFallback
      );
      metricRenderMap[cardId] = metricResult.gsapCode;

      const rawTitle = card.title || "";
      const compactLength = rawTitle.replace(/\s+/g, "").length;
      const sizeClass = compactLength >= 9 ? "stat-compact"
                      : compactLength >= 6 ? "stat-medium"
                      : "stat-large";

      cardsHtml += `
        <div class="card-stat ${sizeClass}" id="${cardId}">
          <div class="stat-neon-bar"></div>
          <div class="stat-content">
            <div class="stat-value ${sizeClass}">${metricResult.html}</div>
            <div class="stat-divider"><span class="stat-divider-fill"></span></div>
            <div class="stat-label">${escapeHtml(card.detail)}</div>
          </div>
        </div>`;
    } else if (card.list_style === 'progressive' || card.list_style === 'steps_overview') {
      const idxNum  = card.list_index || 1;
      const total   = card.list_total || '';
      const progress = total ? `<span class="list-progress">${idxNum}/${total}</span>` : '';
      const numCircle = `<div class="list-num">${idxNum}</div>`;
      const warningCls = card.type === 'WARNING' ? ' card-warning' : '';
      cardsHtml += `
        <div class="card card-list-progressive${warningCls}" id="${cardId}" data-list-group="${escapeHtml(card.list_group||'')}" data-list-index="${idxNum}">
          ${numCircle}
          <div class="list-content">
            <div class="list-header">
              <span class="list-title">${escapeHtml(card.title)}</span>
              ${progress}
            </div>
            <div class="list-detail">${escapeHtml(card.detail)}</div>
          </div>
        </div>`;

    } else if (card.list_style === 'number_slam') {
      const idxNum = card.list_index || 1;
      const total  = card.list_total || '';
      const supText = total ? `/${total}` : '';
      cardsHtml += `
        <div class="card card-list-slam" id="${cardId}">
          <div class="slam-num">${idxNum}<sup class="slam-sup">${supText}</sup></div>
          <div class="slam-title">${escapeHtml(card.title)}</div>
          <div class="slam-detail">${escapeHtml(card.detail)}</div>
        </div>`;

    } else if (card.list_style === 'checklist') {
      const warningCls = card.type === 'WARNING' ? ' card-warning' : '';
      const checkIcon  = card.type === 'WARNING' ? '✕' : '✓';
      const checkCls   = card.type === 'WARNING' ? 'check-icon check-no' : 'check-icon check-yes';
      cardsHtml += `
        <div class="card card-list-check${warningCls}" id="${cardId}">
          <div class="${checkCls}">${checkIcon}</div>
          <div class="list-content">
            <div class="list-title">${escapeHtml(card.title)}</div>
            <div class="list-detail">${escapeHtml(card.detail)}</div>
          </div>
        </div>`;

    } else {
      const badgeHtml = card.type === "WARNING"
        ? `<span class="badge warning-badge">CẢNH BÁO</span>`
        : "";
      const cardTypeClass = card.type === "WARNING" ? " card-warning"
                          : card.type === "ACTION"  ? " card-action"
                          : "";
      // Lottie float icon — INSIDE card (last child), tràn ra ngoài qua overflow:visible
      // CSS right/top định vị tại góc trên-phải — không cần JS getBoundingClientRect
      // filter baked inline server-side: brightness rule + glow, không cần class override
      const iconClass = card.type === "WARNING" ? " icon-warn"
                      : card.type === "ACTION"  ? " icon-action"
                      : "";
      const _isWarnIcon = card.type === "WARNING";
      const _iconFilter = getLottieIconFilter(lottieDataMap[cardId] || null, _isWarnIcon);
      const floatIconHtml = hasLottie
        ? `<div class="card-icon-float${iconClass}" id="lottie-${cardId}" style="filter:${_iconFilter}"></div>`
        : "";
      const hasIconClass = hasLottie ? " card-has-icon" : "";
      cardsHtml += `
        <div class="card card-info${cardTypeClass}${hasIconClass}" id="${cardId}">
          <div class="card-text">
            ${badgeHtml ? `<div class="card-header">${badgeHtml}</div>` : ""}
            <div class="card-title">${escapeHtml(card.title)}</div>
            <div class="card-body">${escapeHtml(card.detail)}</div>
          </div>
          ${floatIconHtml}
        </div>`;
    }
  }

  let subtitlesHtml = "";
  for (let sIdx = 0; sIdx < renderSentences.length; sIdx++) {
    const sentence = renderSentences[sIdx];
    const sId = `sentence-${sIdx}`;
    let sStyle = sentence.style || "normal"; // fallback safety

    // ── Auto-downgrade peak: 2 guard rules ────────────────────────
    // 1. Quá ngắn (< 4 từ): extendShortPeaks đã cố mượn thêm từ;
    //    nếu vẫn < 4 từ sau extend → downgrade (không đủ visual)
    //    4-5 từ: peakKeyCount=1 → 4 regular → 3-line fallback
    //    6+ từ: peakKeyCount=2 → full 3-line TYB (wave lớn→nhỏ→lớn)
    if (sStyle === "peak" && sentence.words.length < 4) sStyle = "normal";
    // Force-normal cho câu hỏi — question sentences never peak (kills hook tension)
    // Detect: kết thúc "?", hoặc có cấu trúc "có ... không/chưa"
    if (sStyle === "peak" && /[?？]/.test(sentence.text)) sStyle = "normal";
    // hook.safeStart chỉ áp dụng cho CARD, không áp cho subtitle
    // → peak subtitle ĐƯỢC PHÉP xuất hiện từ giây đầu tiên (đó là hook moment)
    // ──────────────────────────────────────────────────────────────

    // Style class: sentence-peak only; normal has no extra class
    const styleClass = sStyle !== "normal" ? ` sentence-${sStyle}` : "";
    let wordsHtml = "";
    // IDs của các peak chunk thực sự được render — dùng cho GSAP per-chunk animation
    // Khai báo ở đây (loop scope) để cả HTML gen block lẫn GSAP block đều truy cập được
    let renderedChunkIds = [];

    if (sStyle === "peak") {
      // ── PEAK: TYB chunk-based render ─────────────────────────────
      // peakLines = [{text, type}] từ Gemini — mỗi chunk 1 dòng riêng
      // type: connector | regular | anchor | script | script_climax
      // Cascade indent: lineIdx × peakIndentStep px từ trái

      const chunks = (() => {
        const raw = sentence.peakLines || (() => {
          // Fallback khi Gemini không trả peak_lines hợp lệ
          const n = sentence.words.length;
          const keyCount = Math.min(3, Math.max(1, n - 4));
          const keyStart = n - keyCount;
          const reg = sentence.words.slice(0, keyStart);
          const mid = Math.ceil(reg.length / 2);
          return [
            { text: reg.slice(0, mid).join(" "),               type: "regular" },
            { text: reg.slice(mid).join(" "),                  type: "regular" },
            { text: sentence.words.slice(keyStart).join(" "),  type: "script"  },
          ].filter(c => c.text);
        })();

        // ── Render-time sanity guards (chạy mọi lúc, kể cả skip-gemini) ────
        let sanitized = raw.map(chunk => {
          if (chunk.type === 'anchor') {
            // anchor >3 từ → tràn màn hình
            const wc = chunk.text.trim().split(/\s+/).filter(Boolean).length;
            if (wc > 3) return { ...chunk, type: 'regular' };
            // anchor kết thúc giới từ → không phải semantic unit
            if (LAYOUT.peak.anchorEndBlockPattern && LAYOUT.peak.anchorEndBlockPattern.test(chunk.text)) {
              return { ...chunk, type: 'regular' };
            }
          }
          // script_climax bắt đầu bằng giới từ → demote script
          if (chunk.type === 'script_climax') {
            const lower = chunk.text.trim().toLowerCase();
            if (LAYOUT.peak.climaxBlockRules && LAYOUT.peak.climaxBlockRules.some(rx => rx.test(lower))) {
              return { ...chunk, type: 'script' };
            }
          }
          return chunk;
        });

        // ── [PRE-OPT] Fix compound nouns bị split tại chunk boundary ───────────────
        // Scan mọi biên chunk[i]→chunk[i+1]: nếu lastWord(i) + firstWord(i+1) = từ ghép
        // → move firstWord(i+1) sang cuối chunk[i].
        // Scalable: dictionary mở rộng được, không hardcode logic.
        {
          const _COMPOUNDS = new Set([
            // Giải phẫu / sinh lý
            'tế bào','cơ thể','não bộ','thụ thể','trí não','cảm giác','thần kinh','tiêu hóa','miễn dịch',
            // Sinh hóa / cơ chế
            'hiệu ứng','tác dụng','cơ chế','quá trình','phản ứng','oxy hóa',
            'axit béo','chất béo','chất xơ','đường huyết','trao đổi',
            // Y khoa
            'giả dược','tiểu đường','béo phì','viêm nhiễm','huyết áp','nhịp tim','kháng thể',
            // Thể chất / sức khỏe
            'năng lượng','lợi ích','tác hại','sức khỏe','cân nặng','hành trình','tín hiệu',
            // Retorical / motivational
            'bí kíp','bí quyết','bí mật','mấu chốt',
          ]);
          let _cpChanged = true;
          while (_cpChanged) {
            _cpChanged = false;
            for (let _ci = 0; _ci < sanitized.length - 1; _ci++) {
              const _wA = sanitized[_ci].text.trim().split(/\s+/);
              const _wB = sanitized[_ci + 1].text.trim().split(/\s+/);
              const _lastW  = _wA[_wA.length - 1].toLowerCase().replace(/[.,!?;:]/g, '');
              const _firstW = _wB[0].toLowerCase().replace(/[.,!?;:]/g, '');
              if (_COMPOUNDS.has(_lastW + ' ' + _firstW)) {
                // ── Anchor rebalance: left chunk là anchor + cuối anchor = nửa đầu từ ghép
                // KHÔNG absorb vào anchor (tránh tạo anchor >3 từ tràn màn hình)
                // Thay vào đó: dịch lastWord anchor sang đầu next chunk → từ ghép nguyên vẹn ở next
                // Vd: anchor("hiệu ứng giả") + sc("dược")
                //   → anchor("hiệu ứng") + sc("giả dược")  ✓
                if (sanitized[_ci].type === 'anchor' && _wA.length > 1) {
                  const _newAnchorText = _wA.slice(0, -1).join(' ');
                  const _newNextText   = _wA[_wA.length - 1] + ' ' + sanitized[_ci + 1].text.trim();
                  sanitized = [
                    ...sanitized.slice(0, _ci),
                    { text: _newAnchorText, type: 'anchor' },
                    { text: _newNextText,   type: sanitized[_ci + 1].type },
                    ...sanitized.slice(_ci + 2),
                  ];
                  _cpChanged = true; break;
                }
                // Normal: absorb firstWord của next vào left chunk (left không phải anchor)
                const _newAText = sanitized[_ci].text.trimEnd() + ' ' + _wB[0];
                const _remB = _wB.slice(1);
                if (_remB.length === 0) {
                  // chunk[i+1] hết từ → absorb hoàn toàn, giữ type của chunk[i]
                  sanitized = [
                    ...sanitized.slice(0, _ci),
                    { text: _newAText, type: sanitized[_ci].type },
                    ...sanitized.slice(_ci + 2),
                  ];
                } else {
                  sanitized = [
                    ...sanitized.slice(0, _ci),
                    { text: _newAText,         type: sanitized[_ci].type },
                    { text: _remB.join(' '),   type: sanitized[_ci + 1].type },
                    ...sanitized.slice(_ci + 2),
                  ];
                }
                _cpChanged = true; break;
              }
            }
          }
        }

        // ── [OPT-0] Hấp thụ script_climax ≤2 từ vào chunk ngay trước ────────────────
        // Vd: regular("hiệu ứng giả") + script_climax("dược") → script_climax("hiệu ứng giả dược")
        // Case đặc biệt: anchor(1 từ) + script_climax(1 từ) = compound noun bị split ("giả|dược")
        //   → merge thành anchor("giả dược") để giữ concept nguyên vẹn
        // Guard: tổng ≤6 từ (6 tiếng Việt ≈ 420px < 1000px container, an toàn)
        { let _o0Changed = true;
          while (_o0Changed) {
            _o0Changed = false;
            for (let _o0 = 1; _o0 < sanitized.length; _o0++) {
              if (sanitized[_o0].type === 'script_climax') {
                const _wc0 = sanitized[_o0].text.trim().split(/\s+/).filter(Boolean).length;
                const _prev = sanitized[_o0 - 1];
                // Case A: prev là regular/connector/script → merge thành script_climax
                if (_wc0 <= 2 && ['regular','connector','script'].includes(_prev.type)) {
                  const _mt0 = _prev.text + ' ' + sanitized[_o0].text;
                  if (_mt0.trim().split(/\s+/).filter(Boolean).length <= 6) {
                    sanitized = [...sanitized.slice(0, _o0 - 1),
                                 { text: _mt0, type: 'script_climax' },
                                 ...sanitized.slice(_o0 + 1)];
                    _o0Changed = true; break;
                  }
                }
                // Case B: anchor(1 từ) + script_climax(1 từ) = compound bị split → merge thành anchor
                if (_wc0 === 1 && _prev.type === 'anchor' &&
                    _prev.text.trim().split(/\s+/).filter(Boolean).length === 1) {
                  sanitized = [...sanitized.slice(0, _o0 - 1),
                               { text: _prev.text + ' ' + sanitized[_o0].text, type: 'anchor' },
                               ...sanitized.slice(_o0 + 1)];
                  _o0Changed = true; break;
                }
              }
            }
          }
        }

        // ── [OPT-1] Merge ALL adjacent lime lines → 1 dòng script_climax dominant ─────
        // Handle mọi combo Gemini hay trả:
        //   script + script_climax       → merge
        //   script_climax + script_climax → merge
        //   script_climax + script       → merge  ← case mới (trước bị miss)
        //   script + script              → merge
        // While loop để handle 3+ lime liên tiếp (mỗi pass merge 1 cặp)
        { let _opt1Changed = true;
          while (_opt1Changed) {
            _opt1Changed = false;
            for (let _oi = 0; _oi < sanitized.length - 1; _oi++) {
              if (['script', 'script_climax'].includes(sanitized[_oi].type) &&
                  ['script', 'script_climax'].includes(sanitized[_oi + 1].type)) {
                const _om = { text: sanitized[_oi].text + ' ' + sanitized[_oi + 1].text, type: 'script_climax' };
                sanitized = [...sanitized.slice(0, _oi), _om, ...sanitized.slice(_oi + 2)];
                _opt1Changed = true;
                break;
              }
            }
          }
        }

        // ── [OPT-2] Promote regular → anchor nếu thiếu focal point trắng ──────────
        // Gemini đôi khi không assign anchor → peak mất dòng trắng đậm dominant
        // Rule: nếu không có anchor nhưng có script_climax → promote regular đủ tiêu chí
        // Tiêu chí: ≤3 từ + không kết thúc giới từ (giống anchor guard ban đầu)
        if (!sanitized.some(c => c.type === 'anchor') && sanitized.some(c => c.type === 'script_climax')) {
          const _oai = sanitized.findIndex(c => {
            if (c.type !== 'regular') return false;
            const _owc = c.text.trim().split(/\s+/).filter(Boolean).length;
            if (_owc > 3) return false;
            if (LAYOUT.peak.anchorEndBlockPattern && LAYOUT.peak.anchorEndBlockPattern.test(c.text)) return false;
            // Không promote nếu bắt đầu bằng liên từ/đại từ — anchor phải là concept độc lập
            if (/^(và|nhưng|mà|thì|nó|họ|ta|chúng|đó|đây|khi|nếu|vì|do|bởi|để)\s/i.test(c.text.trim())) return false;
            return true;
          });
          if (_oai !== -1) sanitized = sanitized.map((c, i) => i === _oai ? { ...c, type: 'anchor' } : c);
        }

        // ── [OPT-3] Merge connector/regular kẹp giữa anchor và script_climax ─────────
        // Pattern: anchor → connector("nó sẽ") → script_climax → connector thừa, làm loãng
        // Guard: chỉ merge nếu tổng từ ≤ 5 (tránh tràn dòng) + không vi phạm climaxBlockRules
        {
          const _oa3 = sanitized.findIndex(c => c.type === 'anchor');
          let _oc3 = -1; sanitized.forEach((c, i) => { if (c.type === 'script_climax') _oc3 = i; });
          if (_oa3 !== -1 && _oc3 !== -1 && _oc3 > _oa3 + 1) {
            const _ob3 = [];
            for (let _i3 = _oa3 + 1; _i3 < _oc3; _i3++) {
              if (['connector', 'regular'].includes(sanitized[_i3].type)) _ob3.push(_i3);
            }
            if (_ob3.length > 0) {
              const _bt3  = _ob3.map(i => sanitized[i].text).join(' ');
              const _nt3  = _bt3 + ' ' + sanitized[_oc3].text;
              const _wc3  = _nt3.trim().split(/\s+/).filter(Boolean).length;
              const _lo3  = _nt3.trim().toLowerCase();
              const _blk3 = LAYOUT.peak.climaxBlockRules && LAYOUT.peak.climaxBlockRules.some(rx => rx.test(_lo3));
              if (_wc3 <= 5 && !_blk3) {
                const _keep3 = new Set([..._ob3, _oc3]);
                let _tmp3 = sanitized.filter((_, i) => !_keep3.has(i));
                _tmp3.splice(_oa3 + 1, 0, { text: _nt3, type: 'script_climax' });
                sanitized = _tmp3;
              }
            }
          }
        }

        // ── [OPT-R] Rescue — đảm bảo LUÔN có script_climax ─────────────────────────
        // climaxBlockRules đôi khi over-conservative (block "mà", "là", "thì" → kill lime)
        // → nếu sau tất cả OPTs vẫn không có script_climax, promote chunk cuối cùng
        //   là regular/script lên script_climax (không dùng lại climaxBlockRules ở đây)
        // Case điển hình: "mà dựa trên lời bạn nói" bị demote → regular/script
        //   → không còn lime line → peak trắng đều → OPT-R tự cứu
        if (!sanitized.some(c => c.type === 'script_climax')) {
          let _ri = -1;
          for (let _r = sanitized.length - 1; _r >= 0; _r--) {
            if (['regular', 'script'].includes(sanitized[_r].type)) { _ri = _r; break; }
          }
          if (_ri !== -1) {
            sanitized = sanitized.map((c, i) => i === _ri ? { ...c, type: 'script_climax' } : c);
          }
        }

        // Max chunks cap tại render time
        const _maxC = LAYOUT.peak.maxChunks || 4;
        while (sanitized.length > _maxC) {
          let mi = -1;
          for (let i = 0; i < sanitized.length - 1; i++) {
            const a = sanitized[i].type, b = sanitized[i+1].type;
            if (['connector','regular'].includes(a) && ['connector','regular'].includes(b)) { mi = i; break; }
          }
          if (mi === -1) mi = 0;
          const m = { text: sanitized[mi].text + ' ' + sanitized[mi+1].text,
                      type: sanitized[mi].type === 'regular' ? 'regular' : sanitized[mi+1].type };
          sanitized = [...sanitized.slice(0, mi), m, ...sanitized.slice(mi + 2)];
        }
        return sanitized;
        // ─────────────────────────────────────────────────────────────────────
      })();

      let wGlobal = 0;
      let chunksHtml = "";
      const goldSet = new Set(); // wGlobal indices of gold (script/script_climax) words
      const renderedChunkIds = [];

      // sentence.words là canonical token source (đã fix Case C trong normalizeSentence)
      // chunk.text chỉ dùng để: (1) đếm số từ chunk chiếm, (2) xác định type
      // → HTML span count = sentence.words.length = GSAP loop count, luôn luôn đúng
      const canonWords = sentence.words;
      let wPtr = 0; // con trỏ vào canonWords

      // Smart indent: tự canh lề line 2 sau ký tự đầu anchor, line 3 sau cuối line 2
      const smartResult  = getPeakSmartIndents(chunks);  // null | {indents, climaxExtraTopPull}
      const smartIndents = smartResult ? smartResult.indents : null;

      // renderedChunkIds được khai báo ở loop scope (phía trên if block này)
      // → sẽ được populate trong chunks.forEach bên dưới

      // ── TYB Adaptive sizing: detect anchor presence ONCE cho toàn cascade ──────
      // Rule: có anchor → anchor=hero(124px), climax=accent(82px), regular=support(52px)
      //       ko anchor → climax=hero(100px), regular=label(28px) — climax dominates
      const _cascadeHasAnchor = chunks.some(c => c.type === 'anchor');
      const _LP = LAYOUT.peak;
      const _LS = LAYOUT.subtitle;

      chunks.forEach((chunk, lineIdx) => {
        // ── Indent: smart indent nếu có anchor → staircase tự động
        //   No-anchor: climax lấy max(peakNoAnchorClimaxIndent, lineIdx×step) để đủ rõ ràng
        const indent = smartIndents
          ? smartIndents[lineIdx]
          : (!_cascadeHasAnchor && chunk.type === 'script_climax')
            ? Math.max(_LP.peakNoAnchorClimaxIndent, lineIdx * _LS.peakIndentStep)
            : lineIdx * _LS.peakIndentStep;
        const isGold = chunk.type === "script_climax";

        // ── Adaptive chunk font size (TYB rule 2) ─────────────────────────────
        const _chunkFontSize = (() => {
          switch (chunk.type) {
            case 'anchor':        return _LS.peakAnchorSize;
            case 'connector':     return _LS.peakConnectorSize;
            case 'script':        return _LS.peakScriptSize;
            case 'regular':       return _cascadeHasAnchor ? _LS.peakRegularSize : _LP.peakRegularSizeFaded;
            case 'script_climax': return _cascadeHasAnchor ? _LS.peakScriptClimaxSize : _LP.peakClimaxSizeHero;
            default:              return _LS.peakRegularSize;
          }
        })();

        // Đếm từ của chunk qua foldText alignment với canonWords
        // Ưu tiên foldText match; fallback về chunk.text word count
        const chunkFolded = foldText(chunk.text.replace(/\s+/g, ""));
        let cf = "";
        let endPtr = wPtr;
        while (endPtr < canonWords.length && cf.length < chunkFolded.length) {
          cf += foldText(canonWords[endPtr]);
          endPtr++;
          if (cf === chunkFolded) break;
        }
        // Fallback: nếu foldText alignment thất bại (vd: nội dung khác hoàn toàn)
        if (endPtr === wPtr || cf !== chunkFolded) {
          const fallbackCount = chunk.text.split(/\s+/).filter(Boolean).length;
          endPtr = Math.min(wPtr + fallbackCount, canonWords.length);
        }
        if (endPtr > canonWords.length) endPtr = canonWords.length;
        if (endPtr <= wPtr) endPtr = Math.min(wPtr + 1, canonWords.length); // ít nhất 1 từ

        // ── TYB rule 1: Per-word function word reduction trong anchor chunk ────
        // Anchor chunk mà có MIX từ hư + từ nội dung → từ hư xuống _LP.peakFunctionWordScale × size
        // Ví dụ: "sẽ đốt cơ" → "sẽ"(35px) + "đốt cơ"(124px) — giống TYB "lại GIẢM"
        const _chunkWds = canonWords.slice(wPtr, endPtr);
        const _hasContentWd = chunk.type === 'anchor'
          && _chunkWds.some(w => !PEAK_FUNCTION_WORDS.has(foldText(w)));

        // Tạo spans từ canonWords (đúng token) — không phải từ chunk.text
        const spans = canonWords.slice(wPtr, endPtr).map(w => {
          const wId = `s${sIdx}-w${wGlobal}`;
          if (isGold) goldSet.add(wGlobal);
          wGlobal++;
          const cls = isGold ? "word word-peak-key" : "word";
          // Function word trong anchor → thu nhỏ; mọi word đều lấy adaptive _chunkFontSize
          const _isFuncWd = _hasContentWd && PEAK_FUNCTION_WORDS.has(foldText(w));
          const _wordSz   = _isFuncWd
            ? Math.max(_LP.peakFunctionWordMinSize, Math.round(_chunkFontSize * _LP.peakFunctionWordScale))
            : _chunkFontSize;
          return `<span class="${cls}" id="${wId}" style="font-size:${_wordSz}px !important">${escapeHtml(w)}</span>`;
        });
        wPtr = endPtr;

        if (!spans.length) return; // skip chunk rỗng
        const typeClass = `peak-chunk peak-chunk-${chunk.type.replace("_", "-")}`;
        // ── script_climax: luôn áp dụng dead-space correction của DVN Grandy (không chỉ khi có smartResult)
        // Dead-space ≈ 12% font-size ở trên glyph của DVN Grandy → margin-top âm để bù
        // Nếu có smartResult: cộng thêm climaxExtraTopPull (kéo sát line trên hơn nữa)
        // Dynamic: dùng _chunkFontSize (82px accent hoặc 100px hero) thay vì hằng số tĩnh
        const smartTopStyle = (chunk.type === 'script_climax')
          ? `margin-top:${-Math.round(_chunkFontSize * 0.12) - (smartResult ? smartResult.climaxExtraTopPull : 0)}px;`
          : '';
        const chunkId = `${sId}-c${lineIdx}`;
        renderedChunkIds.push(chunkId);
        chunksHtml += `<div id="${chunkId}" class="${typeClass}" style="padding-left:${indent}px;${smartTopStyle}">${spans.join("")}</div>`;
      });

      // Safety: còn từ thừa sau khi duyệt hết chunks → gắn vào chunk cuối
      if (wPtr < canonWords.length) {
        const lastType = chunks.length > 0 ? chunks[chunks.length - 1].type : "regular";
        const isGold = lastType === "script_climax";
        const overflow = canonWords.slice(wPtr).map(w => {
          const wId = `s${sIdx}-w${wGlobal}`;
          if (isGold) goldSet.add(wGlobal);
          wGlobal++;
          const cls = isGold ? "word word-peak-key" : "word";
          return `<span class="${cls}" id="${wId}">${escapeHtml(w)}</span>`;
        });
        const typeClass = `peak-chunk peak-chunk-${lastType.replace("_", "-")}`;
        chunksHtml += `<div class="${typeClass}">${overflow.join("")}</div>`;
        wPtr = canonWords.length;
      }

      // Lưu goldSet vào sentence để GSAP dùng
      sentence.__goldSet = goldSet;
      sentence.__renderedChunkIds = renderedChunkIds;

      subtitlesHtml += `
        <div class="sentence sentence-peak" id="${sId}" data-start="${fmt(sentence.startTime)}" data-end="${fmt(sentence.endTime)}" data-style="peak">
          ${chunksHtml}
        </div>`;
    } else {
      // ── NORMAL / EMPHASIS: flat word list ────────────────────────
      for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
        const wId = `s${sIdx}-w${wIdx}`;
        wordsHtml += `<span class="word" id="${wId}">${escapeHtml(sentence.words[wIdx])}</span>`;
      }
      subtitlesHtml += `
        <div class="sentence${styleClass}" id="${sId}" data-start="${fmt(sentence.startTime)}" data-end="${fmt(sentence.endTime)}" data-style="${sStyle}">${wordsHtml}
        </div>`;
    }
  }

  let gsapCode = `
      window.__timelines = window.__timelines || {};
      window.__countUps = window.__countUps || [];

      /* ── Lottie init — load each animation from inline data ────── */
      // Màu gốc của icon được giữ nguyên — brightness & glow đã baked vào inline style
      // server-side bởi getLottieIconFilter() (Node.js), không cần xử lý lại ở browser
      window.__lottieAnims = {};
      (function initLottie() {
        var data = window.__lottieData || {};
        Object.keys(data).forEach(function(cardId) {
          var animData = data[cardId];
          if (!animData) return;
          var container = document.getElementById('lottie-' + cardId);
          if (!container) return;
          try {
            window.__lottieAnims[cardId] = lottie.loadAnimation({
              container: container,
              animationData: animData,
              renderer: 'svg',
              loop: true,
              autoplay: false
            });
          } catch(e) { /* skip broken animations */ }
        });
      })();

      const tl = gsap.timeline({ paused: true, smoothChildTiming: true });

      // fromToIfPresent: safe GSAP helper — skips if element not found
      function fromToIfPresent(selector, fromVars, toVars, at) {
        const targets = Array.from(document.querySelectorAll(selector));
        if (targets.length) tl.fromTo(targets, fromVars, toVars, at);
      }

      tl.set("#hook-dim", { opacity: 0 }, 0);
      tl.to("#hook-dim", { opacity: 1, duration: 0.18, ease: "power1.out" }, 0);
      tl.to("#hook-dim", { opacity: 0, duration: 0.42, ease: "power2.inOut" }, 3.220);
      tl.set("#opening-hook", { opacity: 0, y: 34, scale: 0.9 }, 0);
      tl.set("#opening-hook .hook-title", { filter: "brightness(1.25)", textShadow: "0 10px 24px rgba(0,0,0,0.92), 0 0 34px rgba(166,255,61,0.38)" }, 0);
      tl.to("#opening-hook", { opacity: 1, y: 0, scale: 1, duration: 0.46, ease: "back.out(1.55)" }, 0.160);
      tl.to("#opening-hook .hook-title", { scale: 1.035, duration: 0.36, yoyo: true, repeat: 1, ease: "sine.inOut" }, 0.620);
      tl.to("#opening-hook .hook-title", { filter: "brightness(1)", textShadow: "0 10px 24px rgba(0,0,0,0.92), 0 0 16px rgba(255,255,255,0.25), 0 0 26px rgba(166,255,61,0.18)", duration: 0.32, ease: "power2.out" }, 1.180);
      tl.to("#opening-hook", { opacity: 0, y: -24, duration: 0.36, ease: "power2.in" }, 4.200);`;

  // Tính top cho từng card — đẩy xuống nếu có card khác đang hiển thị cùng lúc
  const cardTops = renderOverlays.map((card, i) => {
    const start   = toSeconds(card.startTime, 0);
    const end     = toSeconds(card.endTime,   0);
    const baseTop = card.type === "STAT" ? LAYOUT.card.statTop : LAYOUT.card.defaultTop;
    const stackCount = renderOverlays.slice(0, i).filter(prev => {
      return toSeconds(prev.startTime, 0) < end && toSeconds(prev.endTime, 0) > start;
    }).length;
    return baseTop + stackCount * LAYOUT.card.stackOffset;
  });

  for (let i = 0; i < renderOverlays.length; i++) {
    const card = renderOverlays[i];
    const cardId = `card-${i}`;
    const slideInTime = toSeconds(card.startTime, 0);
    const hasLottie = cardHasLottie[i];

    // Clip endTime: tìm card khác (khác list_group) bắt đầu SỚM NHẤT sau card này.
    // Scan toàn bộ array vì renderOverlays không đảm bảo sorted theo thời gian.
    let nextBoundaryStart = Infinity;
    for (let j = 0; j < renderOverlays.length; j++) {
      if (j === i) continue;
      const nxt = renderOverlays[j];
      const sameGroup = card.list_group && card.list_group === nxt.list_group;
      if (sameGroup) continue;
      const nxtStart = toSeconds(nxt.startTime, Infinity);
      if (nxtStart > slideInTime && nxtStart < nextBoundaryStart) nextBoundaryStart = nxtStart;
    }
    const rawEnd = toSeconds(card.endTime, slideInTime + 3.5);
    const clippedEnd = nextBoundaryStart < rawEnd ? nextBoundaryStart - 0.05 : rawEnd;
    const fadeOutTime = Math.max(slideInTime + 0.65, clippedEnd - 0.45);
    // Hard kill phải xảy ra trước nextBoundaryStart bất kể fadeOutTime tính ra sao
    const killTime = nextBoundaryStart < Infinity
      ? Math.min(fadeOutTime + 0.43, nextBoundaryStart - 0.02)
      : fadeOutTime + 0.43;
    const vrKillTime = nextBoundaryStart < Infinity
      ? Math.min(fadeOutTime + 0.40, nextBoundaryStart - 0.02)
      : fadeOutTime + 0.40;

    const left    = card.type === "STAT" ? LAYOUT.card.statLeft : LAYOUT.card.infoLeft;
    const cardTop = cardTops[i];
    gsapCode += `

      /* Float-up entrance — luxury feel, không slide cứng từ trái */
      tl.set("#${cardId}", { top: ${cardTop}, left: ${left}, x: 0, y: 22, scale: 0.96, opacity: 0 }, 0);
      tl.to("#${cardId}", { y: 0, scale: 1, opacity: 1, duration: 0.58, ease: "power3.out" }, ${fmt(slideInTime)});
      tl.to("#${cardId}", { y: -10, scale: 0.97, opacity: 0, duration: 0.38, ease: "power2.in" }, ${fmt(fadeOutTime)});
      tl.set("#${cardId}", { visibility: "hidden" }, ${fmt(killTime)});`;

    if (card.type === "STAT") {
      // Universal entrance animations (neon bar, value fade-up, divider, label)
      gsapCode += `
      fromToIfPresent("#${cardId} .stat-value", { y: 14, opacity: 0, filter: "blur(5px)" }, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.42, ease: "power3.out" }, ${fmt(slideInTime + 0.12)});
      fromToIfPresent("#${cardId} .stat-neon-bar", { scaleY: 0, transformOrigin: "bottom center" }, { scaleY: 1, duration: 0.46, ease: "power4.out" }, ${fmt(slideInTime + 0.04)});
      fromToIfPresent("#${cardId} .stat-divider-fill", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.9, ease: "power3.out" }, ${fmt(slideInTime + 0.22)});
      fromToIfPresent("#${cardId} .stat-label", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.42, ease: "power3.out" }, ${fmt(slideInTime + 0.34)});`;
      // Metric counter animation — generated by MetricRenderer for this card's type
      if (metricRenderMap[cardId]) {
        gsapCode += metricRenderMap[cardId];
      }
    } else {
      gsapCode += `
      fromToIfPresent("#${cardId} .badge",       { y: 8, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: "back.out(1.8)" }, ${fmt(slideInTime + 0.1)});
      fromToIfPresent("#${cardId} .card-title",  { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: "power3.out" }, ${fmt(slideInTime + 0.18)});
      fromToIfPresent("#${cardId} .card-body",   { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34, ease: "power3.out" }, ${fmt(slideInTime + 0.26)});
      ${hasLottie ? `/* Float icon: TYB style — góc trên-phải card, CSS right/top định vị */
      tl.set('#lottie-${cardId}', { opacity: 0, visibility: 'visible', scale: 0 }, 0);
      fromToIfPresent("#lottie-${cardId}", { scale: 0, rotation: -20, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.52, ease: "back.out(2.2)" }, ${fmt(slideInTime + 0.28)});
      tl.add(function() { var a = window.__lottieAnims['${cardId}']; if (a) a.goToAndPlay(0, true); }, ${fmt(slideInTime + 0.28)});
      tl.to("#lottie-${cardId}", { scale: 0.9, opacity: 0, duration: 0.28, ease: "power2.in" }, ${fmt(fadeOutTime)});
      tl.add(function() { var a = window.__lottieAnims['${cardId}']; if (a) a.stop(); }, ${fmt(killTime)});
      tl.set("#lottie-${cardId}", { visibility: "hidden" }, ${fmt(killTime)});` : ""}`; 
    }
  }

  gsapCode += `

      /* ── NORMAL subtitle word styles ─────────────────────────── */
      const activeStyle = {
        color: "#a6ff3d",
        opacity: 1,
        scale: 1.08,
        textShadow: "0 0 18px rgba(166, 255, 61, 0.78), 0 6px 12px rgba(0, 0, 0, 0.9)",
        duration: 0.12,
        ease: "back.out(1.65)"
      };
      const inactiveStyle = {
        color: "#ffffff",
        opacity: 0.38,
        scale: 1.0,
        textShadow: "0 6px 12px rgba(0, 0, 0, 0.9), 0 0 10px rgba(0, 0, 0, 0.6)",
        duration: 0.12,
        ease: "power2.out"
      };



      /* ── PEAK subtitle word styles ────────────────────────────── */
      /* Regular peak words: subtle highlight only — key words provide the visual anchor */
      const peakActiveStyle = {
        color: "#ffffff",
        opacity: 1,
        scale: 1.05,     /* was 1.28 → reduced: at 38px, 1.28x = 48px which overlaps neighbors */
        textShadow: "0 0 18px rgba(255,255,255,0.55), 0 4px 14px rgba(0, 0, 0, 0.95)",
        duration: 0.14,
        ease: "power2.out"
      };
      const peakInactiveStyle = {
        color: "rgba(255,255,255,0.70)",
        opacity: 1,
        scale: 1.0,
        textShadow: "0 4px 14px rgba(0, 0, 0, 0.95), 0 8px 30px rgba(0, 0, 0, 0.80)",
        duration: 0.14,
        ease: "power2.out"
      };`;

  for (let sIdx = 0; sIdx < renderSentences.length; sIdx++) {
    const sentence = renderSentences[sIdx];
    const sId = `sentence-${sIdx}`;
    const sStyle = sentence.style || "normal";
    const sDuration = sentence.endTime - sentence.startTime;
    const wordCount = Math.max(1, sentence.words.length);
    const wordDuration = sDuration / wordCount;

    // ── Sentence entrance animation — varies by style ──────────
    // peakOffset baked in as literal via Node.js template evaluation
    if (sStyle === "peak") {
      // ── Peak: per-chunk stagger animation — các hàng xuất hiện từ dưới lên ──
      // Container chỉ xử lý position; opacity được delegate xuống từng chunk
      const PA = LAYOUT.peakAnim;
      const renderedChunkIds = sentence.__renderedChunkIds || [];
      const numRC = renderedChunkIds.length;

      // Container: đặt vị trí ở time 0, ẩn đến tận lúc startTime
      gsapCode += `\n      tl.set("#${sId}", { top: ${LAYOUT.subtitle.peakTop - LAYOUT.subtitle.top}, xPercent: -50, x: 0, opacity: 0 }, 0);`;
      gsapCode += `\n      tl.set("#${sId}", { opacity: 1 }, ${fmt(sentence.startTime)});`;

      // Mỗi chunk: set ẩn tại time 0, enter từ dưới lên (bottom-first), exit từ trên xuống
      for (let ci = 0; ci < numRC; ci++) {
        const cId          = renderedChunkIds[ci];
        const enterDelay   = fmt(sentence.startTime + (numRC - 1 - ci) * PA.enterStagger);
        const exitDelay    = fmt(sentence.endTime   + ci              * PA.exitStagger);
        gsapCode += `\n      tl.set("#${cId}", { opacity: 0, y: ${PA.enterY}, x: ${PA.enterX} }, 0);`;
        gsapCode += `\n      tl.to("#${cId}", { opacity: 1, y: 0, x: 0, duration: ${PA.enterDuration}, ease: "${PA.enterEase}" }, ${enterDelay});`;
        gsapCode += `\n      tl.to("#${cId}", { opacity: 0, y: ${PA.exitY}, duration: ${PA.exitDuration}, ease: "${PA.exitEase}" }, ${exitDelay});`;
      }

      // Ẩn container sau khi chunk cuối exit xong
      const containerHide = fmt(sentence.endTime + (numRC > 0 ? (numRC - 1) * PA.exitStagger : 0) + PA.exitDuration + 0.01);
      gsapCode += `\n      tl.set("#${sId}", { opacity: 0 }, ${containerHide});`;
    } else {
      gsapCode += `
      tl.to("#${sId}", { opacity: 1, duration: 0.1 }, ${fmt(sentence.startTime)});
      tl.to("#${sId}", { opacity: 0, duration: 0.15 }, ${fmt(sentence.endTime)});`;
    }

    // ── Word karaoke — pick style set based on sentence style ──
    const activeVar   = sStyle === "peak" ? "peakActiveStyle"   : "activeStyle";
    const inactiveVar = sStyle === "peak" ? "peakInactiveStyle" : "inactiveStyle";

    // For peak: goldSet = word indices of script/script_climax chunks (from HTML gen step)
    const goldSet = sStyle === "peak" ? (sentence.__goldSet || new Set()) : new Set();

    for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
      const wId = `s${sIdx}-w${wIdx}`;
      const wStart = sentence.startTime + wIdx * wordDuration;
      const wEnd = sentence.startTime + (wIdx + 1) * wordDuration;

      if (sStyle === "peak" && goldSet.has(wIdx)) {
        // Gold word (script/script_climax): scale-pulse only — no color karaoke
        gsapCode += `
      tl.to("#${wId}", { scale: 1.12, duration: 0.14, ease: "back.out(1.8)" }, ${fmt(wStart)});
      tl.to("#${wId}", { scale: 1.0,  duration: 0.14 }, ${fmt(wEnd)});`;
      } else {
        gsapCode += `
      tl.to("#${wId}", ${activeVar}, ${fmt(wStart)});
      tl.to("#${wId}", ${inactiveVar}, ${fmt(wEnd)});`;
      }
    }
  }

  // Gap image GSAP
  imageGapSegments.forEach((seg, i) => {
    const st  = toSeconds(seg.startTime, 0);
    const end = toSeconds(seg.endTime, 0);
    const outro = Math.max(st + 0.5, end - 0.4);
    gsapCode += `
      tl.set("#gap-img-${i}", { opacity: 0 }, 0);
      tl.to("#gap-img-${i}", { opacity: 1, duration: 0.5, ease: "power2.out" }, ${st.toFixed(3)});
      fromToIfPresent("#gap-img-${i} img", { scale: 0.88, filter: "blur(12px)" }, { scale: 1.0, filter: "blur(0px)", duration: 0.5, ease: "power2.out" }, ${st.toFixed(3)});
      tl.to("#gap-img-${i}", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${outro.toFixed(3)});`;
  });

  // Progressive list: dim previous cards when next item appears
  for (let ci = 0; ci < renderOverlays.length; ci++) {
    const card = renderOverlays[ci];
    if ((card.list_style === 'progressive' || card.list_style === 'steps_overview') && card.list_index > 1) {
      const prevCards = renderOverlays.filter((c, pi) =>
        pi < ci && c.list_group && c.list_group === card.list_group
      );
      for (const prev of prevCards) {
        const prevIdx = renderOverlays.indexOf(prev);
        gsapCode += `
      tl.to("#card-${prevIdx}", { opacity: 0.28, duration: 0.25, ease: "power2.out" }, ${fmt(card.startTime)});`;
      }
    }
  }

  gsapCode += `

      window.__timelines["elegant-maxwell"] = tl;

      // Count-up registry: filled by renderMetric for each STAT card
      // Format: { id, targetValue, startTime, endTime, isFloat }
      window.__countUps = window.__countUps || [];

      function formatMetricNumber(cu, value) {
        const decimals = Number.isFinite(cu.decimals) ? Math.max(0, cu.decimals) : (cu.isFloat ? 1 : 0);
        return new Intl.NumberFormat(cu.locale || "vi-VN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        }).format(value);
      }

      function hydrateCountUpsFromDom() {
        window.__countUps = window.__countUps || [];
        const existing = new Set(window.__countUps.map(function(cu) { return cu.id; }));
        document.querySelectorAll(".metric-number[data-countup-target]").forEach(function(el) {
          if (!el.id || existing.has(el.id)) return;
          const targetValue = Number(el.dataset.countupTarget);
          const startTime = Number(el.dataset.countupStart);
          const endTime = Number(el.dataset.countupEnd);
          if (!Number.isFinite(targetValue) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
          window.__countUps.push({
            id: el.id,
            targetValue,
            startTime,
            endTime,
            isFloat: el.dataset.countupFloat === "1",
            decimals: Number(el.dataset.countupDecimals || 0),
            locale: "vi-VN"
          });
          existing.add(el.id);
        });
      }

      function syncActiveSentence(time) {
        const sentences = Array.from(document.querySelectorAll(".sentence"));
        let active = null;
        let activeStart = -Infinity;

        sentences.forEach(function(sentence) {
          const start = Number(sentence.dataset.start);
          const end = Number(sentence.dataset.end);
          if (!Number.isFinite(start) || !Number.isFinite(end)) return;
          if (time >= start && time < end && start >= activeStart) {
            active = sentence;
            activeStart = start;
          }
        });

        sentences.forEach(function(sentence) {
          const isActive = sentence === active;
          sentence.style.opacity = isActive ? "1" : "0";
          sentence.style.visibility = isActive ? "visible" : "hidden";
          sentence.style.pointerEvents = "none";
        });
      }

      window.renderAt = function(t) {
        const time = Math.max(0, Number(t) || 0);

        // Update all count-up metrics directly — GSAP seek cannot do this
        hydrateCountUpsFromDom();

        tl.pause();
        tl.seek(time, false);
        syncActiveSentence(time);

        window.__countUps.forEach(function(cu) {
          const el = document.getElementById(cu.id);
          if (!el) return;
          if (time < cu.startTime) {
            el.textContent = formatMetricNumber(cu, 0);
            return;
          }
          if (time >= cu.endTime) {
            el.textContent = formatMetricNumber(cu, cu.targetValue);
            return;
          }
          // ease-out progress
          const raw = (time - cu.startTime) / (cu.endTime - cu.startTime);
          const p = Math.max(0, Math.min(raw, 1));
          const eased = 1 - Math.pow(1 - p, 3);
          const val = cu.targetValue * eased;
          el.textContent = formatMetricNumber(cu, cu.isFloat ? val : Math.round(val));
        });

        // Advance Lottie animations — goToAndStop(frame) at current time
        var anims = window.__lottieAnims || {};
        Object.keys(anims).forEach(function(cardId) {
          var anim = anims[cardId];
          if (!anim || !anim.totalFrames) return;
          var totalF = anim.totalFrames;
          var fps    = anim.frameRate || 30;
          // Fallback: nếu getDuration() không khả dụng → tính từ totalFrames/fps
          var dur = (anim.getDuration && anim.getDuration(false)) || (totalF / fps);
          if (!dur) return;
          var frame = (time % dur) / dur * totalF;
          anim.goToAndStop(Math.floor(frame), true);
        });

        return time;
      };
  `;

  // Embed DVN Grandy as base64 — guaranteed load in Puppeteer file:// context
  const _dvnFontPath = path.resolve('assets/fonts/DVN-Grandy-gehcaa.ttf');
  const _dvnFontB64  = fs.existsSync(_dvnFontPath)
    ? fs.readFileSync(_dvnFontPath).toString('base64')
    : '';
  const _dvnFontSrc  = _dvnFontB64
    ? `url('data:font/truetype;base64,${_dvnFontB64}') format('truetype')`
    : `url('assets/fonts/DVN-Grandy-gehcaa.ttf') format('truetype')`;


  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>CNFI Premium TikTok Composition</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800;900&display=block" rel="stylesheet">

    <!-- DVN Grandy — embedded as base64, guaranteed load in Puppeteer file:// -->
    <style>
      @font-face {
        font-family: '${LAYOUT.subtitle.peakScriptClimaxFont}';
        src: ${_dvnFontSrc};
        font-weight: normal;
        font-style: normal;
        font-display: block;
      }
    </style>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.2/dist/gsap.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js"></script>

    <style>
      :root {
        --cnfi-accent:     ${LAYOUT.colors.accent};
        --cnfi-accent-rgb: ${LAYOUT.colors.accentRgb};
        --cnfi-warning:    ${LAYOUT.colors.warning};
        --cnfi-yellow:     ${LAYOUT.colors.yellow};
        --cnfi-bg:         ${LAYOUT.colors.darkBg};
      }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: transparent;
        font-family: 'Be Vietnam Pro', sans-serif;
        font-weight: 800;
        -webkit-font-smoothing: antialiased;
      }

      #root {
        position: relative;
        width: 1080px;
        height: 1920px;
        background: transparent;
        overflow: hidden;
      }

      .card-container {
        position: absolute;
        inset: 0;
        width: 1080px;
        height: 1920px;
        pointer-events: none;
        z-index: 3;
      }

      .global-neon-rail {
        position: absolute;
        left: 70px;
        top: 980px;
        width: 3px;
        height: 520px;
        background: linear-gradient(
          180deg,
          rgba(166, 255, 61, 0) 0%,
          rgba(166, 255, 61, 0.5) 8%,
          rgba(166, 255, 61, 0.5) 92%,
          rgba(166, 255, 61, 0) 100%
        );
        box-shadow: 0 0 5px rgba(166, 255, 61, 0.35);
        opacity: 1;
        pointer-events: none;
        z-index: 10;
      }

      .semantic-layer {
        position: absolute;
        inset: 0;
        width: 1080px;
        height: 1920px;
        pointer-events: none;
        z-index: 2;
      }

      .semantic-scene {
        position: absolute;
        opacity: 0;
        --sc: #a6ff3d;
        --sc-rgb: 166,255,61;
        color: var(--sc);
        text-transform: uppercase;
        letter-spacing: 0;
        text-shadow: 0 0 16px rgba(166, 255, 61, 0.54), 0 8px 22px rgba(0, 0, 0, 0.75);
        will-change: opacity, transform;
      }

      .vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%);
        pointer-events: none;
        z-index: 1;
      }

      .hook-dim {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.62);
        opacity: 0;
        pointer-events: none;
        z-index: 4;
      }

      .opening-hook {
        position: absolute;
        left: 40px;
        top: 820px;
        width: 1000px;
        opacity: 0;
        pointer-events: none;
        z-index: 6;
        text-transform: uppercase;
        letter-spacing: 0;
        text-align: center;
        text-shadow: 0 12px 28px rgba(0, 0, 0, 0.9), 0 0 22px rgba(166, 255, 61, 0.26);
      }

      .hook-kicker {
        display: inline-block;
        margin-bottom: 18px;
        padding: 7px 16px;
        border: 2px solid rgba(166, 255, 61, 0.7);
        background: rgba(0, 0, 0, 0.68);
        color: #a6ff3d;
        border-radius: 8px;
        font-size: 22px;
        font-weight: 900;
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.28);
        white-space: nowrap;
      }

      .hook-title {
        color: #ffffff;
        font-size: 44px;
        font-weight: 900;
        line-height: 1.38;
        max-width: 1000px;
        margin: 0 auto 18px;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: break-word;
        text-shadow:
          0 10px 24px rgba(0, 0, 0, 0.92),
          0 0 16px rgba(255, 255, 255, 0.25),
          0 0 26px rgba(166, 255, 61, 0.18);
      }

      .hook-punch {
        max-width: 860px;
        margin: 0 auto;
        color: #a6ff3d;
        font-size: 30px;
        font-weight: 900;
        line-height: 1.45;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: break-word;
      }

      .scene-timeline {
        left: 112px;
        top: 1238px;
        width: 590px;
        height: 150px;
      }

      .scene-timeline.variant-1 {
        top: 1240px;
        left: 112px;
      }

      .scene-timeline.variant-2 {
        top: 1240px;
        left: 112px;
      }

      .scene-rail {
        position: absolute;
        left: 0;
        top: 18px;
        width: 450px;
        height: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        overflow: visible;
      }

      .scene-rail-fill {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background: #a6ff3d;
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.78);
      }

      .scene-rail-node {
        position: absolute;
        top: -8px;
        left: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 28px rgba(166, 255, 61, 0.9);
      }

      .scene-footsteps {
        position: absolute;
        left: 28px;
        top: 46px;
        width: 430px;
        height: 70px;
      }

      .scene-foot,
      .pace-foot {
        position: absolute;
        width: 26px;
        height: 15px;
        border: 3px solid rgba(166, 255, 61, 0.85);
        border-radius: 50%;
        transform: rotate(-12deg);
        box-shadow: 0 0 15px rgba(166, 255, 61, 0.5);
      }

      .foot-1,
      .foot-3,
      .foot-5,
      .foot-7 {
        top: 0;
        transform: rotate(-16deg);
      }

      .foot-2,
      .foot-4,
      .foot-6,
      .foot-8 {
        top: 28px;
        transform: rotate(16deg);
      }

      .foot-1 { left: 0; }
      .foot-2 { left: 42px; }
      .foot-3 { left: 92px; }
      .foot-4 { left: 134px; }
      .foot-5 { left: 184px; }
      .foot-6 { left: 226px; }
      .foot-7 { left: 276px; }
      .foot-8 { left: 318px; }

      .semantic-minimum_time .scene-rail {
        width: 315px;
      }

      .semantic-minimum_time .foot-5,
      .semantic-minimum_time .foot-6,
      .semantic-minimum_time .foot-7,
      .semantic-minimum_time .foot-8 {
        display: none;
      }

      .semantic-optimal_time .scene-rail {
        width: 525px;
      }

      .scene-transport {
        left: 112px;
        top: 1118px;
        width: 500px;
        height: 118px;
      }

      .scene-cell {
        position: absolute;
        right: 0;
        top: 2px;
        width: 118px;
        height: 82px;
      }

      .cell-core {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 3px solid rgba(166, 255, 61, 0.46);
        background: radial-gradient(circle, rgba(166, 255, 61, 0.18), rgba(166, 255, 61, 0.02) 62%, rgba(0, 0, 0, 0));
        box-shadow: 0 0 44px rgba(166, 255, 61, 0.34);
      }

      .cell-label {
        position: absolute;
        left: 54px;
        top: 76px;
        font-size: 24px;
        font-weight: 900;
      }

      .transport-stream {
        position: absolute;
        left: 18px;
        top: 38px;
        width: 310px;
        height: 28px;
      }

      .sugar-dot {
        position: absolute;
        left: 0;
        top: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.86);
      }

      .glut4-gate {
        position: absolute;
        left: 326px;
        top: 28px;
        width: 22px;
        height: 42px;
        padding: 0;
        border-radius: 10px;
        border: 2px solid rgba(166, 255, 61, 0.64);
        background: rgba(0, 0, 0, 0.56);
        font-size: 0;
      }

      .scene-carb {
        left: 112px;
        top: 1118px;
        width: 470px;
        height: 116px;
      }

      .carb-source,
      .carb-target {
        position: absolute;
        top: 22px;
        width: 70px;
        height: 46px;
        padding: 0;
        border-radius: 18px;
        border: 2px solid rgba(166, 255, 61, 0.56);
        background: rgba(0, 0, 0, 0.48);
      }

      .carb-source {
        left: 0;
      }

      .carb-target {
        right: 0;
      }

      .carb-flow {
        position: absolute;
        left: 118px;
        top: 42px;
        width: 220px;
        display: flex;
        justify-content: space-between;
      }

      .carb-flow span {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.72);
      }

      .scene-gel,
      .scene-satiety {
        left: 112px;
        top: 1118px;
        width: 500px;
        height: 126px;
      }

      .gel-core {
        position: absolute;
        left: 210px;
        top: 18px;
        width: 96px;
        height: 82px;
        border-radius: 46% 54% 50% 50%;
        border: 3px solid rgba(166, 255, 61, 0.64);
        background: radial-gradient(circle at 50% 50%, rgba(166, 255, 61, 0.22), rgba(166, 255, 61, 0.06) 64%, rgba(0, 0, 0, 0.18));
        box-shadow: 0 0 36px rgba(166, 255, 61, 0.42);
      }

      .gel-ring {
        position: absolute;
        left: 196px;
        top: 4px;
        width: 124px;
        height: 108px;
        border-radius: 50%;
        border: 2px solid rgba(166, 255, 61, 0.32);
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.24);
      }

      .gr2 {
        left: 184px;
        top: -8px;
        width: 148px;
        height: 132px;
        opacity: 0.46;
      }

      .water-drop {
        position: absolute;
        left: 20px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.78);
      }

      .wd1 { top: 30px; }
      .wd2 { top: 60px; left: 58px; }
      .wd3 { top: 88px; left: 18px; }

      .gel-slow-line {
        position: absolute;
        left: 18px;
        top: 112px;
        width: 390px;
        height: 5px;
        border-radius: 999px;
        background: rgba(166, 255, 61, 0.13);
      }

      .gel-slow-line span {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(166, 255, 61, 0.92), rgba(166, 255, 61, 0.16));
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.48);
      }

      .satiety-meter {
        position: absolute;
        left: 18px;
        top: 56px;
        width: 330px;
        height: 10px;
        border-radius: 999px;
        background: rgba(166, 255, 61, 0.12);
        overflow: hidden;
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.16);
      }

      .satiety-meter span {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(166, 255, 61, 0.96), rgba(166, 255, 61, 0.38));
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.62);
      }

      .satiety-dot {
        position: absolute;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.76);
      }

      .st1 { left: 54px; top: 88px; }
      .st2 { left: 156px; top: 30px; }
      .st3 { left: 258px; top: 88px; }

      .satiety-check {
        position: absolute;
        left: 390px;
        top: 42px;
        width: 42px;
        height: 22px;
        border-left: 6px solid #a6ff3d;
        border-bottom: 6px solid #a6ff3d;
        transform: rotate(-45deg);
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.62);
      }

      .scene-benefit {
        left: 112px;
        top: 1118px;
        width: 470px;
        height: 118px;
      }

      .benefit-cell {
        position: absolute;
        right: 10px;
        top: 4px;
        width: 96px;
        height: 78px;
        border-radius: 50%;
        border: 3px solid rgba(166, 255, 61, 0.52);
        background: radial-gradient(circle, rgba(166, 255, 61, 0.16), rgba(166, 255, 61, 0.02) 64%, rgba(0, 0, 0, 0));
        box-shadow: 0 0 34px rgba(166, 255, 61, 0.34);
      }

      .benefit-flow {
        position: absolute;
        left: 18px;
        top: 36px;
        width: 290px;
        height: 26px;
      }

      .benefit-dot {
        position: absolute;
        left: 0;
        top: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.82);
      }

      .benefit-check {
        position: absolute;
        right: 44px;
        top: 34px;
        width: 32px;
        height: 17px;
        border-left: 5px solid #a6ff3d;
        border-bottom: 5px solid #a6ff3d;
        transform: rotate(-45deg);
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.6);
      }

      .receptor-track {
        position: absolute;
        left: 24px;
        top: 54px;
        width: 340px;
        height: 5px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(166, 255, 61, 0.92), rgba(166, 255, 61, 0.1));
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.48);
      }

      .receptor-signal {
        position: absolute;
        top: 44px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.82);
      }

      .rs1 { left: 24px; }
      .rs2 { left: 82px; }
      .rs3 { left: 140px; }

      .receptor-gate {
        position: absolute;
        top: 34px;
        width: 26px;
        height: 48px;
        border-radius: 12px;
        border: 3px solid rgba(166, 255, 61, 0.72);
        background: rgba(0, 0, 0, 0.36);
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.46);
      }

      .rg1 { left: 238px; }
      .rg2 { left: 292px; }
      .rg3 { left: 346px; }

      .sensitivity-arc {
        position: absolute;
        left: 42px;
        top: 16px;
        width: 230px;
        height: 96px;
        border-radius: 260px 260px 0 0;
        border: 5px solid rgba(166, 255, 61, 0.52);
        border-bottom: 0;
        box-shadow: 0 0 26px rgba(166, 255, 61, 0.36);
      }

      .sensitivity-needle {
        position: absolute;
        left: 150px;
        top: 42px;
        width: 5px;
        height: 70px;
        border-radius: 999px;
        background: #a6ff3d;
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.64);
      }

      .sensitivity-check {
        position: absolute;
        left: 342px;
        top: 42px;
        width: 38px;
        height: 20px;
        border-left: 5px solid #a6ff3d;
        border-bottom: 5px solid #a6ff3d;
        transform: rotate(-45deg);
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.6);
      }

      .stability-line {
        position: absolute;
        left: 22px;
        top: 52px;
        width: 310px;
        height: 24px;
      }

      .stability-line span {
        display: block;
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: #a6ff3d;
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.68);
      }

      .stability-dot {
        position: absolute;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.72);
      }

      .sd1 { left: 70px; top: 28px; }
      .sd2 { left: 164px; top: 72px; }
      .sd3 { left: 258px; top: 30px; }

      .scene-zone {
        left: 112px;
        top: 1228px;
        width: 540px;
        height: 160px;
      }

      .zone-arc {
        position: absolute;
        left: 80px;
        top: 12px;
        width: 300px;
        height: 130px;
        border-radius: 320px 320px 0 0;
        border: 5px solid rgba(166, 255, 61, 0.45);
        border-bottom: 0;
        box-shadow: 0 0 28px rgba(166, 255, 61, 0.36);
      }

      .zone-pulse {
        position: absolute;
        left: 198px;
        top: 58px;
        width: 72px;
        height: 72px;
        border-radius: 50%;
        background: rgba(166, 255, 61, 0.24);
        box-shadow: 0 0 32px rgba(166, 255, 61, 0.68);
      }

      .zone-label {
        position: absolute;
        top: 128px;
        font-size: 24px;
        font-weight: 900;
        opacity: 0.62;
      }

      .z1 { left: 70px; }
      .z2 { left: 218px; color: #a6ff3d; opacity: 1; }
      .z3 { left: 362px; }

      .scene-movement {
        left: 112px;
        top: 1240px;
        width: 560px;
        height: 130px;
      }

      .pace-line {
        position: absolute;
        left: 0;
        top: 44px;
        width: 430px;
        height: 5px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(166, 255, 61, 0.9), rgba(166, 255, 61, 0));
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.48);
      }

      .pace-foot {
        position: absolute;
        top: 72px;
      }

      .p1 { left: 40px; }
      .p2 { left: 138px; top: 94px; }
      .p3 { left: 236px; }
      .p4 { left: 334px; top: 94px; }

      .scene-warning {
        left: 112px;
        top: 1118px;
        width: 500px;
        height: 122px;
        color: #ff4b4b;
        text-shadow: 0 0 16px rgba(255, 75, 75, 0.56);
      }

      .warning-stomach {
        position: absolute;
        left: 0;
        top: 12px;
        width: 98px;
        height: 70px;
        border: 4px solid rgba(255, 75, 75, 0.72);
        border-radius: 42% 58% 50% 50%;
        box-shadow: 0 0 26px rgba(255, 75, 75, 0.42);
      }

      .warning-muscle {
        position: absolute;
        left: 354px;
        top: 24px;
        width: 118px;
        height: 58px;
        border-radius: 999px;
        border: 4px solid rgba(255, 75, 75, 0.72);
        box-shadow: 0 0 26px rgba(255, 75, 75, 0.42);
      }

      .blood-flow {
        position: absolute;
        left: 116px;
        top: 48px;
        width: 270px;
        height: 24px;
      }

      .blood-dot {
        position: absolute;
        left: 0;
        top: 0;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ff4b4b;
        box-shadow: 0 0 24px rgba(255, 75, 75, 0.8);
      }

      .warning-ring {
        position: absolute;
        right: 48px;
        top: 10px;
        width: 84px;
        height: 84px;
        border-radius: 50%;
        border: 4px solid rgba(255, 75, 75, 0.66);
        box-shadow: 0 0 36px rgba(255, 75, 75, 0.52);
      }

      .scene-metric {
        left: 112px;
        top: 1240px;
        width: 520px;
        height: 140px;
      }

      .metric-halo {
        position: absolute;
        left: 16px;
        top: 0;
        width: 118px;
        height: 118px;
        border-radius: 50%;
        border: 3px solid rgba(166, 255, 61, 0.46);
        box-shadow: 0 0 44px rgba(166, 255, 61, 0.42);
      }

      .metric-scan {
        position: absolute;
        left: 0;
        top: 42px;
        width: 390px;
        height: 3px;
        background: rgba(166, 255, 61, 0.86);
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.74);
      }

      /* ═══════════════════════════════════════════════════════════
         CARD BASE — Ghost / Transparent Overlay
         → Video visible through card (35-40% dim only)
         → Thin outline border — card "floats" on footage
         → No lottie icon cell — single column text layout
      ═══════════════════════════════════════════════════════════ */
      .card {
        position: absolute;
        top: ${LAYOUT.card.defaultTop}px;
        left: ${LAYOUT.card.infoLeft}px;
        width: ${LAYOUT.card.width}px;
        /* Ghost panel — video shows through, enough opacity for definition */
        background: rgba(0, 0, 0, 0.60);
        border-radius: 18px;
        border: 1.5px solid rgba(255,255,255,0.30);
        box-shadow:
          0 8px 40px rgba(0,0,0,0.55),
          inset 0 1px 0 rgba(255,255,255,0.10);
        display: flex;
        flex-direction: column;
        justify-content: center;
        opacity: 0;
        overflow: hidden;
        z-index: 3;
      }

      /* Top accent line — CNFI green brand identity, visible at video resolution */
      .card::before {
        content: "";
        position: absolute;
        left: 0; right: 0; top: 0;
        height: 3px;
        background: linear-gradient(
          to right,
          transparent 0%,
          rgba(166,255,61,0.7) 15%,
          rgba(166,255,61,1.0) 50%,
          rgba(166,255,61,0.7) 85%,
          transparent 100%
        );
        z-index: 4;
        border-radius: 18px 18px 0 0;
      }
      .card.card-warning::before {
        background: linear-gradient(
          to right,
          transparent 0%,
          rgba(255,68,68,0.7) 15%,
          rgba(255,68,68,1.0) 50%,
          rgba(255,68,68,0.7) 85%,
          transparent 100%
        );
      }
      /* Warning card: red tint border */
      .card.card-warning {
        border-color: rgba(255, 68, 68, 0.38);
        box-shadow:
          0 4px 32px rgba(0,0,0,0.38),
          0 0 24px rgba(255,68,68,0.08),
          inset 0 1px 0 rgba(255,255,255,0.06);
      }

      /* Action card: CNFI lime top line + border */
      .card.card-action::before {
        background: linear-gradient(
          to right,
          transparent 0%,
          rgba(154,195,59,0.7) 15%,
          rgba(154,195,59,1.0) 50%,
          rgba(154,195,59,0.7) 85%,
          transparent 100%
        );
      }
      .card.card-action {
        border-color: rgba(154, 195, 59, 0.35);
        box-shadow:
          0 4px 32px rgba(0,0,0,0.38),
          0 0 24px rgba(154,195,59,0.08),
          inset 0 1px 0 rgba(255,255,255,0.06);
      }

      /* ── INFO CARD — single column, ghost transparent, shrink to content ── */
      .card-info {
        height: auto;
        width: fit-content;      /* flex to content — no wasted empty space */
        min-width: 300px;        /* never collapse below 300px */
        max-width: ${LAYOUT.card.width}px;  /* cap at LAYOUT max */
        padding: 26px 32px 28px 32px;
        overflow: visible;       /* allow card-icon-float to extend outside card bounds */
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
      }
      /* Text area — full width of flexible card */
      .card-text {
        flex: 1;
        min-width: 0;
        width: 100%;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* Animation cell — legacy, not used */
      .card-lottie { display: none; }

      /* ── LOTTIE FLOAT ICON — TYB style: badge tại góc trên-phải của card ──
         Nằm TRONG card (inside), tràn ra ngoài nhờ card-info overflow:visible
         CSS right/top định vị chính xác — không cần getBoundingClientRect() */
      .card-icon-float {
        position: absolute;
        right:  -${Math.round(LAYOUT.card.lottieIconSize * 0.5)}px;
        top:    -${Math.round(LAYOUT.card.lottieIconSize * 0.5)}px;
        width:  ${LAYOUT.card.lottieIconSize}px;
        height: ${LAYOUT.card.lottieIconSize}px;
        overflow: visible;
        opacity: 0;
        z-index: 10;
        pointer-events: none;
        /* filter baked server-side vào inline style — brightness rule + glow
           getLottieIconFilter() tính 1 lần dựa trên avg luminance của fills */
      }
      /* card-has-icon: padding-right để title/body không bị icon đè */
      .card.card-has-icon .card-text {
        padding-right: 90px;
      }

      /* LIST cards */
      .card-list-progressive,
      .card-list-check {
        height: auto;
        min-height: ${LAYOUT.card.height}px;
        overflow: hidden;
      }
      .card-list-slam {
        height: auto;
        overflow: visible;
      }

      /* Divider — spacing only, không dùng line cứng */
      .card-divider {
        width: 100%;
        height: 0;
        margin: 8px 0;
      }
      .card-divider-fill { display: none; }

      .card-stat {
        position: absolute;
        top: ${LAYOUT.card.statTop}px;
        left: ${LAYOUT.card.statLeft}px;
        width: ${LAYOUT.card.statWidth}px;
        min-height: ${LAYOUT.card.statMinHeight}px;
        border-radius: 0;
        background: linear-gradient(
          90deg,
          rgba(0, 0, 0, 0.88) 0%,
          rgba(0, 0, 0, 0.82) 55%,
          rgba(0, 0, 0, 0) 100%
        );
        padding: 30px 46px 28px 20px;
        display: flex;
        align-items: stretch;
        opacity: 0;
        overflow: visible;
        z-index: 3;
      }

      .card-stat::before {
        content: "";
        position: absolute;
        inset: 0;
        background: radial-gradient(
          ellipse at 8% 50%,
          rgba(166, 255, 61, 0.07) 0%,
          rgba(166, 255, 61, 0) 60%
        );
        pointer-events: none;
      }

      .stat-neon-bar {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: rgba(166,255,61,0.55);
        border-radius: 0;
        z-index: 4;
      }

      .stat-content {
        position: relative;
        z-index: 3;
        display: flex;
        flex-direction: column;
        justify-content: center;
        width: 100%;
      }

      .stat-value {
        display: block;
        height: auto;
        max-width: 810px;
        color: #ffffff;
        font-size: 106px;
        font-weight: 900;
        line-height: 1;
        letter-spacing: 0;
        font-variant-numeric: tabular-nums;
        text-shadow: 0 9px 24px rgba(0, 0, 0, 0.92), 0 0 22px rgba(255, 255, 255, 0.12);
        white-space: nowrap;
        overflow: visible;
      }

      .card-stat.stat-medium .stat-value {
        font-size: 88px;
      }

      .card-stat.stat-compact .stat-value {
        font-size: 74px;
      }

      .digit-window {
        display: inline-flex;
        align-items: flex-start;
        width: 0.78em;
        height: 1.1em;
        overflow: hidden;
        vertical-align: bottom;
      }

      .digit-reel {
        display: flex;
        flex-direction: column;
        flex: 0 0 auto;
        height: auto;
        will-change: transform;
      }

      .digit-cell {
        display: block;
        flex: 0 0 1.1em;
        width: 0.78em;
        height: 1.1em;
        line-height: 1.06;
        text-align: center;
      }

      .stat-static {
        display: inline-block;
        height: 1.1em;
        line-height: 1.06;
      }

      .stat-space {
        width: 0.28em;
      }

      .stat-divider {
        width: 320px;
        height: 7px;
        margin-top: 18px;
        margin-bottom: 16px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        overflow: hidden;
      }

      .stat-divider-fill {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background: #a6ff3d;
        box-shadow: 0 0 14px rgba(166, 255, 61, 0.82), 0 0 30px rgba(166, 255, 61, 0.35);
      }

      .stat-label {
        max-width: 790px;
        color: rgba(238, 243, 240, 0.9);
        font-size: 30px;
        font-weight: 800;
        line-height: 1.16;
        letter-spacing: 0;
        text-transform: uppercase;
        white-space: normal;
        overflow-wrap: break-word;
        text-shadow: 0 5px 16px rgba(0, 0, 0, 0.82);
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }

      /* ── BADGE — full pill, semi-transparent glass style ── */
      .badge {
        font-size: 15px;
        font-weight: 800;
        padding: 4px 14px;
        border-radius: 9999px;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        flex-shrink: 0;
      }

      .warning-badge {
        background: rgba(255, 68, 68, 0.18);
        color: #ff7b7b;
        border: 1px solid rgba(255, 68, 68, 0.32);
        box-shadow: 0 0 12px rgba(255,68,68,0.15);
      }

      .success-badge {
        background: rgba(166, 255, 61, 0.14);
        color: #a6ff3d;
        border: 1px solid rgba(166, 255, 61, 0.28);
        box-shadow: 0 0 12px rgba(166,255,61,0.12);
      }

      /* ── TITLE — dominates the card, no question who's boss ── */
      .card-title {
        font-size: ${LAYOUT.card.titleFontSize}px;
        font-weight: 900;
        color: rgba(255, 255, 255, 1.0);
        text-transform: uppercase;
        letter-spacing: 1.2px;
        line-height: 1.08;
        text-shadow:
          0 2px 6px rgba(0,0,0,0.95),
          0 4px 18px rgba(0,0,0,0.80);
      }

      /* Warning card: title đỏ — override trắng mặc định */
      .card.card-warning .card-title {
        color: #ff6b6b;
        text-shadow:
          0 2px 6px rgba(0,0,0,0.95),
          0 4px 18px rgba(0,0,0,0.80),
          0 0 22px rgba(255,68,68,0.28);
      }

      /* ── BODY — supporting detail, clearly subordinate to title ── */
      .card-body {
        font-size: ${LAYOUT.card.bodyFontSize}px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.78);
        line-height: 1.38;
        letter-spacing: 0.2px;
        text-shadow:
          0 1px 3px rgba(0,0,0,0.9),
          0 2px 10px rgba(0,0,0,0.65);
      }

      /* ── LIST STYLES ────────────────────────────────────────────── */
      .card-list-progressive {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 18px;
        padding: 20px 24px;
      }
      .list-num {
        flex: 0 0 58px;
        height: 58px;
        border-radius: 50%;
        background: #a6ff3d;
        color: #0a0a0a;
        font-size: 28px;
        font-weight: 900;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 18px rgba(166,255,61,0.6);
        flex-shrink: 0;
      }
      .card-warning .list-num {
        background: #ff4b4b;
        box-shadow: 0 0 18px rgba(255,75,75,0.6);
      }
      .list-content { flex: 1; min-width: 0; }
      .list-header {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 6px;
      }
      .list-title {
        font-size: ${LAYOUT.card.listTitleFontSize}px;
        font-weight: 900;
        color: #ffffff;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        line-height: 1.25;
      }
      .list-progress {
        font-size: 18px;
        font-weight: 700;
        color: rgba(166,255,61,0.7);
        white-space: nowrap;
      }
      .list-detail {
        font-size: ${LAYOUT.card.listDetailFontSize}px;
        font-weight: 700;
        color: rgba(255,255,255,0.82);
        line-height: 1.35;
      }

      /* number slam */
      .card-list-slam {
        text-align: center;
        padding: 22px 28px 18px;
        align-items: center;
      }
      .slam-num {
        font-size: 96px;
        font-weight: 900;
        color: #ffffff;
        line-height: 1;
        letter-spacing: -4px;
        text-shadow: 0 0 30px rgba(166,255,61,0.5), 0 8px 24px rgba(0,0,0,0.9);
      }
      .slam-sup {
        font-size: 36px;
        font-weight: 700;
        color: rgba(166,255,61,0.8);
        vertical-align: super;
        letter-spacing: 0;
      }
      .slam-title {
        font-size: ${LAYOUT.card.listTitleFontSize}px;
        font-weight: 900;
        color: #a6ff3d;
        text-transform: uppercase;
        margin-top: 6px;
        letter-spacing: 1px;
      }
      .slam-detail {
        font-size: ${LAYOUT.card.listDetailFontSize}px;
        font-weight: 700;
        color: rgba(255,255,255,0.8);
        margin-top: 6px;
        line-height: 1.3;
      }

      /* checklist */
      .card-list-check {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 16px;
        padding: 18px 22px;
      }
      .check-icon {
        flex: 0 0 48px;
        height: 48px;
        border-radius: 10px;
        font-size: 26px;
        font-weight: 900;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .check-yes {
        background: rgba(166,255,61,0.18);
        color: #a6ff3d;
        border: 2px solid rgba(166,255,61,0.6);
        box-shadow: 0 0 12px rgba(166,255,61,0.3);
      }
      .check-no {
        background: rgba(255,75,75,0.18);
        color: #ff4b4b;
        border: 2px solid rgba(255,75,75,0.6);
        box-shadow: 0 0 12px rgba(255,75,75,0.3);
      }

      .subtitle-container {
        position: absolute;
        top: ${LAYOUT.subtitle.top}px;
        left: ${LAYOUT.subtitle.left}px;
        width: ${LAYOUT.subtitle.width}px;
        height: ${LAYOUT.subtitle.height}px;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        pointer-events: none;
      }

      /* ── Render-context sentence base — NO border (matches first style block) ── */
      .sentence {
        position: absolute;
        width: auto;
        max-width: 960px;
        display: inline-flex;
        flex-wrap: nowrap;
        justify-content: center;
        align-items: center;
        gap: 0 10px;
        opacity: 0;
        background: rgba(0, 0, 0, 0.72);
        border: none;
        border-radius: 12px;
        padding: 10px 20px;
        left: 50%;
        transform: translateX(-50%);
        overflow: visible;
      }

      .word {
        display: inline-block;
        font-size: ${LAYOUT.subtitle.normalFontSize}px;
        font-weight: 800;
        color: rgba(255, 255, 255, 0.5);
        opacity: 1;
        transform: scale(1);
        text-transform: none;   /* chữ thường — TYB style */
        letter-spacing: 0;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
        white-space: nowrap;
        transform-origin: center center;
        will-change: transform, color;
      }

      /* ── Peak subtitle overrides (must come AFTER .sentence redefinition) ──
         Use !important to guarantee these always win over base .sentence cascade */
      .sentence-peak {
        background: none !important; border: none !important; border-radius: 0 !important;
        padding: 2px 0 !important; flex-direction: column !important;
        align-items: flex-start !important; gap: 0 !important;
        flex-wrap: nowrap !important; max-width: ${LAYOUT.subtitle.width}px !important;
      }
      .peak-chunk {
        display: flex !important; flex-wrap: nowrap !important;
        justify-content: flex-start !important; align-items: flex-start !important;
        gap: 0 6px !important; line-height: 0.9 !important;
        margin-bottom: 2px !important;
      }
      .peak-chunk-connector .word {
        font-size: ${LAYOUT.subtitle.peakConnectorSize}px !important;
        font-weight: 600 !important; color: rgba(255,255,255,0.50) !important;
        text-shadow: 0 2px 8px rgba(0,0,0,0.9) !important; white-space: nowrap !important;
      }
      .peak-chunk-regular .word {
        font-size: ${LAYOUT.subtitle.peakRegularSize}px !important;
        font-weight: 700 !important; color: rgba(255,255,255,0.82) !important;
        letter-spacing: -0.2px !important;
        text-shadow: 0 2px 10px rgba(0,0,0,0.95), 0 4px 18px rgba(0,0,0,0.70) !important;
        white-space: nowrap !important;
      }
      .peak-chunk-anchor .word {
        font-size: ${LAYOUT.subtitle.peakAnchorSize}px !important;
        font-weight: 900 !important; color: rgba(255,255,255,1.0) !important;
        letter-spacing: -0.5px !important;
        text-shadow:
          0 2px 18px rgba(0,0,0,1.0),
          0 5px 32px rgba(0,0,0,0.90),
          0 0 48px rgba(255,255,255,0.18) !important;
        white-space: nowrap !important;
      }
      .peak-chunk-script .word {
        font-family: '${LAYOUT.subtitle.peakScriptClimaxFont}', cursive !important;
        font-size: ${LAYOUT.subtitle.peakScriptSize}px !important;
        font-weight: normal !important; font-style: normal !important;
        color: rgba(154,195,59,0.82) !important; letter-spacing: 0.02em !important;
        text-shadow: 0 2px 12px rgba(0,0,0,0.95), 0 0 20px rgba(154,195,59,0.25) !important;
        white-space: nowrap !important;
      }
      .peak-chunk-script-climax .word, .peak-chunk-script-climax .word-peak-key {
        font-family: '${LAYOUT.subtitle.peakScriptClimaxFont}', cursive !important;
        font-size: ${LAYOUT.subtitle.peakScriptClimaxSize}px !important;
        font-weight: normal !important; font-style: normal !important;
        color: #C4F040 !important; letter-spacing: 0.04em !important;
        margin-right: 0.15em !important;
        line-height: ${LAYOUT.subtitle.peakScriptClimaxLineHeight} !important;
        -webkit-text-stroke: 1.5px #C4F040 !important;
        text-shadow: 0 0 20px rgba(196,240,64,0.90), 0 0 40px rgba(196,240,64,0.55), 0 3px 14px rgba(0,0,0,0.98) !important;
        white-space: nowrap !important;
      }

      ${getPatternCSS()}
      ${getMetricCSS()}

      /* .visual-row và .lottie-cell đã được xoá — animation nằm trong .card-lottie */

      /* ── GAP IMAGE OVERLAY ───────────────────────────────── */
      .gap-img-wrap {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        z-index: 4;
      }
      .gap-img-bg { display: none; }
      .gap-img-wrap img {
        position: relative;
        max-width: 68%;
        max-height: 52%;
        object-fit: contain;
        border-radius: 20px;
        border: 2px solid rgba(166, 255, 61, 0.5);
        box-shadow: 0 0 60px rgba(166, 255, 61, 0.22), 0 0 120px rgba(0,0,0,0.8);
        background: rgba(20, 30, 20, 0.85);
        mix-blend-mode: normal !important;
        filter: none !important;
        padding: 20px;
        box-sizing: border-box;
      }
    </style>
  </head>
  <body>
    <!-- Preload DVN Grandy: force browser to fetch hero font before first frame -->
    <div style="position:absolute;opacity:0;pointer-events:none;font-family:'${LAYOUT.subtitle.peakScriptClimaxFont}';font-size:90px;top:-9999px;left:-9999px;" aria-hidden="true">preload</div>
        <div
      id="root"
      data-composition-id="elegant-maxwell"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="1080"
      data-height="1920"
    >
      <div class="global-neon-rail"></div>
      <div class="vignette" aria-hidden="true"></div>
      ${hookDimHtml}
      ${hookHtml}

      <!-- Overlay clip zone: static clip-path giữ tất cả cards/vr không vượt qua neon bar -->
      <div id="overlay-clip" style="position:absolute;inset:0;pointer-events:none;z-index:3;clip-path:inset(0px 0px 0px ${LAYOUT.card.introX < 0 ? LAYOUT.card.neonBarLeft : 0}px);">

      ${visualRowsHtml}

      ${imageGapSegments.map((seg, i) => {
        const entry = assetMap.get(seg.image_key);
        if (!entry) return '';
        const src = entry.path.replace(/\\/g, '/');
        return `<div class="gap-img-wrap" id="gap-img-${i}" aria-hidden="true"><div class="gap-img-bg"></div><img src="${src}" style="${buildImageStyle(entry, 'border-radius:16px;')}" alt=""></div>`;
      }).join('')}

      <div class="card-container">
        ${cardsHtml}
      </div>

      </div><!-- /overlay-clip -->

      <!-- Brand watermark — top-center, ngoài overlay-clip để không bị clip-path cắt -->
      <div style="
        position:absolute;top:44px;left:50%;transform:translateX(-50%);z-index:99;pointer-events:none;
        display:flex;flex-direction:column;align-items:center;gap:0;
        background:rgba(0,0,0,0.32);padding:7px 14px 9px 14px;
        border-radius:6px;backdrop-filter:blur(2px);
      ">
        <div style="
          font-family:'Be Vietnam Pro',sans-serif;font-size:10px;font-weight:700;
          letter-spacing:0.16em;color:#9AC33B;white-space:nowrap;line-height:1;margin-bottom:2px;
        ">CONDITIONING &amp; NUTRITION FATLOSS</div>
        <div style="
          font-family:'Be Vietnam Pro',sans-serif;font-size:38px;font-weight:900;
          color:#ffffff;letter-spacing:-0.02em;line-height:0.88;
          text-shadow:0 2px 8px rgba(0,0,0,0.5);
        ">CNFI</div>
        <div style="width:100%;height:2px;background:#9AC33B;margin-top:5px;border-radius:1px;"></div>
      </div>

      <div class="subtitle-container">
        ${subtitlesHtml}
      </div>
    </div>

    <script>
      /* Inline Lottie animation data — keyed by cardId ("card-0", "card-1", ...) */
      window.__lottieData = ${JSON.stringify(lottieDataMap)};
    </script>
    <script>
      ${gsapCode}
    </script>
  </body>
</html>`;
}

async function applyRuntimeVisualPatches(page) {
  await page.addStyleTag({
    content: `
      #root .global-neon-rail {
        position: absolute !important;
        left: 70px !important;
        top: 980px !important;
        width: 3px !important;
        height: 520px !important;
        background: linear-gradient(
          180deg,
          rgba(166, 255, 61, 0) 0%,
          rgba(166, 255, 61, 0.5) 8%,
          rgba(166, 255, 61, 0.5) 92%,
          rgba(166, 255, 61, 0) 100%
        ) !important;
        opacity: 1 !important;
        pointer-events: none !important;
        z-index: 10 !important;
      }
      #root .semantic-layer {
        position: absolute !important;
        inset: 0 !important;
        pointer-events: none !important;
        z-index: 2 !important;
      }
      #root .card-container {
        z-index: 3 !important;
      }
      #root .card-stat {
        overflow: visible !important;
        z-index: 4 !important;
        left: ${LAYOUT.card.statLeft}px !important;
        border-radius: 0 !important;
        padding-left: 20px !important;
      }
      #root .card-stat .stat-neon-bar {
        left: 0 !important;
        width: 5px !important;
        border-radius: 0 !important;
        box-shadow: 0 0 10px #a6ff3d, 0 0 28px rgba(166, 255, 61, 0.9), 0 0 60px rgba(166, 255, 61, 0.5) !important;
        z-index: 4 !important;
      }
      #root .card {
        left: ${LAYOUT.card.infoLeft}px !important;
      }
      #root .stat-value,
      #root .stat-number {
        display: block !important;
        height: auto !important;
        line-height: 1 !important;
        overflow: visible !important;
        white-space: nowrap !important;
        letter-spacing: 0 !important;
      }
      #root .sentence {
        gap: 12px !important;
        word-spacing: 0 !important;
      }
      #root .word {
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        transform-origin: center center !important;
      }
      /* anchor: word gap — 116px cần spacing rõ hơn để từ không dính nhau */
      #root .peak-chunk-anchor .word {
        margin-right: 0.09em !important;
      }
      /* script_climax: restore word gap — specificity #root .peak-chunk-script-climax .word = 120 > 110 */
      #root .peak-chunk-script-climax .word,
      #root .peak-chunk-script-climax .word-peak-key {
        margin-right: 0.15em !important;
      }
      /* Đảm bảo gap hoạt động đúng — CHỈ áp cho peak, không ảnh hưởng normal sentence wrap */
      #root .subtitle-container .sentence-peak {
        display: flex !important;
        flex-wrap: nowrap !important;
        flex-direction: column !important;
      }
    `
  });

  await page.evaluate(() => {
    const root = document.getElementById("root");
    if (root && !root.querySelector(".global-neon-rail")) {
      const rail = document.createElement("div");
      rail.className = "global-neon-rail";
      root.insertBefore(rail, root.firstChild);
    }

    // ── Tetris horizontal positioning for script_climax ──────────────────────
    // Đo chiều rộng thực tế của các chunk phía trên script_climax,
    // sau đó dịch ngang script_climax để lấp khoảng trống — giống TYB.
    // Logic: script_climax.paddingLeft = max right-edge của chunk trước nó
    //        (clamped để không overflow sentence width)
    document.querySelectorAll('.sentence-peak').forEach(sentEl => {
      const climaxEl = sentEl.querySelector('.peak-chunk-script-climax');
      if (!climaxEl) return;

      const chunks = Array.from(sentEl.querySelectorAll('.peak-chunk'));
      const climaxIdx = chunks.indexOf(climaxEl);
      if (climaxIdx <= 0) return; // đã ở đầu → không cần dịch

      const sentRect = sentEl.getBoundingClientRect();

      // Tìm right-edge xa nhất trong các chunk PHÍA TRÊN script_climax
      let maxRight = 0;
      for (let i = 0; i < climaxIdx; i++) {
        const r = chunks[i].getBoundingClientRect();
        const rightRel = r.right - sentRect.left;
        if (rightRel > maxRight) maxRight = rightRel;
      }

      // Lấy chiều rộng hiện tại của script_climax (trước khi dịch)
      let climaxRect = climaxEl.getBoundingClientRect();
      let climaxWidth = climaxRect.width;

      // ── Auto-scale sc font-size nếu text quá rộng để fit container ───────────
      // Scalable: đo actual rendered width, scale xuống tỷ lệ — không hardcode ngưỡng.
      // Áp dụng trước khi tính indent để maxAllowedLeft dùng climaxWidth đúng.
      const sentWidth = sentRect.width;
      const _scMargin = 16; // px safety margin trái+phải
      if (climaxWidth > sentWidth - _scMargin) {
        const _scaleFactor = (sentWidth - _scMargin) / climaxWidth;
        climaxEl.querySelectorAll('.word, .word-peak-key').forEach(w => {
          const _cur = parseFloat(window.getComputedStyle(w).fontSize);
          w.style.setProperty('font-size', Math.floor(_cur * _scaleFactor) + 'px', 'important');
        });
        // Re-measure sau khi scale để indent calc dùng đúng width
        climaxRect = climaxEl.getBoundingClientRect();
        climaxWidth = climaxRect.width;
      }
      // ─────────────────────────────────────────────────────────────────────────

      // Clamp: không được vượt quá sentence width trừ chiều rộng chunk
      const maxAllowedLeft = Math.max(0, sentWidth - climaxWidth - 8);
      const targetLeft = Math.min(maxRight, maxAllowedLeft);

      // Chỉ áp nếu targetLeft > cascade indent hiện tại (không thu hẹp)
      const existingPL = parseFloat(climaxEl.style.paddingLeft) || 0;
      if (targetLeft > existingPL) {
        climaxEl.style.paddingLeft = targetLeft + 'px';
      }
    });
    // ─────────────────────────────────────────────────────────────────────────
  });
}

// -------------------------------------------------------------
// 5. Orchestration Pipeline Flow
// -------------------------------------------------------------
// opts: { srtPath, videoPath, outputPath, skipGemini, noexit }
// In batch mode, caller sets srtPath/videoPath/outputPath globals before calling.
// noexit=true → throw on error instead of process.exit(1) so batch can continue.
async function runPipeline(opts = {}) {
  // batch-mode: override globals with per-job values
  if (opts.srtPath    != null) srtPath    = opts.srtPath;
  if (opts.videoPath  != null) videoPath  = opts.videoPath;
  if (opts.outputPath != null) outputPath = opts.outputPath;
  if (opts.skipGemini != null) skipGemini = opts.skipGemini;

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

    if (skipGemini) {
      const cacheFilePath = path.resolve('_gemini_cache.json');
      if (fs.existsSync(cacheFilePath)) {
        logStep("--skip-gemini: Found _gemini_cache.json → loading cached data and regenerating HTML...");
        const cached = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
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
        // ── Không có cache: dùng index.html sẵn có ──────────────────────────
        logStep("--skip-gemini: No _gemini_cache.json found. Using existing index.html...");
        if (!fs.existsSync(compositionHtmlPath)) {
          throw new Error(`No index.html and no _gemini_cache.json. Run without --skip-gemini first.`);
        }
        const htmlContent = fs.readFileSync(compositionHtmlPath, 'utf-8');
        const durationMatch = htmlContent.match(/data-duration=["'](\d+(?:\.\d+)?)["']/);
        if (durationMatch && durationMatch[1]) {
          totalDuration = Math.ceil(parseFloat(durationMatch[1]) + 0.5);
        }
        logSuccess(`Using existing index.html. Duration: ${totalDuration}s`);
      }
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
          fs.writeFileSync(
            path.resolve('_gemini_cache.json'),
            JSON.stringify({
              sentences:     semanticOutput.sentences,
              overlays:      semanticOutput.overlays,
              totalDuration,
              hook:          geminiOutput.hook || null,
              broll_schedule: geminiOutput.broll_schedule || [], // save schedule too!
            }, null, 2),
            'utf-8'
          );
          logSuccess('Gemini output cached → _gemini_cache.json (--skip-gemini sẽ regen HTML từ đây)');
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

    await applyRuntimeVisualPatches(page);
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
    logStep("Calling FFmpeg to composite transparent overlay PNG sequence directly on input video...");
    const framePattern = path.join(tempDir, 'frame_%05d.png');
    const brollSegs = brollSegments;
    const pngInputIdx = 1 + brollSegs.length;
    const { w: mainW, h: mainH } = getVideoDimensions(videoPath);
    const videoFps = getVideoFps(videoPath);
    logSuccess(`Main video: ${mainW}×${mainH} @ ${videoFps}fps`);
    const brollFilter = buildBrollFilter(brollSegs, pngInputIdx, mainW, mainH, videoFps);
    logStep("Measuring audio loudness for two-pass normalization...");
    const loudStats = measureLoudnormStats(videoPath);
    if (loudStats) {
      logSuccess(`Loudnorm measured: I=${loudStats.input_i} LUFS, LRA=${loudStats.input_lra}, TP=${loudStats.input_tp}`);
    } else {
      logWarning("Loudnorm measurement failed — falling back to single-pass.");
    }
    const loudnormFilter = loudStats
      ? `loudnorm=I=${AUDIO_LUFS_TARGET}:TP=${AUDIO_TRUE_PEAK_DB}:LRA=${AUDIO_LRA}:measured_i=${loudStats.input_i}:measured_lra=${loudStats.input_lra}:measured_tp=${loudStats.input_tp}:measured_thresh=${loudStats.input_thresh}:offset=${loudStats.target_offset}:linear=true`
      : `loudnorm=I=${AUDIO_LUFS_TARGET}:TP=${AUDIO_TRUE_PEAK_DB}:LRA=${AUDIO_LRA}`;
    const audioFilter = [
      `highpass=f=${AUDIO_HIGHPASS_HZ}`,
      `agate=threshold=${AUDIO_GATE_THRESHOLD}:attack=${AUDIO_GATE_ATTACK_MS}:release=${AUDIO_GATE_RELEASE_MS}:knee=2.828`,
      `afftdn=nf=${AUDIO_DENOISE_FLOOR}`,
      `equalizer=f=${AUDIO_EQ_MUD_HZ}:width_type=o:width=2:g=${AUDIO_EQ_MUD_GAIN}`,
      `equalizer=f=${AUDIO_EQ_DESS_HZ}:width_type=o:width=1.5:g=${AUDIO_EQ_DESS_GAIN}`,
      `equalizer=f=${AUDIO_EQ_PRESENCE_HZ}:width_type=o:width=2:g=${AUDIO_EQ_PRESENCE_GAIN}`,
      `equalizer=f=${AUDIO_EQ_AIR_HZ}:width_type=o:width=2:g=${AUDIO_EQ_AIR_GAIN}`,
      `acompressor=threshold=${AUDIO_COMP_THRESHOLD}dB:ratio=${AUDIO_COMP_RATIO}:attack=${AUDIO_COMP_ATTACK_MS}:release=${AUDIO_COMP_RELEASE_MS}:makeup=4`,
      loudnormFilter
    ].join(',');
    const ffmpegCmd = `ffmpeg -y -i "${videoPath}"${brollFilter.inputs} -framerate ${fps} -i "${framePattern}" -filter_complex "${brollFilter.filterStr}" -map "[outv]" -map 0:a? -c:v libx264 -pix_fmt yuv420p -c:a aac -af "${audioFilter}" "${outputPath}"`;
    console.log(`Running: ${ffmpegCmd}\n`);

    execSync(ffmpegCmd, { stdio: 'inherit' });
    logSuccess(`FFmpeg compositing complete!`);

    if (!hasAudioStream(outputPath)) {
      logWarning("Output video has no audio track. Injecting a silent audio track for compatibility...");
      const tempSilent = outputPath.replace(/\.mp4$/i, '_silent.mp4');
      const addSilentCmd = `ffmpeg -y -i "${outputPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v copy -c:a aac -shortest "${tempSilent}"`;
      try {
        execSync(addSilentCmd, { stdio: 'pipe' });
        fs.copyFileSync(tempSilent, outputPath);
        fs.rmSync(tempSilent, { force: true });
        logSuccess("Injecting silent audio track completed successfully!");
      } catch (err) {
        logError(`Failed to inject silent audio track: ${err.message}`);
      }
    }

    mixOverlaySfxIntoOutput(outputPath, sfxOverlayEvents);   // card SFX — content-driven
    addHookSfx(outputPath);                                   // hook SFX — t=0
    addBrollSfx(outputPath, brollSegments);                   // b-roll SFX — content-driven

    if (mainW !== 1080 || mainH !== 1920) {
      logStep("Normalizing video dimensions to standard 9:16 (1080x1920) for platform compatibility...");
      const scaleW = Math.round((mainW * 1920) / mainH);
      const evenScaleW = scaleW % 2 === 0 ? scaleW : scaleW - 1;
      const tempPadded = outputPath.replace(/\.mp4$/i, '_padded.mp4');
      const padCmd = `ffmpeg -y -i "${outputPath}" -vf "scale=${evenScaleW}:1920,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p -c:a copy "${tempPadded}"`;
      try {
        execSync(padCmd, { stdio: 'pipe' });
        fs.copyFileSync(tempPadded, outputPath);
        fs.rmSync(tempPadded, { force: true });
        logSuccess("Video dimensions normalized to 1080x1920 successfully!");
      } catch (err) {
        logError(`Failed to normalize video dimensions: ${err.message}`);
      }
    }

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
async function runBatch(bDir, oDir) {
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
      await runPipeline({ ...job, noexit: true });
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
if (batchDir) {
  const finalOutputDir = outputDir || path.join(batchDir, "output");
  runBatch(batchDir, finalOutputDir).catch(e => { console.error(e); process.exit(1); });
} else {
  runPipeline();
}
