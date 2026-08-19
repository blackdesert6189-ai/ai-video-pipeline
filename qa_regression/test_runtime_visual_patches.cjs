const assert = require('assert');

// Dynamic import for ES module under test
async function runTests() {
  console.log('=== RUNTIME VISUAL PATCHES CHARACTERIZATION SUITE ===\n');

  const { applyRuntimeVisualPatches } = await import('../src/pipeline/runtimeVisualPatches.js');
  assert(typeof applyRuntimeVisualPatches === 'function', 'applyRuntimeVisualPatches must be exported as a function');

  let allPassed = true;

  // Mock Page helper
  function createMockPage() {
    const calls = {
      addStyleTag: [],
      evaluate: []
    };

    const mockPage = {
      calls,
      async addStyleTag(opts) {
        calls.addStyleTag.push(opts);
      },
      async evaluate(fn, ...args) {
        calls.evaluate.push({ fn, args });
      }
    };

    return mockPage;
  }

  // -------------------------------------------------------------
  // TEST 1: Exact call count and interface contract
  // -------------------------------------------------------------
  try {
    const mockPage = createMockPage();
    const defaultLayout = {
      card: {
        statLeft: 70,
        infoLeft: 70
      }
    };

    await applyRuntimeVisualPatches(mockPage, defaultLayout);

    assert.strictEqual(mockPage.calls.addStyleTag.length, 1, 'addStyleTag must be called exactly once');
    assert.strictEqual(mockPage.calls.evaluate.length, 1, 'page.evaluate must be called exactly once');

    console.log('✓ TEST 1 PASSED: addStyleTag and page.evaluate called exactly once with no extra calls');
  } catch (err) {
    console.error('❌ TEST 1 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 2: CSS content & critical selector preservation
  // -------------------------------------------------------------
  try {
    const mockPage = createMockPage();
    const layout = {
      card: {
        statLeft: 85,
        infoLeft: 95
      }
    };

    await applyRuntimeVisualPatches(mockPage, layout);

    const css = mockPage.calls.addStyleTag[0]?.content;
    assert(typeof css === 'string' && css.length > 500, 'CSS content must be a non-empty string');

    // Verify layout interpolation
    assert(css.includes('left: 85px !important;'), 'CSS must interpolate layout.card.statLeft');
    assert(css.includes('left: 95px !important;'), 'CSS must interpolate layout.card.infoLeft');

    // Verify frozen critical selectors
    const criticalSelectors = [
      '#root .global-neon-rail',
      '#root .semantic-layer',
      '#root .card-container',
      '#root .card-stat',
      '#root .card-stat .stat-neon-bar',
      '#root .card',
      '#root .stat-value',
      '#root .stat-number',
      '#root .sentence',
      '#root .word',
      '#root .peak-chunk-anchor .word',
      '#root .peak-chunk-script-climax .word',
      '#root .subtitle-container .sentence-peak'
    ];

    for (const sel of criticalSelectors) {
      assert(css.includes(sel), `CSS must include critical selector "${sel}"`);
    }

    // Verify key style rules
    assert(css.includes('box-shadow: 0 0 10px #a6ff3d'), 'CSS must include neon glow box-shadow');
    assert(css.includes('margin-right: 0.09em !important;'), 'CSS must include anchor word gap (0.09em)');
    assert(css.includes('margin-right: 0.15em !important;'), 'CSS must include script_climax word gap (0.15em)');

    console.log('✓ TEST 2 PASSED: CSS contains all frozen selectors, exact rules, and proper layout interpolation');
  } catch (err) {
    console.error('❌ TEST 2 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 3: DOM Evaluation Callback verification
  // -------------------------------------------------------------
  try {
    const mockPage = createMockPage();
    await applyRuntimeVisualPatches(mockPage);

    const evaluateCall = mockPage.calls.evaluate[0];
    assert(typeof evaluateCall.fn === 'function', 'evaluate callback must be a valid function');

    const fnSource = evaluateCall.fn.toString();
    assert(fnSource.includes('global-neon-rail'), 'DOM callback must construct .global-neon-rail if missing');
    assert(fnSource.includes('.peak-chunk-script-climax'), 'DOM callback must query .peak-chunk-script-climax');
    assert(fnSource.includes('getBoundingClientRect'), 'DOM callback must measure chunk bounds via getBoundingClientRect');
    assert(fnSource.includes('paddingLeft'), 'DOM callback must adjust Tetris paddingLeft');

    console.log('✓ TEST 3 PASSED: DOM callback preserves neon-rail injection and Tetris positioning logic');
  } catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 4: Error propagation fail-closed semantics
  // -------------------------------------------------------------
  try {
    const errorPage1 = {
      async addStyleTag() {
        throw new Error('Puppeteer CSS Injection Failed');
      },
      async evaluate() {}
    };

    let thrown1 = false;
    try {
      await applyRuntimeVisualPatches(errorPage1);
    } catch (e) {
      if (e.message.includes('Puppeteer CSS Injection Failed')) thrown1 = true;
    }
    assert(thrown1, 'applyRuntimeVisualPatches must fail closed when addStyleTag throws');

    const errorPage2 = {
      async addStyleTag() {},
      async evaluate() {
        throw new Error('Puppeteer DOM Evaluation Failed');
      }
    };

    let thrown2 = false;
    try {
      await applyRuntimeVisualPatches(errorPage2);
    } catch (e) {
      if (e.message.includes('Puppeteer DOM Evaluation Failed')) thrown2 = true;
    }
    assert(thrown2, 'applyRuntimeVisualPatches must fail closed when evaluate throws');

    console.log('✓ TEST 4 PASSED: Errors from page.addStyleTag and page.evaluate propagate faithfully');
  } catch (err) {
    console.error('❌ TEST 4 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // FINAL SUITE RESULT
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  if (allPassed) {
    console.log('✓ ALL RUNTIME VISUAL PATCHES CHARACTERIZATION TESTS PASSED 100%');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED IN RUNTIME VISUAL PATCHES CHARACTERIZATION SUITE');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
