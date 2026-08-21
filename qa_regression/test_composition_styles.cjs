/**
 * qa_regression/test_composition_styles.cjs
 * Comprehensive characterization test suite for extracted Composition Styles module.
 * Strictly locks:
 * 1. Public API surface contract (createCompositionStyles factory, generateStyles method)
 * 2. Dependency injection & validation (throws on missing getMetricCSSImpl, getPatternCSSImpl, layout)
 * 3. Exact font embedding (base64 data URI when font file exists, url path fallback when absent)
 * 4. CSS variables & layout property interpolation (:root vars, card positions, subtitle sizes)
 * 5. Metric & Pattern CSS inclusion and ordering
 * 6. Full character-for-character equality against Phase 14 baseline stylesheet & SHA256 checksum
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');

async function runCompositionStylesCharacterizationTests() {
  console.log('==================================================================');
  console.log('    COMPOSITION STYLES MODULE CHARACTERIZATION TEST SUITE');
  console.log('==================================================================\n');

  const BASE_SHA = '50752889f1e034d5eb0b594fe5ad87fec65f691f';
  const EXPECTED_STYLESHEET_LENGTH = 317827;
  const EXPECTED_STYLESHEET_SHA256 = '630a29ee7ae5eefb6b85bfd6eaf2ec07f30611018aab0df108df7a2741d7f6e9';

  const modPath = path.resolve('src', 'pipeline', 'compositionStyles.js');
  const mod = await import(pathToFileURL(modPath).href);
  const { createCompositionStyles } = mod;

  const layoutModPath = path.resolve('src', 'pipeline', 'layout.js');
  const { createLayout } = await import(pathToFileURL(layoutModPath).href);
  const layout = createLayout();

  const metricModPath = path.resolve('metricRenderer.js');
  const { getMetricCSS } = await import(pathToFileURL(metricModPath).href);

  const patternModPath = path.resolve('visualPatternRenderer.js');
  const { getPatternCSS } = await import(pathToFileURL(patternModPath).href);

  // -------------------------------------------------------------
  // 1. PUBLIC API SURFACE CONTRACT & VALIDATION
  // -------------------------------------------------------------
  console.log('--- 1. Public API Surface Contract & Input Validation ---');
  assert.strictEqual(typeof createCompositionStyles, 'function', 'createCompositionStyles must be a function');
  assert.deepStrictEqual(Object.keys(mod).sort(), ['createCompositionStyles'], 'Only createCompositionStyles should be exported');

  // Throws if required injections are missing
  assert.throws(() => createCompositionStyles({}), /getMetricCSSImpl/, 'Must throw if getMetricCSSImpl is missing');
  assert.throws(() => createCompositionStyles({ getMetricCSSImpl: () => '' }), /getPatternCSSImpl/, 'Must throw if getPatternCSSImpl is missing');

  const svc = createCompositionStyles({
    getMetricCSSImpl: getMetricCSS,
    getPatternCSSImpl: getPatternCSS,
    readFileSyncImpl: fs.readFileSync,
    resolvePathImpl: path.resolve,
    existsSyncImpl: fs.existsSync
  });

  assert.strictEqual(typeof svc.generateStyles, 'function', 'generateStyles must be a function');
  assert.throws(() => svc.generateStyles(null), /layout/, 'generateStyles must throw if layout is null/undefined');
  console.log('✓ Section 1 Passed: Public API contract & validation locked.\n');

  // -------------------------------------------------------------
  // 2. INJECTED DEPENDENCY CALL BEHAVIOR
  // -------------------------------------------------------------
  console.log('--- 2. Injected Dependency Call Behavior ---');
  {
    let metricCalls = 0;
    let patternCalls = 0;
    let existsCalls = 0;
    let readCalls = 0;

    const mockSvc = createCompositionStyles({
      getMetricCSSImpl: () => { metricCalls++; return '/* MOCK METRIC CSS */'; },
      getPatternCSSImpl: () => { patternCalls++; return '/* MOCK PATTERN CSS */'; },
      existsSyncImpl: (p) => { existsCalls++; return true; },
      readFileSyncImpl: (p) => { readCalls++; return Buffer.from('FAKE_FONT'); },
      resolvePathImpl: (p) => p
    });

    const result = mockSvc.generateStyles(layout);
    assert.strictEqual(metricCalls, 1, 'getMetricCSSImpl must be called once');
    assert.strictEqual(patternCalls, 1, 'getPatternCSSImpl must be called once');
    assert.strictEqual(existsCalls, 1, 'existsSyncImpl must be called once');
    assert.strictEqual(readCalls, 1, 'readFileSyncImpl must be called once');
    assert.ok(result.includes('/* MOCK METRIC CSS */'), 'Injected metric CSS must be included');
    assert.ok(result.includes('/* MOCK PATTERN CSS */'), 'Injected pattern CSS must be included');
    assert.ok(result.includes('data:font/truetype;base64,RkFLRV9GT05U'), 'Mock font base64 must be embedded');
  }
  console.log('✓ Section 2 Passed: Injected dependency call behavior locked.\n');

  // -------------------------------------------------------------
  // 3. FONT EMBEDDING & FALLBACK BEHAVIOR
  // -------------------------------------------------------------
  console.log('--- 3. Font Embedding & Fallback Behavior ---');
  {
    // A: File exists
    const fontSvcExists = createCompositionStyles({
      getMetricCSSImpl: () => '',
      getPatternCSSImpl: () => '',
      existsSyncImpl: () => true,
      readFileSyncImpl: () => Buffer.from('TEST_TTF_DATA'),
      resolvePathImpl: (p) => p
    });
    const resultExists = fontSvcExists.generateStyles(layout);
    assert.ok(resultExists.includes("url('data:font/truetype;base64,VEVTVF9UVEZfREFUQQ==') format('truetype')"), 'Must use base64 data URI when file exists');

    // B: File does not exist -> fallback path
    const fontSvcMissing = createCompositionStyles({
      getMetricCSSImpl: () => '',
      getPatternCSSImpl: () => '',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => { throw new Error('File not found'); },
      resolvePathImpl: (p) => p
    });
    const resultMissing = fontSvcMissing.generateStyles(layout);
    assert.ok(resultMissing.includes("url('assets/fonts/DVN-Grandy-gehcaa.ttf') format('truetype')"), 'Must use asset URL fallback when file is absent');
  }
  console.log('✓ Section 3 Passed: Font embedding and fallback behavior locked.\n');

  // -------------------------------------------------------------
  // 4. CSS VARIABLE & LAYOUT PROPERTY INTERPOLATION
  // -------------------------------------------------------------
  console.log('--- 4. CSS Variable & Layout Property Interpolation ---');
  {
    const customLayout = createLayout();
    customLayout.colors.accent = '#123456';
    customLayout.card.defaultTop = 1357;
    customLayout.card.infoLeft = 99;
    customLayout.card.width = 888;
    customLayout.subtitle.top = 1600;
    customLayout.subtitle.peakAnchorSize = 130;

    const customSvc = createCompositionStyles({
      getMetricCSSImpl: () => '',
      getPatternCSSImpl: () => '',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => '',
      resolvePathImpl: (p) => p
    });

    const out = customSvc.generateStyles(customLayout);
    assert.ok(out.includes('--cnfi-accent:     #123456;'), 'Must interpolate custom accent color');
    assert.ok(out.includes('top: 1357px;'), 'Must interpolate custom card defaultTop');
    assert.ok(out.includes('left: 99px;'), 'Must interpolate custom card infoLeft');
    assert.ok(out.includes('width: 888px;'), 'Must interpolate custom card width');
    assert.ok(out.includes('top: 1600px;'), 'Must interpolate custom subtitle top');
    assert.ok(out.includes('font-size: 130px !important;'), 'Must interpolate custom anchor font size');
  }
  console.log('✓ Section 4 Passed: CSS variable & layout interpolation locked.\n');

  // -------------------------------------------------------------
  // 5. METRIC & PATTERN CSS INCLUSION AND ORDERING
  // -------------------------------------------------------------
  console.log('--- 5. Metric & Pattern CSS Inclusion and Ordering ---');
  {
    const orderSvc = createCompositionStyles({
      getMetricCSSImpl: () => '/* ___METRIC_CSS_MARKER___ */',
      getPatternCSSImpl: () => '/* ___PATTERN_CSS_MARKER___ */',
      existsSyncImpl: () => false,
      readFileSyncImpl: () => '',
      resolvePathImpl: (p) => p
    });

    const out = orderSvc.generateStyles(layout);
    const patternIdx = out.indexOf('/* ___PATTERN_CSS_MARKER___ */');
    const metricIdx = out.indexOf('/* ___METRIC_CSS_MARKER___ */');

    assert.ok(patternIdx !== -1, 'Pattern CSS must be present');
    assert.ok(metricIdx !== -1, 'Metric CSS must be present');
    assert.ok(patternIdx < metricIdx, 'Pattern CSS must appear before Metric CSS in stylesheet');
  }
  console.log('✓ Section 5 Passed: Metric & pattern CSS ordering locked.\n');

  // -------------------------------------------------------------
  // 6. CHARACTER-FOR-CHARACTER FULL STYLESHEET EQUALITY & CHECKSUM
  // -------------------------------------------------------------
  console.log('--- 6. Full Character-for-Character Stylesheet Equality & Checksum ---');
  {
    const prodSvc = createCompositionStyles({
      getMetricCSSImpl: getMetricCSS,
      getPatternCSSImpl: getPatternCSS,
      readFileSyncImpl: fs.readFileSync,
      resolvePathImpl: path.resolve,
      existsSyncImpl: fs.existsSync
    });

    const actualExtractedStyles = prodSvc.generateStyles(layout);
    const actualSha256 = crypto.createHash('sha256').update(actualExtractedStyles).digest('hex');

    assert.strictEqual(
      actualExtractedStyles.length,
      EXPECTED_STYLESHEET_LENGTH,
      `Length mismatch: actual=${actualExtractedStyles.length}, expected=${EXPECTED_STYLESHEET_LENGTH}`
    );

    assert.strictEqual(
      actualSha256,
      EXPECTED_STYLESHEET_SHA256,
      `SHA256 checksum mismatch: actual=${actualSha256}, expected=${EXPECTED_STYLESHEET_SHA256}`
    );

    // If git object database has Base SHA, also do live character-for-character comparison against Base
    let basePipelineCode = null;
    try {
      basePipelineCode = execSync(`git show ${BASE_SHA}:pipeline.js`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {}

    if (basePipelineCode) {
      const baseLines = basePipelineCode.split('\n');
      const baseFontStart = baseLines.findIndex(l => l.includes('// Embed DVN Grandy as base64'));
      const baseStyleStart = baseLines.findIndex((l, i) => i > baseFontStart && l.includes('<!-- DVN Grandy'));
      const baseStyleEnd = baseLines.findIndex((l, i) => i > baseStyleStart && l.includes('    </style>') && baseLines[i + 1] && baseLines[i + 1].includes('  </head>'));

      const tempEvalScript = path.resolve('temp_eval_baseline_styles.js');
      const scriptContent = `
import fs from 'fs';
import path from 'path';
import { createLayout } from './src/pipeline/layout.js';
import { getMetricCSS } from './metricRenderer.js';
import { getPatternCSS } from './visualPatternRenderer.js';

const LAYOUT = createLayout();

const _dvnFontPath = path.resolve('assets/fonts/DVN-Grandy-gehcaa.ttf');
const _dvnFontB64  = fs.existsSync(_dvnFontPath)
  ? fs.readFileSync(_dvnFontPath).toString('base64')
  : '';
const _dvnFontSrc  = _dvnFontB64
  ? \`url('data:font/truetype;base64,\${_dvnFontB64}') format('truetype')\`
  : \`url('assets/fonts/DVN-Grandy-gehcaa.ttf') format('truetype')\`;

const baseStyles = \`${baseLines.slice(baseStyleStart, baseStyleEnd + 1).join('\n')}\`;
process.stdout.write(baseStyles);
`;
      fs.writeFileSync(tempEvalScript, scriptContent, 'utf8');
      try {
        const expectedBaselineStyles = execSync(`node "${tempEvalScript}"`, { encoding: 'utf8' });
        assert.strictEqual(
          actualExtractedStyles,
          expectedBaselineStyles,
          'Extracted composition styles must match baseline character-for-character with ZERO deviation!'
        );
      } finally {
        try { fs.unlinkSync(tempEvalScript); } catch {}
      }
    }

    console.log(`✓ Character count: ${actualExtractedStyles.length} characters matched 100% identically.`);
    console.log(`✓ Stylesheet SHA256: ${actualSha256} locked.`);
  }
  console.log('✓ Section 6 Passed: Character-for-character stylesheet equality locked.\n');

  console.log('==================================================================');
  console.log('✓ ALL 6 COMPOSITION STYLES CHARACTERIZATION SECTIONS PASSED 100%!');
  console.log('==================================================================\n');
}

runCompositionStylesCharacterizationTests().catch(err => {
  console.error('❌ COMPOSITION STYLES CHARACTERIZATION FAILED:', err);
  process.exit(1);
});
