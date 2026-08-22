/**
 * qa_regression/test_html_composition.cjs
 * Comprehensive characterization test suite for extracted HTML Document Composition Service.
 * Strictly locks:
 * 1. Public API surface contract (createHtmlComposition factory returning ONLY generatePremiumHTML)
 * 2. Dependency validation & fail-fast guards (layout, peakFunctionWords, generateStylesImpl)
 * 3. Multi-fixture HTML generation parity across all subtitle, card, and visual modes
 * 4. Exact in-place sentence metadata mutation parity (__goldSet, __renderedChunkIds) derived from Reviewed Base
 * 5. Live reference semantics:
 *    - Live LAYOUT mutation
 *    - Live PEAK_FUNCTION_WORDS mutation on anchor content-word to function-word sizing transition (124px -> 35px)
 *    - Live assetMap dynamic visibility through getter
 * 6. buildImageStyle dependency injection & spy verification
 * 7. Lottie filesystem read tracing, error handling, and null fallback
 * 8. Comprehensive Reviewed-Base HTML Byte Count & SHA256 lock (c277c244a9493f8ed21db60a83f6e4e34f908a53)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

async function runHtmlCompositionCharacterizationTests() {
  console.log('==================================================================');
  console.log('    HTML COMPOSITION MODULE CHARACTERIZATION TEST SUITE');
  console.log('==================================================================\n');

  let sectionCount = 0;
  let assertionCount = 0;
  let fixtureCount = 0;

  function countAssert(fn) {
    fn();
    assertionCount++;
  }

  const modPath = path.resolve('src', 'pipeline', 'htmlComposition.js');
  const mod = await import(pathToFileURL(modPath).href);
  const { createHtmlComposition } = mod;

  const layoutModPath = path.resolve('src', 'pipeline', 'layout.js');
  const { createLayout } = await import(pathToFileURL(layoutModPath).href);

  const semanticEnginePath = path.resolve('semanticOverlayEngine.js');
  const { classifyOverlayType } = await import(pathToFileURL(semanticEnginePath).href);

  const normModPath = path.resolve('src', 'pipeline', 'normalization.js');
  const { createNormalization } = await import(pathToFileURL(normModPath).href);

  const postModPath = path.resolve('src', 'pipeline', 'overlayPostProcessor.js');
  const { createOverlayPostProcessor } = await import(pathToFileURL(postModPath).href);

  const splitModPath = path.resolve('src', 'pipeline', 'subtitleSplit.js');
  const { createSubtitleSplitter } = await import(pathToFileURL(splitModPath).href);

  const peakIndentModPath = path.resolve('src', 'pipeline', 'peakSmartIndent.js');
  const { createPeakSmartIndent } = await import(pathToFileURL(peakIndentModPath).href);

  const lottieFilterModPath = path.resolve('src', 'pipeline', 'lottieFilter.js');
  const { getLottieIconFilter } = await import(pathToFileURL(lottieFilterModPath).href);

  const metricModPath = path.resolve('metricRenderer.js');
  const { renderMetricFromTitle, getMetricCSS } = await import(pathToFileURL(metricModPath).href);

  const patternModPath = path.resolve('visualPatternRenderer.js');
  const { getPatternCSS } = await import(pathToFileURL(patternModPath).href);

  const stylesModPath = path.resolve('src', 'pipeline', 'compositionStyles.js');
  const { createCompositionStyles } = await import(pathToFileURL(stylesModPath).href);

  const layout = createLayout();
  const peakFunctionWords = new Set([
    'da','se','dang','van','cung','lai',
    'phai','can','chua','duoc',
    'voi','ve','tren','duoi','tu','den','o',
    'bang','theo','vao','ra','cua','tai',
    'va','hay','hoac','nhung','ma','neu',
    'khi','de','nen','vi','boi',
    'do','day','nay','kia','ay',
    'ta','ho','chung',
    'rat','kha','hoi',
    'mot','nhieu',
    'cac','cai','nhung','moi',
  ]);

  function buildImageStyle(entry, extraStyle = '') {
    let style = `max-width:100%;max-height:100%;object-fit:contain;${extraStyle}`;
    if (entry.blend_mode && entry.blend_mode !== 'transparent') {
      style += `mix-blend-mode:${entry.blend_mode};`;
    }
    return style;
  }

  const { foldText, toSeconds, normalizeSentence, normalizeOverlay } = createNormalization({
    layoutPeak: layout.peak,
    getPeakFunctionWords: () => peakFunctionWords,
    classifyOverlayType
  });

  const { postProcessOverlays } = createOverlayPostProcessor({
    toSeconds,
    hookSafeStart: layout.hook.safeStart,
    logWarning: () => {}
  });

  const { splitLongSentences } = createSubtitleSplitter({
    normalizeSentence,
    foldText,
    maxWordsDefault: layout.subtitle.maxWords,
    warn: () => {}
  });

  const { getPeakSmartIndents } = createPeakSmartIndent({
    layoutPeak: layout.peak,
    layoutSubtitle: layout.subtitle
  });

  const { generateStyles } = createCompositionStyles({
    getMetricCSSImpl: getMetricCSS,
    getPatternCSSImpl: getPatternCSS,
    readFileSyncImpl: fs.readFileSync,
    resolvePathImpl: path.resolve,
    existsSyncImpl: fs.existsSync
  });

  const sampleAssetMap = new Map([
    ['asset_test_1', { key: 'asset_test_1', path: 'assets/Brand/logo.png', blend_mode: 'transparent' }],
    ['asset_test_2', { key: 'asset_test_2', path: 'assets/Health visuals/heart.png', blend_mode: 'screen' }]
  ]);

  function buildImageStyleMock(entry, extraStyle = '') {
    const base = `max-width:100%;max-height:100%;object-fit:contain;${extraStyle}`;
    if (!entry.blend_mode || entry.blend_mode === 'transparent') return base;
    return base + (entry.blend_mode === 'screen' ? 'mix-blend-mode:screen;' : '');
  }

  // -------------------------------------------------------------
  // 1. PUBLIC API SURFACE CONTRACT & INPUT VALIDATION
  // -------------------------------------------------------------
  console.log('--- 1. Public API Surface Contract & Input Validation ---');
  sectionCount++;
  countAssert(() => assert.strictEqual(typeof createHtmlComposition, 'function', 'createHtmlComposition must be a function'));
  countAssert(() => assert.deepStrictEqual(Object.keys(mod).sort(), ['createHtmlComposition'], 'Only createHtmlComposition should be exported'));

  // Fail-fast checks
  countAssert(() => assert.throws(() => createHtmlComposition({}), /layout/, 'Must throw if layout is missing'));
  countAssert(() => assert.throws(() => createHtmlComposition({ layout }), /peakFunctionWords/, 'Must throw if peakFunctionWords is missing'));
  countAssert(() => assert.throws(() => createHtmlComposition({ layout, peakFunctionWords }), /generateStylesImpl/, 'Must throw if generateStylesImpl is missing'));

  const service = createHtmlComposition({
    layout,
    peakFunctionWords,
    getAssetMap: () => sampleAssetMap,
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

  countAssert(() => assert.deepStrictEqual(Object.keys(service).sort(), ['generatePremiumHTML'], 'Service public API must ONLY expose generatePremiumHTML'));
  countAssert(() => assert.strictEqual(typeof service.generatePremiumHTML, 'function', 'generatePremiumHTML must be a function'));
  console.log('✓ Section 1 Passed: Public API contract & validation locked.\n');

  // -------------------------------------------------------------
  // 2. MULTI-FIXTURE DETERMINISTIC HTML GENERATION
  // -------------------------------------------------------------
  console.log('--- 2. Multi-Fixture Deterministic HTML Generation ---');
  sectionCount++;

  // Fixture A: Normal flat subtitles
  {
    fixtureCount++;
    const sentences = [
      { startTime: 0.5, endTime: 2.5, text: "Uống đủ nước mỗi ngày giúp cơ thể khỏe mạnh", words: ["Uống", "đủ", "nước", "mỗi", "ngày", "giúp", "cơ", "thể", "khỏe", "mạnh"], style: "regular" }
    ];
    const html = service.generatePremiumHTML(sentences, [], 5);
    countAssert(() => assert.ok(html.startsWith('<!doctype html>'), 'HTML must start with doctype'));
    countAssert(() => assert.ok(html.includes('<title>CNFI Premium TikTok Composition</title>'), 'HTML must have correct title'));
    countAssert(() => assert.ok(html.includes('data-composition-id="elegant-maxwell"'), 'HTML must have root composition ID'));
    countAssert(() => assert.ok(html.includes('id="sentence-0"'), 'HTML must contain sentence container'));
    countAssert(() => assert.ok(html.includes('Uống'), 'HTML must contain words'));
  }

  // Fixture B: TYB peak typography (anchor + script + script_climax)
  {
    fixtureCount++;
    const sentences = [
      {
        startTime: 2.5,
        endTime: 5.0,
        text: "TĂNG CƠ GIẢM MỠ CỰC NHANH",
        words: ["TĂNG", "CƠ", "GIẢM", "MỠ", "CỰC", "NHANH"],
        style: "peak",
        peak_lines: [
          { text: "TĂNG CƠ", type: "anchor" },
          { text: "GIẢM MỠ", type: "script" },
          { text: "CỰC NHANH", type: "script_climax" }
        ]
      }
    ];
    const html = service.generatePremiumHTML(sentences, [], 6);
    countAssert(() => assert.ok(html.includes('peak-chunk'), 'Peak sentence must render peak-chunk'));
    countAssert(() => assert.ok(html.includes('word-peak-key'), 'Peak sentence must render word-peak-key'));
  }

  // Fixture C: STAT metric cards
  {
    fixtureCount++;
    const overlays = [
      { startTime: 5.0, endTime: 7.5, type: "STAT", title: "Tăng 45% cơ bắp", detail: "Nghiên cứu lâm sàng", visual_value: 9 }
    ];
    const html = service.generatePremiumHTML([], overlays, 10);
    countAssert(() => assert.ok(html.includes('class="card-stat'), 'Must render STAT card markup'));
    countAssert(() => assert.ok(html.includes('data-countup-target="45"'), 'Must render metric countup target attribute'));
    countAssert(() => assert.ok(html.includes('Nghiên cứu lâm sàng'), 'Must render stat detail'));
  }

  // Fixture D: Progressive list & Slam cards
  {
    fixtureCount++;
    const overlays = [
      { startTime: 5.0, endTime: 7.0, type: "PROGRESSIVE_LIST", title: "Khởi Động Đúng Cách", detail: "Tăng hiệu quả tập luyện", list_group: "grp1", list_index: 1, list_total: 3, list_style: "progressive" },
      { startTime: 7.5, endTime: 9.5, type: "NUMBER_SLAM", title: "Số 1 Thế Giới Về Dinh Dưỡng", detail: "Chứng nhận ISO quốc tế", list_group: "grp2", list_style: "number_slam" }
    ];
    const html = service.generatePremiumHTML([], overlays, 12);
    countAssert(() => assert.ok(html.includes('class="card card-list-progressive'), 'Must render progressive list card'));
    countAssert(() => assert.ok(html.includes('data-list-group="grp1"'), 'Must render list group attribute'));
    countAssert(() => assert.ok(html.includes('class="card card-list-slam"'), 'Must render slam card'));
  }

  // Fixture E: INFO / WARNING / ACTION cards with Lottie
  {
    fixtureCount++;
    const overlays = [
      { startTime: 5.0, endTime: 7.0, type: "INFO", title: "Lưu Ý Quan Trọng", detail: "Không uống lúc đói kéo dài", lottie_path: "assets/lottie/warning.json" },
      { startTime: 7.5, endTime: 9.5, type: "WARNING", title: "Sai Lầm Thường Gặp", detail: "Không nên tập quá nhanh" }
    ];
    const mockLottieSvc = createHtmlComposition({
      layout,
      peakFunctionWords,
      getAssetMap: () => sampleAssetMap,
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
      readFileSyncImpl: (p) => JSON.stringify({ v: "5.5.7", fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [] })
    });
    const html = mockLottieSvc.generatePremiumHTML([], overlays, 12);
    countAssert(() => assert.ok(html.includes('window.__lottieData = {"card-0":{"v":"5.5.7"'), 'Must embed inline parsed Lottie data'));
    countAssert(() => assert.ok(html.includes('card-warning'), 'Must render WARNING card'));
  }

  // Fixture F: Gemini custom hook vs default hook fallback
  {
    fixtureCount++;
    const customHook = { kicker: "BÍ QUYẾT", title: "GIẢM MỠ BỤNG", punch: "TRONG 7 NGÀY" };
    const htmlCustom = service.generatePremiumHTML([], [], 5, customHook);
    countAssert(() => assert.ok(htmlCustom.includes('class="hook-kicker">BÍ QUYẾT</div>'), 'Must render custom kicker'));
    countAssert(() => assert.ok(htmlCustom.includes('class="hook-title">GIẢM MỠ BỤNG</div>'), 'Must render custom title'));
    countAssert(() => assert.ok(htmlCustom.includes('class="hook-punch">TRONG 7 NGÀY</div>'), 'Must render custom punch'));

    const htmlFallback = service.generatePremiumHTML([], [], 5, null);
    countAssert(() => assert.ok(htmlFallback.includes('class="hook-kicker">SỨC KHỎE</div>'), 'Must render fallback kicker'));
    countAssert(() => assert.ok(htmlFallback.includes('class="hook-title">MỘT THÓI QUEN NHỎ</div>'), 'Must render fallback title'));
  }

  // Fixture G: Gap images rendering
  {
    fixtureCount++;
    const gapSegments = [{ startTime: 1.0, endTime: 3.0, image_key: 'asset_test_1' }];
    const htmlGap = service.generatePremiumHTML([], [], 5, null, gapSegments);
    countAssert(() => assert.ok(htmlGap.includes('class="gap-img-wrap" id="gap-img-0"'), 'Must render gap image wrapper'));
    countAssert(() => assert.ok(htmlGap.includes('src="assets/Brand/logo.png"'), 'Must render resolved asset image src'));
  }

  // Fixture H: Peak sentence & overlay overlap collision suppression
  {
    fixtureCount++;
    const sentences = [
      { startTime: 5.0, endTime: 7.0, text: "ĐỈNH CAO DINH DƯỠNG", words: ["ĐỈNH", "CAO", "DINH", "DƯỠNG"], style: "peak" }
    ];
    const overlays = [
      { startTime: 5.5, endTime: 6.5, type: "INFO", title: "Lưu Ý Quan Trọng", detail: "Should be suppressed" },
      { startTime: 7.5, endTime: 9.5, type: "INFO", title: "Thông Tin Bổ Sung", detail: "Should stay" }
    ];
    const html = service.generatePremiumHTML(sentences, overlays, 10);
    countAssert(() => assert.ok(!html.includes('Should be suppressed'), 'Overlapping card must be suppressed'));
    countAssert(() => assert.ok(html.includes('Thông Tin Bổ Sung'), 'Non-overlapping card must be kept'));
  }
  console.log(`✓ Section 2 Passed: Multi-fixture generation verified across ${fixtureCount} fixtures.\n`);

  // -------------------------------------------------------------
  // 3. EXACT SENTENCE IN-PLACE METADATA MUTATION PARITY
  // -------------------------------------------------------------
  console.log('--- 3. Exact Sentence In-place Metadata Mutation Parity ---');
  sectionCount++;
  {
    let capturedRenderSentences = [];
    const mutationSvc = createHtmlComposition({
      layout,
      peakFunctionWords,
      getAssetMap: () => sampleAssetMap,
      buildImageStyleImpl: buildImageStyle,
      generateStylesImpl: generateStyles,
      renderMetricFromTitleImpl: renderMetricFromTitle,
      getLottieIconFilterImpl: getLottieIconFilter,
      getPeakSmartIndentsImpl: getPeakSmartIndents,
      postProcessOverlaysImpl: postProcessOverlays,
      splitLongSentencesImpl: (sents) => {
        capturedRenderSentences = sents;
        return sents;
      },
      normalizeSentenceImpl: normalizeSentence,
      normalizeOverlayImpl: normalizeOverlay,
      toSecondsImpl: toSeconds,
      foldTextImpl: foldText,
      readFileSyncImpl: fs.readFileSync
    });

    const peakSentence = {
      startTime: 0.0,
      endTime: 3.0,
      text: "TĂNG CƠ GIẢM MỠ CỰC NHANH",
      words: ["TĂNG", "CƠ", "GIẢM", "MỠ", "CỰC", "NHANH"],
      style: "peak",
      peak_lines: [
        { text: "TĂNG CƠ", type: "anchor" },
        { text: "GIẢM MỠ", type: "script" },
        { text: "CỰC NHANH", type: "script_climax" }
      ]
    };

    mutationSvc.generatePremiumHTML([peakSentence], [], 4);

    countAssert(() => assert.strictEqual(capturedRenderSentences.length, 1, 'Must process 1 sentence'));
    const target = capturedRenderSentences[0];

    // Exact lock derived from Reviewed Base c277c244a9493f8ed21db60a83f6e4e34f908a53
    const expectedGoldSetArray = [3, 4, 5];
    const expectedRenderedChunkIds = ['sentence-0-c0', 'sentence-0-c1', 'sentence-0-c2'];

    countAssert(() => assert.ok(target.__goldSet instanceof Set, '__goldSet must be an instance of Set'));
    countAssert(() => assert.deepStrictEqual(Array.from(target.__goldSet), expectedGoldSetArray, '__goldSet must equal exact ordered array [3, 4, 5]'));
    countAssert(() => assert.deepStrictEqual(target.__renderedChunkIds, expectedRenderedChunkIds, '__renderedChunkIds must equal exact chunk ID array'));
  }
  console.log('✓ Section 3 Passed: Exact sentence in-place metadata mutations locked.\n');

  // -------------------------------------------------------------
  // 4. LIVE REFERENCE SEMANTICS (LAYOUT, PEAK_FUNCTION_WORDS, ASSETMAP)
  // -------------------------------------------------------------
  console.log('--- 4. Live Reference Semantics ---');
  sectionCount++;
  {
    // A. Live LAYOUT mutation
    const dynamicLayout = createLayout();
    const dynamicSvc = createHtmlComposition({
      layout: dynamicLayout,
      peakFunctionWords,
      getAssetMap: () => sampleAssetMap,
      buildImageStyleImpl: buildImageStyle,
      generateStylesImpl: (l) => `<style>/* TOP:${l.card.defaultTop} */</style>`,
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

    // Mutate LAYOUT AFTER service creation
    dynamicLayout.card.defaultTop = 1777;
    const htmlLayout = dynamicSvc.generatePremiumHTML([], [], 5);
    countAssert(() => assert.ok(htmlLayout.includes('/* TOP:1777 */'), 'HTML generation must reflect live mutated LAYOUT values'));

    // B. Live PEAK_FUNCTION_WORDS mutation with 5-word anchor fixture
    // Proves that dynamicFuncWords is read live by anchor per-word sizing (peakFunctionWords.has(foldTextImpl(w)))
    const dynamicFuncWords = new Set(['se']);
    const dynamicPeakSvc = createHtmlComposition({
      layout: dynamicLayout,
      peakFunctionWords: dynamicFuncWords,
      getAssetMap: () => sampleAssetMap,
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

    const peakSent = {
      startTime: 1.0,
      endTime: 4.0,
      text: "SẼ ĐỐT MỠ CỰC NHANH",
      words: ["SẼ", "ĐỐT", "MỠ", "CỰC", "NHANH"],
      style: "peak",
      peak_lines: [
        { text: "SẼ ĐỐT MỠ", type: "anchor" },
        { text: "CỰC NHANH", type: "script_climax" }
      ]
    };

    // 1. Generate HTML BEFORE adding target word 'dot'
    const htmlBefore = dynamicPeakSvc.generatePremiumHTML([peakSent], [], 5);
    countAssert(() => assert.ok(htmlBefore.includes('id="s0-w1" style="font-size:124px !important">ĐỐT</span>'), 'Target word ĐỐT must initially render with anchor content font-size (124px)'));

    // 2. Mutate Set instance AFTER factory construction
    dynamicFuncWords.add('dot');

    // 3. Generate HTML AFTER mutating Set
    const htmlAfter = dynamicPeakSvc.generatePremiumHTML([peakSent], [], 5);
    countAssert(() => assert.ok(htmlAfter.includes('id="s0-w1" style="font-size:35px !important">ĐỐT</span>'), 'Target word ĐỐT must render with reduced function-word font-size (35px) after live Set mutation'));
    countAssert(() => assert.notStrictEqual(htmlBefore, htmlAfter, 'Live Set mutation must produce observable difference in generated HTML output'));

    // C. Live assetMap visibility through getter
    const dynamicAssetMap = new Map();
    const dynamicAssetSvc = createHtmlComposition({
      layout: dynamicLayout,
      peakFunctionWords,
      getAssetMap: () => dynamicAssetMap,
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

    // Add asset to Map AFTER service creation
    dynamicAssetMap.set('dynamic_img_key', { key: 'dynamic_img_key', path: 'assets/dynamic.png', blend_mode: 'transparent' });
    const htmlDynamicAsset = dynamicAssetSvc.generatePremiumHTML([], [], 5, null, [{ startTime: 0, endTime: 2, image_key: 'dynamic_img_key' }]);
    countAssert(() => assert.ok(htmlDynamicAsset.includes('src="assets/dynamic.png"'), 'Live assetMap mutation must be visible to generatePremiumHTML'));
  }
  console.log('✓ Section 4 Passed: Live reference semantics verified.\n');

  // -------------------------------------------------------------
  // 5. BUILDIMAGESTYLE SPY INJECTION TEST
  // -------------------------------------------------------------
  console.log('--- 5. buildImageStyle Spy Injection Test ---');
  sectionCount++;
  {
    let spyCalls = [];
    const spySvc = createHtmlComposition({
      layout,
      peakFunctionWords,
      getAssetMap: () => sampleAssetMap,
      buildImageStyleImpl: (entry, extraStyle) => {
        spyCalls.push({ entry, extraStyle });
        return `style="SPY_STYLE_${entry.key}_${extraStyle}"`;
      },
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

    const html = spySvc.generatePremiumHTML([], [], 5, null, [{ startTime: 0, endTime: 2, image_key: 'asset_test_1' }]);
    countAssert(() => assert.strictEqual(spyCalls.length, 1, 'buildImageStyleImpl must be called once'));
    countAssert(() => assert.strictEqual(spyCalls[0].entry.key, 'asset_test_1', 'Correct asset entry passed'));
    countAssert(() => assert.strictEqual(spyCalls[0].extraStyle, 'border-radius:16px;', 'Correct extraStyle passed'));
    countAssert(() => assert.ok(html.includes('style="SPY_STYLE_asset_test_1_border-radius:16px;"'), 'Returned style inserted unchanged'));
  }
  console.log('✓ Section 5 Passed: buildImageStyle spy verified.\n');

  // -------------------------------------------------------------
  // 6. LOTTIE READ FILE SYSTEM TRACE & FALLBACK
  // -------------------------------------------------------------
  console.log('--- 6. Lottie Read Trace & Fallback ---');
  sectionCount++;
  {
    let readCalls = [];
    const traceSvc = createHtmlComposition({
      layout,
      peakFunctionWords,
      getAssetMap: () => sampleAssetMap,
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
      readFileSyncImpl: (p, enc) => {
        readCalls.push({ path: p, encoding: enc });
        if (p === 'throw.json') throw new Error('File read error');
        if (p === 'invalid.json') return '{ invalid json }';
        return JSON.stringify({ ok: true, file: p });
      }
    });

    const overlays = [
      { startTime: 5, endTime: 7, type: "INFO", title: "Lưu Ý Quan Trọng", lottie_path: "valid.json" },
      { startTime: 7, endTime: 8, type: "INFO", title: "Thông Tin Cần Đọc", lottie_path: "throw.json" },
      { startTime: 8, endTime: 9, type: "INFO", title: "Đọc Kỹ Hướng Dẫn", lottie_path: "invalid.json" },
      { startTime: 9, endTime: 10, type: "INFO", title: "Tổng Kết Chi Tiết" } // no lottie_path
    ];

    const html = traceSvc.generatePremiumHTML([], overlays, 12);
    countAssert(() => assert.strictEqual(readCalls.length, 3, 'readFileSyncImpl must only be called for overlays with lottie_path'));
    countAssert(() => assert.ok(html.includes('"card-0":{"ok":true,"file":"valid.json"}'), 'Valid Lottie parsed correctly'));
    countAssert(() => assert.ok(html.includes('"card-1":null'), 'Throwing read must fallback to null'));
    countAssert(() => assert.ok(html.includes('"card-2":null'), 'Invalid JSON read must fallback to null'));
    countAssert(() => assert.ok(html.includes('"card-3":null'), 'Missing lottie_path must fallback to null'));
  }
  console.log('✓ Section 6 Passed: Lottie read trace and null fallback verified.\n');

  // -------------------------------------------------------------
  // 7. COMMITTED REVIEWED-BASE COMPREHENSIVE HTML HASH LOCK
  // -------------------------------------------------------------
  console.log('--- 7. Committed Reviewed-Base Comprehensive HTML Hash Lock ---');
  sectionCount++;
  {
    fixtureCount++;
    const comprehensiveSentences = [
      {
        startTime: 0.5,
        endTime: 3.2,
        text: "TĂNG CƠ GIẢM MỠ NHANH CHÓNG",
        words: ["TĂNG", "CƠ", "GIẢM", "MỠ", "NHANH", "CHÓNG"],
        style: "peak",
        peak_lines: [
          { text: "TĂNG CƠ", type: "anchor" },
          { text: "GIẢM MỠ", type: "script" },
          { text: "NHANH CHÓNG", type: "script_climax" }
        ]
      },
      {
        startTime: 3.5,
        endTime: 6.0,
        text: "Bổ sung đủ protein mỗi ngày giúp cơ bắp phục hồi",
        words: ["Bổ", "sung", "đủ", "protein", "mỗi", "ngày", "giúp", "cơ", "bắp", "phục", "hồi"],
        style: "regular"
      }
    ];

    const comprehensiveOverlays = [
      {
        startTime: 5.0,
        endTime: 7.5,
        type: "STAT",
        title: "Tăng 45% Khối Lượng Cơ",
        detail: "Nghiên cứu lâm sàng 2024",
        visual_value: 9
      },
      {
        startTime: 7.8,
        endTime: 9.8,
        type: "PROGRESSIVE_LIST",
        title: "Khởi Động Đúng Cách",
        detail: "Tối ưu hóa buổi tập",
        list_group: "g1",
        list_index: 1,
        list_total: 3,
        list_style: "progressive"
      },
      {
        startTime: 10.0,
        endTime: 12.0,
        type: "WARNING",
        title: "Sai Lầm Thường Gặp",
        detail: "Không nên tập quá nhanh",
        lottie_path: "assets/lottie/warning.json"
      }
    ];

    const customHook = {
      kicker: "BÍ QUYẾT TẬP LUYỆN",
      title: "TĂNG CƠ GIẢM MỠ",
      punch: "HIỆU QUẢ NHẤT"
    };

    const gapSegments = [
      {
        startTime: 1.0,
        endTime: 3.0,
        image_key: "asset_test_1"
      }
    ];

    const comprehensiveHtml = service.generatePremiumHTML(
      comprehensiveSentences,
      comprehensiveOverlays,
      14.0,
      customHook,
      gapSegments
    );

    const actualByteLength = Buffer.byteLength(comprehensiveHtml, 'utf8');
    const actualSha256 = crypto.createHash('sha256').update(comprehensiveHtml, 'utf8').digest('hex');

    // Expected values derived from Reviewed Base c277c244a9493f8ed21db60a83f6e4e34f908a53
    const EXPECTED_BASE_BYTES = 341716;
    const EXPECTED_BASE_SHA256 = 'c2fdee59e990f71e23b5eb4c935fc27efcc847fdce0750282bcbf69fca32c6a9';

    if (actualSha256 !== EXPECTED_BASE_SHA256 || actualByteLength !== EXPECTED_BASE_BYTES) {
      console.error('\n❌ COMPREHENSIVE HTML HASH MISMATCH:');
      console.error(`  Actual byte length:   ${actualByteLength} (expected ${EXPECTED_BASE_BYTES})`);
      console.error(`  Actual SHA256:        ${actualSha256}`);
      console.error(`  Expected BASE SHA256: ${EXPECTED_BASE_SHA256}\n`);
    }

    countAssert(() => assert.strictEqual(actualByteLength, EXPECTED_BASE_BYTES, `Comprehensive HTML byte length must equal reviewed base (${EXPECTED_BASE_BYTES})`));
    countAssert(() => assert.strictEqual(actualSha256, EXPECTED_BASE_SHA256, `Comprehensive HTML SHA256 must match reviewed base (${EXPECTED_BASE_SHA256})`));
  }
  console.log('✓ Section 7 Passed: Committed Reviewed-Base Comprehensive HTML SHA256 locked.\n');

  console.log('==================================================================');
  console.log(`✓ ALL ${sectionCount} SECTIONS PASSED (${assertionCount} assertions, ${fixtureCount} fixtures) 100%!`);
  console.log('==================================================================\n');
}

runHtmlCompositionCharacterizationTests().catch(err => {
  console.error('❌ HTML COMPOSITION CHARACTERIZATION FAILED:', err);
  process.exit(1);
});
