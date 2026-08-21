/**
 * qa_regression/test_layout.cjs
 * Comprehensive characterization test suite for extracted Layout module.
 * Strictly locks:
 * 1. Public API surface contract (createLayout factory)
 * 2. Fresh-instance isolation (createLayout() !== createLayout())
 * 3. Full structural parity against Phase 13 baseline (all keys, types, values)
 * 4. RegExp structural parity (.source and .flags) for all peak validation rules
 * 5. Deterministic mathematical derivations:
 *    - card.infoLeft === Math.round((canvas.w - card.width) / 2) === 80
 *    - subtitle.peakScriptClimaxTopOffset === -Math.round(peakScriptClimaxSize * 0.12) === -12
 *    - subtitle.peakSmartFirstCharWidth === Math.round(peakAnchorSize * peakSmartFirstCharRatio) === 62
 * 6. VisualRow geometry invariants (height: 320, top: 975, left: 70)
 * 7. Colors palette and cinematic grade parameters (colorGrade, vignette, bottomGrad)
 * 8. Peak animation timing parameters (enterY: 18, enterEase: 'back.out(1.5)')
 * 9. applyPresenterSide('left') mutation parity with live layout instance
 * 10. applyPresenterSide('center') mutation parity, including repeated-call cumulative behavior (1100 -> 1150 -> 1200)
 * 11. applyPresenterSide('right') and fallback no-op layout mutation
 */

const assert = require('assert');
const path = require('path');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');

async function runLayoutCharacterizationTests() {
  console.log('==================================================================');
  console.log('       LAYOUT CONFIGURATION CHARACTERIZATION TEST SUITE');
  console.log('==================================================================\n');

  const modPath = path.resolve('src', 'pipeline', 'layout.js');
  const mod = await import(pathToFileURL(modPath).href);
  const { createLayout } = mod;

  // -------------------------------------------------------------
  // 1. PUBLIC API SURFACE CONTRACT
  // -------------------------------------------------------------
  console.log('--- 1. Public API Surface Contract ---');
  assert.strictEqual(typeof createLayout, 'function', 'createLayout must be an exported function');
  const exportedKeys = Object.keys(mod).sort();
  assert.deepStrictEqual(exportedKeys, ['createLayout'], 'Only createLayout factory should be exported');
  console.log('✓ Section 1 Passed: Public API contract locked.\n');

  // -------------------------------------------------------------
  // 2. FRESH-INSTANCE ISOLATION
  // -------------------------------------------------------------
  console.log('--- 2. Fresh-Instance Isolation ---');
  {
    const l1 = createLayout();
    const l2 = createLayout();
    assert.notStrictEqual(l1, l2, 'createLayout must return a distinct object instance on each call');
    assert.notStrictEqual(l1.card, l2.card, 'Nested objects must be independent');
    assert.notStrictEqual(l1.peak, l2.peak, 'Nested peak config must be independent');

    // Mutating l1 must not affect l2
    l1.card.defaultTop = 9999;
    l1.card.infoLeft = 555;
    assert.strictEqual(l2.card.defaultTop, 1100, 'l2.card.defaultTop remains unmodified');
    assert.strictEqual(l2.card.infoLeft, 80, 'l2.card.infoLeft remains unmodified');
  }
  console.log('✓ Section 2 Passed: Fresh-instance isolation locked.\n');

  // -------------------------------------------------------------
  // 3. FULL STRUCTURAL PARITY AGAINST BASELINE
  // -------------------------------------------------------------
  console.log('--- 3. Full Structural Parity Against Baseline ---');
  {
    const layout = createLayout();

    // Canvas
    assert.deepStrictEqual(layout.canvas, { w: 1080, h: 1920 });

    // Card
    assert.strictEqual(layout.card.defaultTop, 1100);
    assert.strictEqual(layout.card.statTop, 900);
    assert.strictEqual(layout.card.offscreenLeft, -700);
    assert.strictEqual(layout.card.neonBarLeft, 70);
    assert.strictEqual(layout.card.infoLeft, 80);
    assert.strictEqual(layout.card.statLeft, 70);
    assert.strictEqual(layout.card.introX, -160);
    assert.strictEqual(layout.card.width, 920);
    assert.strictEqual(layout.card.height, 175);
    assert.strictEqual(layout.card.lottieRatio, 0.34);
    assert.strictEqual(layout.card.lottieIconSize, 200);
    assert.strictEqual(layout.card.statWidth, 920);
    assert.strictEqual(layout.card.statMinHeight, 250);
    assert.strictEqual(layout.card.stackOffset, 160);
    assert.strictEqual(layout.card.exitX, -34);
    assert.strictEqual(layout.card.titleFontSize, 42);
    assert.strictEqual(layout.card.bodyFontSize, 26);
    assert.strictEqual(layout.card.listTitleFontSize, 26);
    assert.strictEqual(layout.card.listDetailFontSize, 22);

    // VisualRow
    assert.strictEqual(layout.visualRow.left, 70);
    assert.strictEqual(layout.visualRow.top, 975);
    assert.strictEqual(layout.visualRow.statTop, 1150);
    assert.strictEqual(layout.visualRow.height, 320);
    assert.strictEqual(layout.visualRow.imageWidth, 420);
    assert.strictEqual(layout.visualRow.introX, -24);
    assert.strictEqual(layout.visualRow.exitX, -16);

    // Subtitle
    assert.strictEqual(layout.subtitle.top, 1520);
    assert.strictEqual(layout.subtitle.peakTop, 1050);
    assert.strictEqual(layout.subtitle.left, 40);
    assert.strictEqual(layout.subtitle.width, 1000);
    assert.strictEqual(layout.subtitle.height, 340);
    assert.strictEqual(layout.subtitle.maxWords, 6);
    assert.strictEqual(layout.subtitle.normalFontSize, 34);
    assert.strictEqual(layout.subtitle.peakConnectorSize, 28);
    assert.strictEqual(layout.subtitle.peakRegularSize, 52);
    assert.strictEqual(layout.subtitle.peakAnchorSize, 124);
    assert.strictEqual(layout.subtitle.peakScriptSize, 68);
    assert.strictEqual(layout.subtitle.peakScriptClimaxSize, 96);
    assert.strictEqual(layout.subtitle.peakScriptClimaxFont, 'DVN Grandy');
    assert.strictEqual(layout.subtitle.peakScriptClimaxLineHeight, 0.82);
    assert.strictEqual(layout.subtitle.peakIndentStep, 16);
    assert.strictEqual(layout.subtitle.peakRegularFontSize, 48);
    assert.strictEqual(layout.subtitle.peakRegularBottomFontSize, 36);
    assert.strictEqual(layout.subtitle.peakKeyFontSize, 64);
    assert.strictEqual(layout.subtitle.peakScriptClimaxTopOffset, -12);
    assert.strictEqual(layout.subtitle.peakSmartFirstCharWidth, 62);

    // Hook
    assert.deepStrictEqual(layout.hook, { fadeOutAt: 4.2, safeStart: 4.8 });

    // Colors
    assert.deepStrictEqual(layout.colors, {
      accent:    '#a6ff3d',
      accentRgb: '166,255,61',
      warning:   '#ff4444',
      yellow:    '#f5c518',
      darkBg:    '#0a0a0a',
      statBg:    'rgba(5,5,5,0.92)'
    });

    // Cinematic
    assert.deepStrictEqual(layout.cinematic.colorGrade, {
      enabled:    true,
      brightness: 0.00,
      contrast:   1.10,
      saturation: 1.12,
      gamma:      0.91,
      gammaR:     1.07,
      gammaG:     0.98,
      gammaB:     0.90
    });

    assert.deepStrictEqual(layout.cinematic.vignette, {
      enabled:    true,
      opacity:    0.72,
      ellipseX:   55,
      ellipseY:   32,
      centerX:    50,
      centerY:    42,
      clearAt:    30,
      fadeAt:     72
    });

    assert.deepStrictEqual(layout.cinematic.bottomGrad, {
      enabled:    true,
      opacity:    0.62,
      heightPct:  27,
      midOpacity: 0.18
    });

    // Peak Config
    assert.strictEqual(layout.peak.maxClimaxPerSentence, 1);
    assert.strictEqual(layout.peak.maxChunks, 4);
    assert.strictEqual(layout.peak.peakSmartIndentEnabled, true);
    assert.strictEqual(layout.peak.peakSmartFirstCharRatio, 0.50);
    assert.strictEqual(layout.peak.peakSmartRegCharRatio, 0.55);
    assert.strictEqual(layout.peak.peakSmartScriptCharRatio, 0.48);
    assert.strictEqual(layout.peak.peakSmartAvgWordChars, 3.0);
    assert.strictEqual(layout.peak.peakSmartClimaxTopPullRatio, 0.35);
    assert.strictEqual(layout.peak.peakFunctionWordScale, 0.28);
    assert.strictEqual(layout.peak.peakFunctionWordMinSize, 18);
    assert.strictEqual(layout.peak.peakRegularSizeFaded, 28);
    assert.strictEqual(layout.peak.peakClimaxSizeHero, 100);
    assert.strictEqual(layout.peak.peakNoAnchorClimaxIndent, 32);
    assert.strictEqual(layout.peak.anchorMaxWords, 3);
    assert.strictEqual(layout.peak.anchorPromoteEnabled, true);

    // PeakAnim
    assert.deepStrictEqual(layout.peakAnim, {
      enterY:        18,
      enterX:        -5,
      enterDuration: 0.22,
      enterEase:    'back.out(1.5)',
      enterStagger:  0.09,
      exitY:         -8,
      exitDuration:  0.18,
      exitEase:     'power2.in',
      exitStagger:   0.04
    });
  }
  console.log('✓ Section 3 Passed: Full structural parity locked.\n');

  // -------------------------------------------------------------
  // 4. REGEXP STRUCTURAL PARITY (.source and .flags)
  // -------------------------------------------------------------
  console.log('--- 4. RegExp Structural Parity (.source and .flags) ---');
  {
    const layout = createLayout();

    // anchorEndBlockPattern
    assert.ok(layout.peak.anchorEndBlockPattern instanceof RegExp);
    assert.strictEqual(
      layout.peak.anchorEndBlockPattern.source,
      '\\s+(cho|về|trong|trên|dưới|từ|với|đến|tới|qua|sau|trước|theo|tại|ở|của|mà|và|hay|hoặc|nhưng|vì|nếu|khi|để|như|bằng|ngoài|suốt|cùng|giữa|là|thì|mà)\\s*$'
    );
    assert.strictEqual(layout.peak.anchorEndBlockPattern.flags, 'i');

    // anchorVerbHeadPattern
    assert.ok(layout.peak.anchorVerbHeadPattern instanceof RegExp);
    assert.strictEqual(
      layout.peak.anchorVerbHeadPattern.source,
      '^(tăng cường|cải thiện|hỗ trợ|bảo vệ|phòng ngừa|điều trị|phục hồi|duy trì|kiểm soát|loại bỏ|thúc đẩy|mang lại|đem lại|kích thích|ức chế|giảm thiểu|giúp|giảm|tăng)\\s+'
    );
    assert.strictEqual(layout.peak.anchorVerbHeadPattern.flags, 'i');

    // anchorTrailingClassifierPattern
    assert.ok(layout.peak.anchorTrailingClassifierPattern instanceof RegExp);
    assert.strictEqual(
      layout.peak.anchorTrailingClassifierPattern.source,
      '\\s+(các|cái|những|một|mỗi|này|đó|kia|ấy)\\s*$'
    );
    assert.strictEqual(layout.peak.anchorTrailingClassifierPattern.flags, 'i');

    // compoundPrefixPattern
    assert.ok(layout.peak.compoundPrefixPattern instanceof RegExp);
    assert.strictEqual(
      layout.peak.compoundPrefixPattern.source,
      '^(hieu|te|thu|khang|trao|xuc|thi|thinh|vi|khuu|sinh|ly|cau|chuc|tac|tich|uc|dan|bien|trieu|ket|tham|gia|tri|oxy|mo|he|tong|nguyen|tieu|tiet|chuyen|hap|tuan|dac|hau|co|ao|than)$'
    );
    assert.strictEqual(layout.peak.compoundPrefixPattern.flags, 'i');

    // climaxBlockRules (array of 6 regexes)
    assert.strictEqual(layout.peak.climaxBlockRules.length, 6);
    const expectedRules = [
      {
        source: '^(cho|của|với|trong|trên|dưới|về|từ|đến|tới|mà|và|hay|hoặc|nhưng|vì|nếu|khi|để|như|bằng|qua|sau|trước|ngoài|theo|tại|ở|suốt|cùng|khỏi|giữa|là|thì)\\s',
        flags: 'i'
      },
      {
        source: 'của\\s+(bạn|mình|tôi|tớ|họ|nó|ta|chúng\\s*ta|mọi\\s*người)\\s*$',
        flags: 'i'
      },
      {
        source: '^(rất|quá|cực|vô cùng|hết sức|khá|hơi|chút|siêu)\\s+\\S',
        flags: 'i'
      },
      {
        source: '^(mỗi|hàng|suốt|cả|từng)\\s+(ngày|tuần|tháng|năm|giờ|phút|lần|buổi|sáng|chiều|tối)\\s*$',
        flags: 'i'
      },
      {
        source: '^(như vậy|như thế|vậy thôi|mà thôi|thôi|vậy đó|thế đó|đó thôi|chỉ vậy|không hơn)\\s*$',
        flags: 'i'
      },
      {
        source: '^(để|nhằm|nhằm mục đích|hướng tới|hướng đến)\\s',
        flags: 'i'
      }
    ];

    layout.peak.climaxBlockRules.forEach((rule, idx) => {
      assert.ok(rule instanceof RegExp, `climaxBlockRules[${idx}] must be RegExp`);
      assert.strictEqual(rule.source, expectedRules[idx].source, `climaxBlockRules[${idx}].source mismatch`);
      assert.strictEqual(rule.flags, expectedRules[idx].flags, `climaxBlockRules[${idx}].flags mismatch`);
    });
  }
  console.log('✓ Section 4 Passed: RegExp structural parity locked.\n');

  // -------------------------------------------------------------
  // 5. DETERMINISTIC MATHEMATICAL DERIVATIONS
  // -------------------------------------------------------------
  console.log('--- 5. Deterministic Mathematical Derivations ---');
  {
    const layout = createLayout();

    // 1. infoLeft = Math.round((1080 - 920) / 2) = 80
    assert.strictEqual(
      layout.card.infoLeft,
      Math.round((layout.canvas.w - layout.card.width) / 2),
      'card.infoLeft must be derived from (canvas.w - card.width) / 2'
    );
    assert.strictEqual(layout.card.infoLeft, 80);

    // 2. peakScriptClimaxTopOffset = -Math.round(96 * 0.12) = -12
    assert.strictEqual(
      layout.subtitle.peakScriptClimaxTopOffset,
      -Math.round(layout.subtitle.peakScriptClimaxSize * 0.12),
      'peakScriptClimaxTopOffset must be -Math.round(peakScriptClimaxSize * 0.12)'
    );
    assert.strictEqual(layout.subtitle.peakScriptClimaxTopOffset, -12);

    // 3. peakSmartFirstCharWidth = Math.round(124 * 0.50) = 62
    assert.strictEqual(
      layout.subtitle.peakSmartFirstCharWidth,
      Math.round(layout.subtitle.peakAnchorSize * layout.peak.peakSmartFirstCharRatio),
      'peakSmartFirstCharWidth must be derived from peakAnchorSize * peakSmartFirstCharRatio'
    );
    assert.strictEqual(layout.subtitle.peakSmartFirstCharWidth, 62);
  }
  console.log('✓ Section 5 Passed: Deterministic mathematical derivations locked.\n');

  // -------------------------------------------------------------
  // 6. PRESENTER MUTATION PARITY: applyPresenterSide('left')
  // -------------------------------------------------------------
  console.log('--- 6. Presenter Mutation Parity: applyPresenterSide(\'left\') ---');
  {
    const presModPath = path.resolve('src', 'pipeline', 'presenterLayout.js');
    const presMod = await import(pathToFileURL(presModPath).href);
    const { createPresenterLayout } = presMod;

    const layout = createLayout();
    const svc = createPresenterLayout({ layout });

    svc.applyPresenterSide('left');

    // margin = 70. 1080 - 920 - 70 = 90
    assert.strictEqual(layout.card.infoLeft, 90);
    assert.strictEqual(layout.card.statLeft, 90);
    assert.strictEqual(layout.card.neonBarLeft, 90);
    assert.strictEqual(layout.card.introX, 160);
    assert.strictEqual(layout.card.exitX, 34);
    assert.strictEqual(layout.visualRow.left, 90);
    assert.strictEqual(layout.visualRow.introX, 24);
    assert.strictEqual(layout.visualRow.exitX, 16);
  }
  console.log('✓ Section 6 Passed: applyPresenterSide(\'left\') mutation parity locked.\n');

  // -------------------------------------------------------------
  // 7. PRESENTER MUTATION PARITY: applyPresenterSide('center') (CUMULATIVE)
  // -------------------------------------------------------------
  console.log('--- 7. Presenter Mutation Parity: applyPresenterSide(\'center\') (Cumulative) ---');
  {
    const presModPath = path.resolve('src', 'pipeline', 'presenterLayout.js');
    const presMod = await import(pathToFileURL(presModPath).href);
    const { createPresenterLayout } = presMod;

    const layout = createLayout();
    const svc = createPresenterLayout({ layout });

    assert.strictEqual(layout.card.defaultTop, 1100);

    // Call 1
    svc.applyPresenterSide('center');
    assert.strictEqual(layout.card.defaultTop, 1150);

    // Call 2 (Cumulative repeated-call behavior!)
    svc.applyPresenterSide('center');
    assert.strictEqual(layout.card.defaultTop, 1200);

    // Call 3
    svc.applyPresenterSide('center');
    assert.strictEqual(layout.card.defaultTop, 1250);
  }
  console.log('✓ Section 7 Passed: applyPresenterSide(\'center\') cumulative mutation locked.\n');

  // -------------------------------------------------------------
  // 8. PRESENTER MUTATION PARITY: applyPresenterSide('right') / fallback
  // -------------------------------------------------------------
  console.log('--- 8. Presenter Mutation Parity: applyPresenterSide(\'right\') / Fallback ---');
  {
    const presModPath = path.resolve('src', 'pipeline', 'presenterLayout.js');
    const presMod = await import(pathToFileURL(presModPath).href);
    const { createPresenterLayout } = presMod;

    const layout = createLayout();
    const initialJson = JSON.stringify(layout);
    const svc = createPresenterLayout({ layout });

    svc.applyPresenterSide('right');
    assert.strictEqual(JSON.stringify(layout), initialJson, 'Layout must not mutate for right');

    svc.applyPresenterSide('unknown');
    assert.strictEqual(JSON.stringify(layout), initialJson, 'Layout must not mutate for unknown fallback');
  }
  console.log('✓ Section 8 Passed: applyPresenterSide(\'right\') / fallback no-op locked.\n');

  console.log('==================================================================');
  console.log('✓ ALL 8 LAYOUT CHARACTERIZATION SECTIONS PASSED 100%!');
  console.log('==================================================================\n');
}

runLayoutCharacterizationTests().catch(err => {
  console.error('❌ LAYOUT CHARACTERIZATION FAILED:', err);
  process.exit(1);
});
