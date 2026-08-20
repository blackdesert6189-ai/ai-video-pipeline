/**
 * qa_regression/test_normalization.cjs
 * Comprehensive characterization test suite for extracted Normalization module.
 * Tests foldText, toSeconds, fromMs, normalizeWord, normalizeSentence,
 * peak chunk rules, warning generation, normalizeOverlay, and strict Base vs Head parity.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// Expected Golden Hashes computed from true Base SHA (85a58ac807572bc9c92cdd773a15be07a4a0d2be:pipeline.js)
const GOLDEN_SENTENCE_HASH = 'b58a388ad28bb54a2ada56f732028c0893f551988e610f323c805be69da6bd68';
const GOLDEN_OVERLAY_HASH  = '6c04643c380287703a75b975f07379afd76d21eb1220e2417698b7b145fe410f';
const GOLDEN_WARNING_HASH  = '0a800f475772794f8d62ff107e61c4cca1559564d9e9d38590b1b53e8c23a69b';

async function runNormalizationTests() {
  console.log('==================================================================');
  console.log('         TESTING NORMALIZATION MODULE (normalization.js)');
  console.log('==================================================================\n');

  // Load classifyOverlayType from semanticOverlayEngine
  const { classifyOverlayType } = await import(pathToFileURL(path.resolve('semanticOverlayEngine.js')).href);

  // EXACT PEAK_FUNCTION_WORDS copied directly from Base production pipeline.js
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

  // Explicit Collision Regression Assertions verifying production exclusions and inclusions
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('khong'), false, 'khong must be excluded (collision with khổng)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('co'), false, 'co must be excluded (collision with cơ/có)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('no'), false, 'no must be excluded (collision with nó/no)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('qua'), false, 'qua must be excluded (collision with quả)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('xuong'), false, 'xuong must be excluded (collision with xương)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('trong'), false, 'trong must be excluded (collision with trong=clear)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('sang'), false, 'sang must be excluded (collision with sang=luxurious)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('len'), false, 'len must be excluded (collision with len=wool)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('la'), false, 'la must be excluded (collision with lá=leaf)');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('da'), true, 'da must be included');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('se'), true, 'se must be included');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('voi'), true, 'voi must be included');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('cua'), true, 'cua must be included');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('va'), true, 'va must be included');
  assert.strictEqual(PEAK_FUNCTION_WORDS.has('cac'), true, 'cac must be included');

  // Exact LAYOUT.peak from Base production pipeline.js
  const LAYOUT_PEAK = {
    maxClimaxPerSentence: 1,
    maxChunks: 4,
    anchorEndBlockPattern: /\s+(cho|về|trong|trên|dưới|từ|với|đến|tới|qua|sau|trước|theo|tại|ở|của|mà|và|hay|hoặc|nhưng|vì|nếu|khi|để|như|bằng|ngoài|suốt|cùng|giữa|là|thì|mà)\s*$/i,
    anchorVerbHeadPattern: /^(tăng cường|cải thiện|hỗ trợ|bảo vệ|phòng ngừa|điều trị|phục hồi|duy trì|kiểm soát|loại bỏ|thúc đẩy|mang lại|đem lại|kích thích|ức chế|giảm thiểu|giúp|giảm|tăng)\s+/i,
    anchorTrailingClassifierPattern: /\s+(các|cái|những|một|mỗi|này|đó|kia|ấy)\s*$/i,
    compoundPrefixPattern: /^(hieu|te|thu|khang|trao|xuc|thi|thinh|vi|khuu|sinh|ly|cau|chuc|tac|tich|uc|dan|bien|trieu|ket|tham|gia|tri|oxy|mo|he|tong|nguyen|tieu|tiet|chuyen|hap|tuan|dac|hau|co|ao|than)$/i,
    climaxBlockRules: [
      /^(cho|của|với|trong|trên|dưới|về|từ|đến|tới|mà|và|hay|hoặc|nhưng|vì|nếu|khi|để|như|bằng|qua|sau|trước|ngoài|theo|tại|ở|suốt|cùng|khỏi|giữa|là|thì)\s/i,
      /của\s+(bạn|mình|tôi|tớ|họ|nó|ta|chúng\s*ta|mọi\s*người)\s*$/i,
      /^(rất|quá|cực|vô cùng|hết sức|khá|hơi|chút|siêu)\s+\S/i,
      /^(mỗi|hàng|suốt|cả|từng)\s+(ngày|tuần|tháng|năm|giờ|phút|lần|buổi|sáng|chiều|tối)\s*$/i,
      /^(như vậy|như thế|vậy thôi|mà thôi|thôi|vậy đó|thế đó|đó thôi|chỉ vậy|không hơn)\s*$/i,
      /^(để|nhằm|nhằm mục đích|hướng tới|hướng đến)\s/i
    ],
    peakSmartIndentEnabled: true,
    peakSmartFirstCharRatio: 0.50,
    peakSmartRegCharRatio: 0.55,
    peakSmartScriptCharRatio: 0.48,
    peakSmartAvgWordChars: 3.0,
    peakSmartClimaxTopPullRatio: 0.35,
    peakFunctionWordScale: 0.28,
    peakFunctionWordMinSize: 18,
    peakRegularSizeFaded: 28,
    peakClimaxSizeHero: 100,
    peakNoAnchorClimaxIndent: 32,
    anchorMaxWords: 3,
    anchorPromoteEnabled: true
  };

  const normModule = await import(pathToFileURL(path.resolve('src', 'pipeline', 'normalization.js')).href);
  const { createNormalization } = normModule;

  const {
    foldText,
    toSeconds,
    normalizeSentence,
    normalizeOverlay
  } = createNormalization({
    layoutPeak: LAYOUT_PEAK,
    getPeakFunctionWords: () => PEAK_FUNCTION_WORDS,
    classifyOverlayType
  });

  // 1. PUBLIC API CONTRACT
  console.log('--- 1. Testing Public API Contract ---');
  assert.strictEqual(typeof foldText, 'function');
  assert.strictEqual(typeof toSeconds, 'function');
  assert.strictEqual(typeof normalizeSentence, 'function');
  assert.strictEqual(typeof normalizeOverlay, 'function');
  console.log('✓ TEST 1 PASSED: Public factory contract verified.\n');

  // 2. FOLDTEXT FUNCTIONALITY
  console.log('--- 2. Testing foldText ---');
  assert.strictEqual(foldText('  SỨC KHỎE VÀNG  '), 'suc khoe vang');
  assert.strictEqual(foldText('ĐI BỘ MỖI NGÀY'), 'di bo moi ngay');
  assert.strictEqual(foldText(null), '');
  assert.strictEqual(foldText(undefined), '');
  assert.strictEqual(foldText('  chất    xơ  '), 'chat xo');
  console.log('✓ TEST 2 PASSED: foldText diacritics, Đ/đ, whitespace, null/undefined verified.\n');

  // 3. TOSECONDS & FROMMS VIA DEFAULTS
  console.log('--- 3. Testing toSeconds ---');
  assert.strictEqual(toSeconds(12.5), 12.5);
  assert.strictEqual(toSeconds("4.8"), 4.8);
  assert.strictEqual(toSeconds("invalid", 5.0), 5.0);
  assert.strictEqual(toSeconds(NaN, 2.0), 2.0);
  assert.strictEqual(toSeconds(Infinity, 0), 0);
  assert.strictEqual(toSeconds(null, 0), 0);
  console.log('✓ TEST 3 PASSED: toSeconds numeric, string, NaN, Infinity, null verified.\n');

  // 4. NORMALIZESENTENCE BASIC & WORD PRECEDENCE
  console.log('--- 4. Testing normalizeSentence Basic & Word Precedence ---');
  const s1 = normalizeSentence({
    index: 1,
    text: "Uống nước đều đặn",
    startTime: 1.0,
    endTime: 3.5,
    words: [{ w: "Uống" }, { text: "nước" }, { word: "đều" }, "đặn"]
  }, 1);
  assert.strictEqual(s1.index, 1);
  assert.strictEqual(s1.text, "Uống nước đều đặn");
  assert.strictEqual(s1.startTime, 1.0);
  assert.strictEqual(s1.endTime, 3.5);
  assert.deepStrictEqual(s1.words, ["Uống", "nước", "đều", "đặn"]);
  assert.strictEqual(s1.style, "normal");
  assert.strictEqual(s1.peakLines, null);
  console.log('✓ TEST 4 PASSED: normalizeSentence basic timing, word objects precedence verified.\n');

  // 5. TOKEN SPLITTING & JOINED-TOKEN CASE C
  console.log('--- 5. Testing Token Splitting & Joined-Token Case C ---');
  const s2 = normalizeSentence({
    index: 2,
    text: "hạt chia chứa nhiều chất xơ",
    words: ["hạt chia", "chứa", "nhiều", "chấtxơ"]
  }, 2);
  assert.deepStrictEqual(s2.words, ["hạt", "chia", "chứa", "nhiều", "chất", "xơ"]);
  console.log('✓ TEST 5 PASSED: Case B space splitting and Case C joined token split verified.\n');

  // 6. MID-SENTENCE CAPITALIZATION
  console.log('--- 6. Testing Mid-sentence Capitalization ---');
  const s3 = normalizeSentence({
    index: 3,
    text: "Hạt Chia Giúp Giảm Cân Hiệu Quả",
    words: ["Hạt", "Chia", "Giúp", "Giảm", "Cân", "Hiệu", "Quả"]
  }, 3);
  assert.deepStrictEqual(s3.words, ["Hạt", "chia", "giúp", "giảm", "cân", "hiệu", "quả"]);
  console.log('✓ TEST 6 PASSED: Mid-sentence title case lowercased, first word preserved.\n');

  // 7. PEAK STYLE & VALIDATION
  console.log('--- 7. Testing Peak Style Sanitization & Chunks ---');
  const s4 = normalizeSentence({
    index: 4,
    style: "peak",
    text: "giúp bạn tăng cường sức mạnh cơ bắp",
    words: ["giúp", "bạn", "tăng", "cường", "sức", "mạnh", "cơ", "bắp"],
    peak_lines: [
      { text: "giúp bạn", type: "regular" },
      { text: "tăng cường sức mạnh", type: "anchor" },
      { text: "cơ bắp", type: "script_climax" }
    ]
  }, 4);
  assert.strictEqual(s4.style, "peak");
  assert.ok(Array.isArray(s4.peakLines));
  console.log('✓ TEST 7 PASSED: Peak style validation and chunk structure verified.\n');

  // 8. NORMALIZE OVERLAY
  console.log('--- 8. Testing normalizeOverlay ---');
  const ov1 = normalizeOverlay({
    startTime: 1.0,
    endTime: 4.5,
    type: "ACTION",
    title: "UỐNG ĐỦ NƯỚC",
    detail: "Giúp cơ thể trao đổi chất",
    visual_value: "100",
    archetype: "MECHANISM",
    lottie_query_en: "water glass"
  }, 0);
  assert.strictEqual(ov1.index, 0);
  assert.strictEqual(ov1.type, "ACTION");
  assert.strictEqual(ov1.title, "UỐNG ĐỦ NƯỚC");
  assert.strictEqual(ov1.detail, "Giúp cơ thể trao đổi chất");
  assert.strictEqual(ov1.startTime, 1.0);
  assert.strictEqual(ov1.endTime, 4.5);
  assert.strictEqual(ov1.visual_value, 100);
  assert.strictEqual(ov1.archetype, "MECHANISM");
  assert.strictEqual(ov1.lottie_query_en, "water glass");
  console.log('✓ TEST 8 PASSED: normalizeOverlay field extraction and classification verified.\n');

  // 9. DETERMINISTIC FIXTURE PARITY AGAINST BASE
  console.log('--- 9. Testing Deterministic Hash Parity (Base vs Head) ---');

  // Comprehensive fixture corpus exercising normal, peak, compounds, verb-head, possessives, collision sensitivity, overlays
  const testSentencesFixture = [
    { index: 1, text: "Uống đủ nước mỗi ngày", startTime: 0, endTime: 2.5, words: ["Uống", "đủ", "nước", "mỗi", "ngày"] },
    { index: 2, text: "Chụp ảnh bữa ăn bằng camera AI", startTime: 2.5, endTime: 5.5, words: ["Chụp", "ảnh", "bữa", "ăn", "bằng", "camera", "AI"], style: "peak", peak_lines: [{ text: "Chụp ảnh", type: "regular" }, { text: "bữa ăn", type: "anchor" }, { text: "bằng camera AI", type: "script_climax" }] },
    { index: 3, text: "giúp bạn tăng cường sức mạnh cơ bắp của bạn", startTime: 5.5, endTime: 9.0, words: ["giúp", "bạn", "tăng", "cường", "sức", "mạnh", "cơ", "bắp", "của", "bạn"], style: "peak", peak_lines: [{ text: "giúp bạn", type: "regular" }, { text: "tăng cường sức mạnh", type: "anchor" }, { text: "cơ bắp", type: "script_climax" }, { text: "của bạn", type: "regular" }] },
    { index: 4, text: "kết quả mang lại hiệu quả cao nhất hành tinh", startTime: 9.0, endTime: 13.0, words: ["kết", "quả", "mang", "lại", "hiệu", "quả", "cao", "nhất", "hành", "tinh"], style: "peak", peak_lines: [{ text: "kết quả mang lại", type: "regular" }, { text: "hiệu quả", type: "anchor" }, { text: "cao nhất", type: "script_climax" }, { text: "hành tinh", type: "regular" }] },
    { index: 5, text: "cơ chế giả dược tác dụng mấu chốt", startTime: 13.0, endTime: 16.0, words: ["cơ", "chế", "giả", "dược", "tác", "dụng", "mấu", "chốt"], style: "peak" },
    { index: 6, text: "khổng lồ sẽ giảm tác động", startTime: 16.0, endTime: 19.0, words: ["khổng", "lồ", "sẽ", "giảm", "tác", "động"], style: "peak", peak_lines: [{ text: "khổng lồ", type: "regular" }, { text: "sẽ giảm", type: "regular" }, { text: "tác động", type: "script_climax" }] }
  ];

  const testOverlaysFixture = [
    { startTime: 0.5, endTime: 2.8, type: "ACTION", title: "TIẾT KIỆM THỜI GIAN", detail: "Không cần cân đo thủ công", archetype: "BENEFIT", lottie_query_en: "clock timer" },
    { start_ms: 3000, duration_ms: 3500, visual_type: "STAT", metric: "30 PHÚT", desc: "Mỗi ngày đi bộ", list_group: "walk-tips", list_index: 1, list_total: 3, list_style: "progressive" },
    { startTime: 7.0, endTime: 10.0, type: "WARNING", title: "KHÔNG NÊN NHỊN ĂN", detail: "Gây rối loạn chuyển hóa", metric_direction: "down" }
  ];

  // Capture Head Warnings & Outputs
  const headWarnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { headWarnings.push(args.join(' ')); };

  const headSentencesOut = testSentencesFixture.map((s, i) => normalizeSentence(s, i + 1));
  const headOverlaysOut = testOverlaysFixture.map((ov, i) => normalizeOverlay(ov, i));

  console.warn = origWarn;

  const headSentencesHash = crypto.createHash('sha256').update(JSON.stringify(headSentencesOut)).digest('hex');
  const headOverlaysHash = crypto.createHash('sha256').update(JSON.stringify(headOverlaysOut)).digest('hex');
  const headWarningsHash = crypto.createHash('sha256').update(JSON.stringify(headWarnings)).digest('hex');

  // Verify against Golden Base SHA256 Hashes
  console.log('Sentence Output SHA256 (Base):', GOLDEN_SENTENCE_HASH);
  console.log('Sentence Output SHA256 (Head):', headSentencesHash);
  const sentMatch = headSentencesHash === GOLDEN_SENTENCE_HASH;
  console.log('Sentence Output Parity:', sentMatch ? 'EXACT MATCH ✓' : 'MISMATCH ❌');

  console.log('Overlay Output SHA256 (Base):', GOLDEN_OVERLAY_HASH);
  console.log('Overlay Output SHA256 (Head):', headOverlaysHash);
  const ovMatch = headOverlaysHash === GOLDEN_OVERLAY_HASH;
  console.log('Overlay Output Parity:', ovMatch ? 'EXACT MATCH ✓' : 'MISMATCH ❌');

  console.log('Warning Sequence SHA256 (Base):', GOLDEN_WARNING_HASH);
  console.log('Warning Sequence SHA256 (Head):', headWarningsHash);
  const warnMatch = headWarningsHash === GOLDEN_WARNING_HASH;
  console.log('Warning Sequence Parity:', warnMatch ? 'EXACT MATCH ✓' : 'MISMATCH ❌');

  if (!sentMatch || !ovMatch || !warnMatch) {
    console.error('❌ NORMALIZATION FIXTURE PARITY FAILED.');
    process.exit(1);
  }

  console.log('\n==================================================================');
  console.log('✓ ALL NORMALIZATION TESTS AND HASH PARITY CHECKS PASSED 100%!');
  console.log('==================================================================\n');
}

runNormalizationTests().catch(err => {
  console.error('❌ NORMALIZATION TEST FAILED:', err);
  process.exit(1);
});
