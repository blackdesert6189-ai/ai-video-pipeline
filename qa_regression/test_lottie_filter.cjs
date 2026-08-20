const assert = require('assert');

console.log('=== LOTTIE FILTER TEST SUITE ===\n');

async function runTests() {
  const { getLottieIconFilter } = await import('../src/pipeline/lottieFilter.js');

  const NORMAL_GLOW = 'drop-shadow(0 0 20px rgba(166,255,61,0.88)) drop-shadow(0 4px 12px rgba(0,0,0,0.6))';
  const WARN_GLOW = 'drop-shadow(0 0 14px rgba(255,68,68,0.88)) drop-shadow(0 4px 12px rgba(0,0,0,0.55))';

  // -------------------------------------------------------------
  // TEST 1: null animData -> default avg = 0.5 -> brightness(1.6)
  // -------------------------------------------------------------
  {
    const res = getLottieIconFilter(null, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 1 PASSED: null animData uses default 0.5 luminance');
  }

  // -------------------------------------------------------------
  // TEST 2: undefined animData -> default avg = 0.5
  // -------------------------------------------------------------
  {
    const res = getLottieIconFilter(undefined, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 2 PASSED: undefined animData uses default 0.5 luminance');
  }

  // -------------------------------------------------------------
  // TEST 3: empty object {} -> default avg = 0.5
  // -------------------------------------------------------------
  {
    const res = getLottieIconFilter({}, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 3 PASSED: empty object {} uses default 0.5 luminance');
  }

  // -------------------------------------------------------------
  // TEST 4: { layers: [] } -> default avg = 0.5
  // -------------------------------------------------------------
  {
    const res = getLottieIconFilter({ layers: [] }, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 4 PASSED: empty layers [] uses default 0.5 luminance');
  }

  // -------------------------------------------------------------
  // TEST 5: solid background layer (layer.ty === 1) is skipped
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { ty: 1, shapes: [{ ty: 'fl', c: { k: [0.01, 0.01, 0.01] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 5 PASSED: solid layer (ty === 1) skipped');
  }

  // -------------------------------------------------------------
  // TEST 6: named bg layers skipped (bg, bkg, background, backdrop)
  // -------------------------------------------------------------
  {
    for (const name of ['bg', 'bkg', 'background', 'backdrop', '  BACKGROUND  ']) {
      const anim = {
        layers: [
          { nm: name, shapes: [{ ty: 'fl', c: { k: [0.01, 0.01, 0.01] } }] }
        ]
      };
      const res = getLottieIconFilter(anim, false);
      assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    }
    console.log('✓ TEST 6 PASSED: named background layers skipped');
  }

  // -------------------------------------------------------------
  // TEST 7: static fill dark (avg < 0.20)
  // [0.05, 0.05, 0.05] -> lum = 0.05 -> brightness(4.5) contrast(0.85)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.05, 0.05, 0.05] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(4.5) contrast(0.85) ' + NORMAL_GLOW);
    console.log('✓ TEST 7 PASSED: static fill dark (< 0.20) produces brightness(4.5) contrast(0.85)');
  }

  // -------------------------------------------------------------
  // TEST 8: static stroke (s.ty === 'st') handled identically
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'st', c: { k: [0.05, 0.05, 0.05] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(4.5) contrast(0.85) ' + NORMAL_GLOW);
    console.log('✓ TEST 8 PASSED: static stroke handled identically to fill');
  }

  // -------------------------------------------------------------
  // TEST 9: animated color keyframes kf.s = [r, g, b]
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        {
          shapes: [
            { ty: 'fl', c: { k: [{ s: [0.05, 0.05, 0.05] }, { s: [0.05, 0.05, 0.05] }] } }
          ]
        }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(4.5) contrast(0.85) ' + NORMAL_GLOW);
    console.log('✓ TEST 9 PASSED: animated color keyframes extracted and averaged');
  }

  // -------------------------------------------------------------
  // TEST 10: nested shape group (s.it)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        {
          shapes: [
            { ty: 'gr', it: [{ ty: 'fl', c: { k: [0.05, 0.05, 0.05] } }] }
          ]
        }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(4.5) contrast(0.85) ' + NORMAL_GLOW);
    console.log('✓ TEST 10 PASSED: nested shape group (s.it) traversed recursively');
  }

  // -------------------------------------------------------------
  // TEST 11: nested layer (layer.layers)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        {
          layers: [
            { shapes: [{ ty: 'fl', c: { k: [0.05, 0.05, 0.05] } }] }
          ]
        }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(4.5) contrast(0.85) ' + NORMAL_GLOW);
    console.log('✓ TEST 11 PASSED: nested layers (layer.layers) traversed recursively');
  }

  // -------------------------------------------------------------
  // TEST 12: multiple color samples averaged
  // Sample 1: 0.10, Sample 2: 0.50 -> avg = 0.30 -> brightness(2.5)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        {
          shapes: [
            { ty: 'fl', c: { k: [0.10, 0.10, 0.10] } },
            { ty: 'fl', c: { k: [0.50, 0.50, 0.50] } }
          ]
        }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(2.5) ' + NORMAL_GLOW);
    console.log('✓ TEST 12 PASSED: multiple color samples correctly averaged (0.30)');
  }

  // -------------------------------------------------------------
  // TEST 13: dark boundary below 0.20 (avg = 0.199)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.199, 0.199, 0.199] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(4.5) contrast(0.85) ' + NORMAL_GLOW);
    console.log('✓ TEST 13 PASSED: avg < 0.20 produces dark filter');
  }

  // -------------------------------------------------------------
  // TEST 14: exact avg = 0.20 (falls into 0.20 <= avg < 0.40)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.20, 0.20, 0.20] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(2.5) ' + NORMAL_GLOW);
    console.log('✓ TEST 14 PASSED: exact avg = 0.20 produces brightness(2.5)');
  }

  // -------------------------------------------------------------
  // TEST 15: avg just below 0.40 (avg = 0.399)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.399, 0.399, 0.399] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(2.5) ' + NORMAL_GLOW);
    console.log('✓ TEST 15 PASSED: avg just below 0.40 produces brightness(2.5)');
  }

  // -------------------------------------------------------------
  // TEST 16: exact avg = 0.40 (falls into 0.40 <= avg < 0.55)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.40, 0.40, 0.40] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 16 PASSED: exact avg = 0.40 produces brightness(1.6)');
  }

  // -------------------------------------------------------------
  // TEST 17: avg just below 0.55 (avg = 0.549)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.549, 0.549, 0.549] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 17 PASSED: avg just below 0.55 produces brightness(1.6)');
  }

  // -------------------------------------------------------------
  // TEST 18: exact avg = 0.55 (falls into avg >= 0.55 -> glow only)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.55, 0.55, 0.55] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, NORMAL_GLOW);
    console.log('✓ TEST 18 PASSED: exact avg = 0.55 produces glow only without brightness prefix');
  }

  // -------------------------------------------------------------
  // TEST 19: warning glow string (isWarn = true)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.90, 0.90, 0.90] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, true);
    assert.strictEqual(res, WARN_GLOW);
    console.log('✓ TEST 19 PASSED: isWarn = true uses exact warning red glow');
  }

  // -------------------------------------------------------------
  // TEST 20: normal glow string (isWarn = false)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.90, 0.90, 0.90] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, NORMAL_GLOW);
    console.log('✓ TEST 20 PASSED: isWarn = false uses exact lime green glow');
  }

  // -------------------------------------------------------------
  // TEST 21: isWarn truthiness (true, false, 1, 0, 'yes', '')
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [0.90, 0.90, 0.90] } }] }
      ]
    };
    assert.strictEqual(getLottieIconFilter(anim, true), WARN_GLOW);
    assert.strictEqual(getLottieIconFilter(anim, 1), WARN_GLOW);
    assert.strictEqual(getLottieIconFilter(anim, 'yes'), WARN_GLOW);
    assert.strictEqual(getLottieIconFilter(anim, false), NORMAL_GLOW);
    assert.strictEqual(getLottieIconFilter(anim, 0), NORMAL_GLOW);
    assert.strictEqual(getLottieIconFilter(anim, ''), NORMAL_GLOW);
    console.log('✓ TEST 21 PASSED: isWarn truthiness preserved for all types');
  }

  // -------------------------------------------------------------
  // TEST 22: unrelated shape type (ty !== 'fl' and ty !== 'st') ignored
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'tr', c: { k: [0.01, 0.01, 0.01] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 22 PASSED: non-fill/stroke shape types ignored');
  }

  // -------------------------------------------------------------
  // TEST 23: missing c property ignored
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl' }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 23 PASSED: shape missing c property safely ignored');
  }

  // -------------------------------------------------------------
  // TEST 24: missing c.k property ignored
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: {} }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, 'brightness(1.6) ' + NORMAL_GLOW);
    console.log('✓ TEST 24 PASSED: shape missing c.k property safely ignored');
  }

  // -------------------------------------------------------------
  // TEST 25: static RGB values outside 0..1 (no clamping)
  // k = [2.0, 2.0, 2.0] -> avg = 2.0 >= 0.55 -> glow only
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [2.0, 2.0, 2.0] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, NORMAL_GLOW);
    console.log('✓ TEST 25 PASSED: static RGB outside 0..1 evaluated without artificial clamping');
  }

  // -------------------------------------------------------------
  // TEST 26: malformed animated keyframe (missing components -> NaN -> glow only)
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        { shapes: [{ ty: 'fl', c: { k: [{ s: [0.1] }] } }] }
      ]
    };
    const res = getLottieIconFilter(anim, false);
    assert.strictEqual(res, NORMAL_GLOW);
    console.log('✓ TEST 26 PASSED: malformed animated keyframe resulting in NaN falls through to glow only');
  }

  // -------------------------------------------------------------
  // TEST 27: malformed truthy non-array layers -> throws natural TypeError
  // -------------------------------------------------------------
  {
    assert.throws(() => {
      getLottieIconFilter({ layers: {} }, false);
    }, TypeError);
    console.log('✓ TEST 27 PASSED: malformed non-array layers raises natural TypeError');
  }

  // -------------------------------------------------------------
  // TEST 28: malformed truthy non-array layer.shapes -> throws natural TypeError
  // -------------------------------------------------------------
  {
    assert.throws(() => {
      getLottieIconFilter({ layers: [{ shapes: {} }] }, false);
    }, TypeError);
    console.log('✓ TEST 28 PASSED: malformed non-array layer.shapes raises natural TypeError');
  }

  // -------------------------------------------------------------
  // TEST 29: malformed truthy non-array shape.it -> throws natural TypeError
  // -------------------------------------------------------------
  {
    assert.throws(() => {
      getLottieIconFilter({ layers: [{ shapes: [{ it: {} }] }] }, false);
    }, TypeError);
    console.log('✓ TEST 29 PASSED: malformed non-array shape.it raises natural TypeError');
  }

  // -------------------------------------------------------------
  // TEST 30: input immutability
  // -------------------------------------------------------------
  {
    const anim = {
      layers: [
        {
          nm: 'icon_layer',
          shapes: [
            { ty: 'fl', c: { k: [0.15, 0.25, 0.35] } },
            { ty: 'st', c: { k: [{ s: [0.10, 0.20, 0.30] }] } },
            { ty: 'gr', it: [{ ty: 'fl', c: { k: [0.5, 0.5, 0.5] } }] }
          ]
        }
      ]
    };
    const snapshot = JSON.stringify(anim);
    getLottieIconFilter(anim, false);
    getLottieIconFilter(anim, true);
    assert.strictEqual(JSON.stringify(anim), snapshot);
    console.log('✓ TEST 30 PASSED: input animData object is completely immutable');
  }

  console.log('\n====================================');
  console.log('✅ ALL 30 CHARACTERIZATION TESTS PASSED');
  console.log('====================================\n');
}

runTests().catch(err => {
  console.error('❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
