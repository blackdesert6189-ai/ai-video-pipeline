const assert = require('assert');
const path = require('path');

console.log('=== PEAK SMART INDENT TEST SUITE ===\n');

async function runTests() {
  const { createPeakSmartIndent } = await import('../src/pipeline/peakSmartIndent.js');

  // Baseline mock configuration matching standard LAYOUT constants
  const defaultLayoutPeak = {
    peakSmartIndentEnabled: true,
    peakSmartFirstCharRatio: 0.50,
    peakSmartRegCharRatio: 0.55,
    peakSmartScriptCharRatio: 0.48,
    peakSmartAvgWordChars: 3.0,
    peakSmartClimaxTopPullRatio: 0.35,
  };

  const defaultLayoutSubtitle = {
    width: 1000,
    peakAnchorSize: 124,
    peakSmartFirstCharWidth: 62, // Math.round(124 * 0.50)
    peakConnectorSize: 28,
    peakRegularSize: 52,
    peakScriptSize: 68,
    peakScriptClimaxSize: 96,
    peakIndentStep: 16,
  };

  function getHelper(peakOverrides = {}, subOverrides = {}) {
    const layoutPeak = { ...defaultLayoutPeak, ...peakOverrides };
    const layoutSubtitle = { ...defaultLayoutSubtitle, ...subOverrides };
    return createPeakSmartIndent({ layoutPeak, layoutSubtitle }).getPeakSmartIndents;
  }

  // -------------------------------------------------------------
  // TEST 1: Feature flag disabled -> returns null
  // -------------------------------------------------------------
  {
    const getIndents = getHelper({ peakSmartIndentEnabled: false });
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'rất ngon', type: 'script_climax' }
    ]);
    assert.strictEqual(res, null);
    console.log('✓ TEST 1 PASSED: feature flag disabled returns null');
  }

  // -------------------------------------------------------------
  // TEST 2: First chunk not anchor -> returns null
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'bắt đầu', type: 'regular' },
      { text: 'rất ngon', type: 'script_climax' }
    ]);
    assert.strictEqual(res, null);
    console.log('✓ TEST 2 PASSED: first chunk not anchor returns null');
  }

  // -------------------------------------------------------------
  // TEST 3: Last chunk not script_climax -> returns null
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'kết thúc', type: 'regular' }
    ]);
    assert.strictEqual(res, null);
    console.log('✓ TEST 3 PASSED: last chunk not script_climax returns null');
  }

  // -------------------------------------------------------------
  // TEST 4: Valid 2-chunk case -> exact { indents: [0, firstCharW], climaxExtraTopPull: 0 }
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'rất ngon giấc', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res, {
      indents: [0, 62],
      climaxExtraTopPull: 0
    });
    console.log('✓ TEST 4 PASSED: valid 2-chunk case returns exact staircase [0, firstCharW] and pull 0');
  }

  // -------------------------------------------------------------
  // TEST 5: 3-chunk middle regular -> exact midFontSz = peakRegularSize (52)
  // midWords = ['đạt', 'điểm'] (length 2)
  // midEstW = Math.round(2 * 52 * 0.55 * 3.0) = Math.round(171.6) = 172
  // scWords = ['cao', 'hơn'] (length 2)
  // scEstW = Math.round(2 * 96 * 0.48 * 3.0) = Math.round(276.48) = 276
  // rawLine3Indent = 62 + 172 = 234
  // maxSafeIndent = Math.max(1000 - 276 - 20, 62) = 704
  // line3Indent = Math.min(234, 704) = 234
  // climaxExtraTopPull = Math.round(52 * 0.35) = Math.round(18.2) = 18
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res, {
      indents: [0, 62, 234],
      climaxExtraTopPull: 18
    });
    console.log('✓ TEST 5 PASSED: 3-chunk middle regular computes exact font (52) and pull (18)');
  }

  // -------------------------------------------------------------
  // TEST 6: Middle connector -> peakConnectorSize (28)
  // midWords = ['trong', 'khi'] (length 2)
  // midEstW = Math.round(2 * 28 * 0.55 * 3.0) = Math.round(92.4) = 92
  // scEstW = 276
  // rawLine3Indent = 62 + 92 = 154
  // line3Indent = 154
  // climaxExtraTopPull = Math.round(28 * 0.35) = Math.round(9.8) = 10
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'trong khi', type: 'connector' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res, {
      indents: [0, 62, 154],
      climaxExtraTopPull: 10
    });
    console.log('✓ TEST 6 PASSED: middle connector uses peakConnectorSize (28) and pull (10)');
  }

  // -------------------------------------------------------------
  // TEST 7: Middle script -> peakScriptSize (68)
  // midWords = ['thực', 'sự'] (length 2)
  // midEstW = Math.round(2 * 68 * 0.55 * 3.0) = Math.round(224.4) = 224
  // rawLine3Indent = 62 + 224 = 286
  // climaxExtraTopPull = Math.round(68 * 0.35) = Math.round(23.8) = 24
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'thực sự', type: 'script' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res, {
      indents: [0, 62, 286],
      climaxExtraTopPull: 24
    });
    console.log('✓ TEST 7 PASSED: middle script uses peakScriptSize (68) and pull (24)');
  }

  // -------------------------------------------------------------
  // TEST 8: Middle anchor -> peakAnchorSize (124)
  // midWords = ['bí', 'mật'] (length 2)
  // midEstW = Math.round(2 * 124 * 0.55 * 3.0) = Math.round(409.2) = 409
  // rawLine3Indent = 62 + 409 = 471
  // climaxExtraTopPull = Math.round(124 * 0.35) = Math.round(43.4) = 43
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'bí mật', type: 'anchor' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res, {
      indents: [0, 62, 471],
      climaxExtraTopPull: 43
    });
    console.log('✓ TEST 8 PASSED: middle anchor uses peakAnchorSize (124) and pull (43)');
  }

  // -------------------------------------------------------------
  // TEST 9: Middle script_climax -> peakScriptClimaxSize (96)
  // midWords = ['tột', 'đỉnh'] (length 2)
  // midEstW = Math.round(2 * 96 * 0.55 * 3.0) = Math.round(316.8) = 317
  // rawLine3Indent = 62 + 317 = 379
  // climaxExtraTopPull = Math.round(96 * 0.35) = Math.round(33.6) = 34
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'tột đỉnh', type: 'script_climax' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res, {
      indents: [0, 62, 379],
      climaxExtraTopPull: 34
    });
    console.log('✓ TEST 9 PASSED: middle script_climax uses peakScriptClimaxSize (96) and pull (34)');
  }

  // -------------------------------------------------------------
  // TEST 10: Unknown middle type fallback -> peakRegularSize (52)
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'custom_unknown' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res, {
      indents: [0, 62, 234],
      climaxExtraTopPull: 18
    });
    console.log('✓ TEST 10 PASSED: unknown middle type fallback uses peakRegularSize (52)');
  }

  // -------------------------------------------------------------
  // TEST 11: Exact midWords tokenization (trim and multi-space collapse)
  // '   đạt    nhiều   điểm   ' -> 3 words
  // midEstW = Math.round(3 * 52 * 0.55 * 3.0) = Math.round(257.4) = 257
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: '   đạt    nhiều   điểm   ', type: 'regular' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.strictEqual(res.indents[2], 62 + 257);
    console.log('✓ TEST 11 PASSED: exact midWords tokenization with whitespace filtering');
  }

  // -------------------------------------------------------------
  // TEST 12: Exact scWords tokenization
  // '   rất   nhanh   chóng   ' -> 3 words
  // scEstW = Math.round(3 * 96 * 0.48 * 3.0) = Math.round(414.72) = 415
  // maxSafeIndent = 1000 - 415 - 20 = 565
  // rawLine3Indent = 62 + 172 = 234 -> min(234, 565) = 234
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: '   rất   nhanh   chóng   ', type: 'script_climax' }
    ]);
    assert.strictEqual(res.indents[2], 234);
    console.log('✓ TEST 12 PASSED: exact scWords tokenization with whitespace filtering');
  }

  // -------------------------------------------------------------
  // TEST 13: Exact midEstW rounding boundary check
  // 1 word of regular: 1 * 52 * 0.55 * 3.0 = 85.8 -> Math.round = 86
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'nhanh', type: 'regular' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.strictEqual(res.indents[2], 62 + 86);
    console.log('✓ TEST 13 PASSED: exact midEstW Math.round rounding verified');
  }

  // -------------------------------------------------------------
  // TEST 14: Exact scEstW rounding boundary check
  // 1 word of script_climax: 1 * 96 * 0.48 * 3.0 = 138.24 -> Math.round = 138
  // -------------------------------------------------------------
  {
    const getIndents = getHelper({}, { width: 300 }); // container width 300
    // scEstW = 138
    // maxSafeIndent = Math.max(300 - 138 - 20, 62) = 142
    // mid: 2 words = 172 -> raw = 62 + 172 = 234
    // capped = Math.min(234, 142) = 142
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: 'nhanh', type: 'script_climax' }
    ]);
    assert.strictEqual(res.indents[2], 142);
    console.log('✓ TEST 14 PASSED: exact scEstW Math.round rounding verified');
  }

  // -------------------------------------------------------------
  // TEST 15: Uncapped line3Indent path (rawLine3Indent < maxSafeIndent)
  // -------------------------------------------------------------
  {
    const getIndents = getHelper({}, { width: 1200 });
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.strictEqual(res.indents[2], 62 + 172);
    console.log('✓ TEST 15 PASSED: uncapped line3Indent matches rawLine3Indent');
  }

  // -------------------------------------------------------------
  // TEST 16: Capped line3Indent path (rawLine3Indent > maxSafeIndent)
  // width: 400, scWords 2 -> scEstW 276
  // maxSafeIndent = Math.max(400 - 276 - 20, 62) = Math.max(104, 62) = 104
  // raw = 234 -> capped at 104
  // -------------------------------------------------------------
  {
    const getIndents = getHelper({}, { width: 400 });
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.strictEqual(res.indents[2], 104);
    console.log('✓ TEST 16 PASSED: capped line3Indent correctly restricted by maxSafeIndent');
  }

  // -------------------------------------------------------------
  // TEST 17: maxSafeIndent lower bound (width - scEstW - 20 < firstCharW)
  // width: 200, scWords 2 -> scEstW 276
  // 200 - 276 - 20 = -96 < 62 -> maxSafeIndent = 62
  // raw = 234 -> line3Indent = 62
  // -------------------------------------------------------------
  {
    const getIndents = getHelper({}, { width: 200 });
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.strictEqual(res.indents[2], 62);
    console.log('✓ TEST 17 PASSED: maxSafeIndent lower bound floored at firstCharW');
  }

  // -------------------------------------------------------------
  // TEST 18: climaxExtraTopPull rounding check
  // midFontSz = 28 -> Math.round(28 * 0.35) = Math.round(9.8) = 10
  // midFontSz = 52 -> Math.round(52 * 0.35) = Math.round(18.2) = 18
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res1 = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'trong', type: 'connector' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.strictEqual(res1.climaxExtraTopPull, 10);

    const res2 = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'trong', type: 'regular' },
      { text: 'cao hơn', type: 'script_climax' }
    ]);
    assert.strictEqual(res2.climaxExtraTopPull, 18);
    console.log('✓ TEST 18 PASSED: climaxExtraTopPull rounded accurately for all ratios');
  }

  // -------------------------------------------------------------
  // TEST 19: 4-chunk output preserves chunks[2] for scChunk and line 4 gets fallback 3 * peakIndentStep
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: 'cao hơn', type: 'regular' },
      { text: 'vượt trội', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res.indents, [0, 62, 234, 48]);
    assert.strictEqual(res.climaxExtraTopPull, 18);
    console.log('✓ TEST 19 PASSED: 4-chunk output matches exact indices [0, 62, 234, 48]');
  }

  // -------------------------------------------------------------
  // TEST 20: 5-chunk output preserves exact step fallbacks for i >= 3
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const res = getIndents([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: 'cao hơn', type: 'regular' },
      { text: 'rất nhiều', type: 'regular' },
      { text: 'vượt trội', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res.indents, [0, 62, 234, 48, 64]);
    console.log('✓ TEST 20 PASSED: 5-chunk output matches exact indices [0, 62, 234, 48, 64]');
  }

  // -------------------------------------------------------------
  // TEST 21: Input immutability
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    const chunks = [
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt điểm', type: 'regular' },
      { text: 'cao hơn', type: 'script_climax' }
    ];
    const snapshot = JSON.stringify(chunks);
    getIndents(chunks);
    assert.strictEqual(JSON.stringify(chunks), snapshot);
    console.log('✓ TEST 21 PASSED: input chunks array and objects are completely immutable');
  }

  // -------------------------------------------------------------
  // TEST 22: Injected layout config values used faithfully without hardcoded defaults
  // -------------------------------------------------------------
  {
    const customGet = createPeakSmartIndent({
      layoutPeak: {
        peakSmartIndentEnabled: true,
        peakSmartRegCharRatio: 0.60,
        peakSmartScriptCharRatio: 0.50,
        peakSmartAvgWordChars: 4.0,
        peakSmartClimaxTopPullRatio: 0.40,
      },
      layoutSubtitle: {
        width: 800,
        peakAnchorSize: 100,
        peakSmartFirstCharWidth: 50,
        peakConnectorSize: 20,
        peakRegularSize: 40,
        peakScriptSize: 50,
        peakScriptClimaxSize: 80,
        peakIndentStep: 20,
      }
    }).getPeakSmartIndents;

    // midWords 1 ('đạt') * 40 * 0.60 * 4.0 = 96
    // scWords 1 ('cao') * 80 * 0.50 * 4.0 = 160
    // rawLine3 = 50 + 96 = 146
    // maxSafe = 800 - 160 - 20 = 620
    // pull = Math.round(40 * 0.40) = 16
    const res = customGet([
      { text: 'ngủ sâu', type: 'anchor' },
      { text: 'đạt', type: 'regular' },
      { text: 'cao', type: 'script_climax' }
    ]);
    assert.deepStrictEqual(res, {
      indents: [0, 50, 146],
      climaxExtraTopPull: 16
    });
    console.log('✓ TEST 22 PASSED: injected layout config values drive calculations directly');
  }

  // -------------------------------------------------------------
  // TEST 23: Natural failure when configuration is missing / undefined
  // -------------------------------------------------------------
  {
    const getIndents = createPeakSmartIndent({}).getPeakSmartIndents;
    assert.throws(() => {
      getIndents([{ text: 'ngủ sâu', type: 'anchor' }, { text: 'cao', type: 'script_climax' }]);
    }, TypeError);
    console.log('✓ TEST 23 PASSED: missing configuration raises natural TypeError without artificial guards');
  }

  // -------------------------------------------------------------
  // TEST 24: Malformed chunks natural TypeError
  // -------------------------------------------------------------
  {
    const getIndents = getHelper();
    // Empty array chunks -> chunks[0] is undefined -> chunks[0].type throws TypeError
    assert.throws(() => {
      getIndents([]);
    }, TypeError);

    // Null chunks -> chunks[0] throws TypeError
    assert.throws(() => {
      getIndents(null);
    }, TypeError);
    console.log('✓ TEST 24 PASSED: malformed chunks raise natural TypeError preserving baseline behavior');
  }

  console.log('\n====================================');
  console.log('✅ ALL 24 CHARACTERIZATION TESTS PASSED');
  console.log('====================================\n');
}

runTests().catch(err => {
  console.error('❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
