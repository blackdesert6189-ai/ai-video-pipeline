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

// Dùng chung cho tất cả chỗ render ảnh — đổi filter ở PEXELS.imageFilter là đổi toàn bộ
function buildImageStyle(entry, extraStyle = '') {
  const base = `max-width:100%;max-height:100%;object-fit:contain;${extraStyle}`;
  // 'transparent' = ảnh đã được Remove.bg xóa nền → render trực tiếp, không cần blend
  if (!entry.blend_mode || entry.blend_mode === 'transparent') return base;
  return base + (PEXELS.imageFilter[entry.blend_mode] || '');
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
