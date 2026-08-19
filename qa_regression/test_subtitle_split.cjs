/**
 * ============================================================
 * Subtitle Sentence Splitting Characterization Test Suite
 * ============================================================
 * Characterizes exact behavior of VIET_PHRASE_STARTERS,
 * findSemanticSplitPoint, splitLongSentences, and
 * _splitLongSentencesOnce across all branch conditions.
 * ============================================================
 */

const assert = require('assert');

function foldText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function dummyNormalizeSentence(s) {
  return {
    ...s,
    normalized: true
  };
}

async function runTests() {
  console.log('=== SUBTITLE SENTENCE SPLITTER TEST SUITE ===\n');

  const {
    VIET_PHRASE_STARTERS,
    findSemanticSplitPoint,
    createSubtitleSplitter
  } = await import('../src/pipeline/subtitleSplit.js');

  let allPassed = true;

  // -------------------------------------------------------------
  // TEST 1: Short normal sentence (<= maxWords)
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: dummyNormalizeSentence,
      foldText,
      maxWordsDefault: 6,
      warn: console.warn
    });

    const s1 = { index: 0, startTime: 1.0, endTime: 3.0, words: ['Một', 'ngày', 'đẹp', 'trời'], text: 'Một ngày đẹp trời', style: 'normal' };
    const input = [s1];
    const out = splitter.splitLongSentences(input);

    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0], s1, 'Pass-through sentence MUST retain strict reference identity');
    assert.deepStrictEqual(out[0], s1);
    console.log('✓ TEST 1 PASSED: Short normal sentence preserved with exact reference');
  } catch (err) {
    console.error('❌ TEST 1 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 2: Exactly maxWords (no split)
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: dummyNormalizeSentence,
      foldText,
      maxWordsDefault: 6,
      warn: console.warn
    });

    const s2 = { index: 1, startTime: 3.0, endTime: 6.0, words: ['Một', 'hai', 'ba', 'bốn', 'năm', 'sáu'], text: 'Một hai ba bốn năm sáu', style: 'normal' };
    const out = splitter.splitLongSentences([s2]);

    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0], s2, 'Sentence at exact maxWords must retain reference identity');
    console.log('✓ TEST 2 PASSED: Sentence exactly at maxWords not split');
  } catch (err) {
    console.error('❌ TEST 2 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 3: Normal sentence > maxWords
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: dummyNormalizeSentence,
      foldText,
      maxWordsDefault: 6,
      warn: console.warn
    });

    const s3 = {
      index: 2,
      startTime: 2.0,
      endTime: 10.0,
      words: ['Đây', 'là', 'một', 'câu', 'khá', 'dài', 'để', 'thử'],
      text: 'Đây là một câu khá dài để thử',
      style: 'normal'
    };
    const s3Clone = JSON.parse(JSON.stringify(s3));

    const out = splitter.splitLongSentences([s3]);

    assert.strictEqual(out.length, 2);
    assert.notStrictEqual(out[0], s3, 'Split output 1 must be a new object');
    assert.notStrictEqual(out[1], s3, 'Split output 2 must be a new object');
    assert.deepStrictEqual(s3, s3Clone, 'Original input must not be mutated');

    assert.deepStrictEqual(out[0].words, ['Đây', 'là', 'một', 'câu']);
    assert.strictEqual(out[0].text, 'Đây là một câu');
    assert.strictEqual(out[0].startTime, 2.0);
    assert.strictEqual(out[0].endTime, 6.0);
    assert.strictEqual(out[0].index, 2);

    assert.deepStrictEqual(out[1].words, ['khá', 'dài', 'để', 'thử']);
    assert.strictEqual(out[1].text, 'khá dài để thử');
    assert.strictEqual(out[1].startTime, 6.0);
    assert.strictEqual(out[1].endTime, 10.0);
    assert.strictEqual(out[1].index, 2.5);

    console.log('✓ TEST 3 PASSED: Normal sentence > maxWords split correctly with interpolated timing');
  } catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 4: Vietnamese Phrase Starter Scoring
  // -------------------------------------------------------------
  try {
    const words = ['Họ', 'ngủ', 'ngon', 'và', 'khỏe', 'mạnh', 'hơn'];
    const splitPoint = findSemanticSplitPoint(words, 6);
    assert.strictEqual(splitPoint, 3, 'Phrase starter và at i=3 must win over midpoint i=4');
    console.log('✓ TEST 4 PASSED: Phrase starter scoring prioritized over plain midpoint');
  } catch (err) {
    console.error('❌ TEST 4 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 5: No phrase-boundary fallback (midpoint)
  // -------------------------------------------------------------
  try {
    const words = ['Một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy'];
    const splitPoint = findSemanticSplitPoint(words, 6);
    assert.strictEqual(splitPoint, 4, 'Without phrase starters, midpoint Math.ceil(7/2)=4 must be selected');
    console.log('✓ TEST 5 PASSED: Exact midpoint selected when no phrase starters exist');
  } catch (err) {
    console.error('❌ TEST 5 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 6: Candidate boundary range and maxWords constraint
  // -------------------------------------------------------------
  try {
    const words = ['Từ', 'đầu', 'và', 'rồi', 'chúng', 'ta', 'đi', 'đến', 'nơi', 'xa'];
    const splitPoint = findSemanticSplitPoint(words, 6);
    assert.strictEqual(splitPoint === 2, false, 'i=2 must be rejected because rightOk (10-2=8) > maxWords');
    assert.strictEqual(splitPoint, 5, 'Must pick valid candidate adhering to maxWords constraint on both sides');
    console.log('✓ TEST 6 PASSED: Candidate boundary range and constraints enforced');
  } catch (err) {
    console.error('❌ TEST 6 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 7: Multi-pass recursive split
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: dummyNormalizeSentence,
      foldText,
      maxWordsDefault: 6,
      warn: console.warn
    });

    const s7 = {
      index: 10,
      startTime: 0.0,
      endTime: 14.0,
      words: ['Một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười', 'mười một', 'mười hai', 'mười ba', 'mười bốn'],
      text: 'Một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba mười bốn',
      style: 'normal'
    };

    const out = splitter.splitLongSentences([s7]);
    assert.strictEqual(out.length, 4, '14 words sentence must split into 4 sentences in 2 passes');
    assert.strictEqual(out.every(s => s.words.length <= 6), true, 'All output sentences must be <= maxWords (6)');
    assert.strictEqual(out[0].startTime, 0.0);
    assert.strictEqual(out[out.length - 1].endTime, 14.0);
    console.log('✓ TEST 7 PASSED: Multi-pass split terminates and splits into <= maxWords');
  } catch (err) {
    console.error('❌ TEST 7 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 8: Peak without valid split conditions (pass-through)
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: dummyNormalizeSentence,
      foldText,
      maxWordsDefault: 6,
      warn: console.warn
    });

    const p1 = {
      index: 20,
      startTime: 0,
      endTime: 4,
      style: 'peak',
      words: ['ngủ', 'sâu', 'rất', 'tốt'],
      text: 'ngủ sâu rất tốt',
      peakLines: [{ text: 'ngủ sâu', type: 'anchor' }, { text: 'rất tốt', type: 'regular' }]
    };
    const out1 = splitter.splitLongSentences([p1]);
    assert.strictEqual(out1[0], p1, 'Peak with anchor at index 0 must pass through unchanged');

    const p2 = {
      index: 21,
      startTime: 0,
      endTime: 4,
      style: 'peak',
      words: ['và', 'ngủ', 'sâu', 'rất', 'tốt', 'hơn'],
      text: 'và ngủ sâu rất tốt hơn',
      peakLines: [{ text: 'và', type: 'connector' }, { text: 'ngủ sâu', type: 'anchor' }, { text: 'rất tốt hơn', type: 'script_climax' }]
    };
    const out2 = splitter.splitLongSentences([p2]);
    assert.strictEqual(out2[0], p2, 'Peak with leadWords < 2 must pass through unchanged');

    const p3 = {
      index: 22,
      startTime: 0,
      endTime: 4,
      style: 'peak',
      words: ['người', 'được', 'thông', 'báo', 'ngủ', 'sâu'],
      text: 'người được thông báo ngủ sâu',
      peakLines: [{ text: 'người được thông báo', type: 'regular' }, { text: 'ngủ sâu', type: 'anchor' }]
    };
    const out3 = splitter.splitLongSentences([p3]);
    assert.strictEqual(out3[0], p3, 'Peak with remWords < 3 must pass through unchanged');

    const p4 = {
      index: 23,
      startTime: 0,
      endTime: 4,
      style: 'peak',
      words: ['người', 'ta', 'ngủ', 'sâu', 'rất', 'tốt'],
      text: 'người ta ngủ sâu rất tốt',
      peakLines: [{ text: 'người ta', type: 'regular' }, { text: 'ngủ sâu', type: 'anchor' }, { text: 'rất tốt', type: 'script_climax' }]
    };
    const out4 = splitter.splitLongSentences([p4]);
    assert.strictEqual(out4[0], p4, 'Peak with total words <= 6 must pass through unchanged');

    console.log('✓ TEST 8 PASSED: Peak pass-through conditions preserve reference identity');
  } catch (err) {
    console.error('❌ TEST 8 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 9: Valid peak split
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const normalizedCalls = [];

    const customNormalize = (obj) => {
      normalizedCalls.push(obj);
      return {
        ...obj,
        normalized: true
      };
    };

    const splitter = createSubtitleSplitter({
      normalizeSentence: customNormalize,
      foldText,
      maxWordsDefault: 6,
      warn: (msg) => warnings.push(msg)
    });

    const pValid = {
      index: 30,
      startTime: 10.0,
      endTime: 20.0,
      style: 'peak',
      words: ['người', 'được', 'thông', 'báo', 'ngủ', 'sâu', 'đạt', 'điểm', 'cao'],
      text: 'người được thông báo ngủ sâu đạt điểm cao',
      peakLines: [
        { text: 'người được thông báo', type: 'regular' },
        { text: 'ngủ sâu', type: 'anchor' },
        { text: 'đạt điểm cao', type: 'script_climax' }
      ]
    };

    const out = splitter.splitLongSentences([pValid]);
    assert.strictEqual(out.length, 2, 'Valid peak split must produce 2 sentences (normal lead + peak remainder)');

    assert.strictEqual(out[0].style, 'normal');
    assert.strictEqual(out[0].peakLines, null);
    assert.deepStrictEqual(out[0].words, ['người', 'được', 'thông', 'báo']);
    assert.strictEqual(out[0].text, 'người được thông báo');
    assert.strictEqual(out[0].startTime, 10.0);
    assert.strictEqual(out[0].endTime, 10.0 + (4 / 9) * 10.0);

    assert.strictEqual(out[1].style, 'peak');
    assert.strictEqual(out[1].index, 30.5);
    assert.deepStrictEqual(out[1].words, ['ngủ', 'sâu', 'đạt', 'điểm', 'cao']);
    assert.strictEqual(out[1].text, 'ngủ sâu đạt điểm cao');
    assert.strictEqual(out[1].startTime, 10.0 + (4 / 9) * 10.0);
    assert.strictEqual(out[1].endTime, 20.0);
    assert.strictEqual(out[1].normalized, true, 'Peak remainder must be passed through normalizeSentence');
    assert.strictEqual(normalizedCalls.length, 1);

    console.log('✓ TEST 9 PASSED: Valid peak split separates lead-in and invokes normalizeSentence on remainder');
  } catch (err) {
    console.error('❌ TEST 9 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 10: Orphan connector at beginning of peak remainder
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const splitter = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText,
      maxWordsDefault: 6,
      warn: (msg) => warnings.push(msg)
    });

    const pOrphanLead = {
      index: 31,
      startTime: 0,
      endTime: 10,
      style: 'peak',
      words: ['người', 'được', 'một', 'lượng', 'lợi', 'ích', 'khổng', 'lồ'],
      text: 'người được một lượng lợi ích khổng lồ',
      peakLines: [
        { text: 'người được', type: 'regular' },
        { text: 'lợi ích', type: 'anchor' },
        { text: 'khổng lồ', type: 'script_climax' }
      ]
    };

    const out = splitter.splitLongSentences([pOrphanLead]);
    assert.strictEqual(out.length, 2);
    assert.deepStrictEqual(out[1].peak_lines, [
      { text: 'một lượng', type: 'connector' },
      { text: 'lợi ích', type: 'anchor' },
      { text: 'khổng lồ', type: 'script_climax' }
    ]);
    console.log('✓ TEST 10 PASSED: Leading orphan words wrapped in connector chunk');
  } catch (err) {
    console.error('❌ TEST 10 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 11: Orphan connector in middle of peak remainder
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText,
      maxWordsDefault: 6,
      warn: () => {}
    });

    const pMidGap = {
      index: 32,
      startTime: 0,
      endTime: 10,
      style: 'peak',
      words: ['chúng', 'ta', 'sức', 'mạnh', 'của', 'trí', 'não'],
      text: 'chúng ta sức mạnh của trí não',
      peakLines: [
        { text: 'chúng ta', type: 'regular' },
        { text: 'sức mạnh', type: 'anchor' },
        { text: 'trí não', type: 'script_climax' }
      ]
    };

    const out = splitter.splitLongSentences([pMidGap]);
    assert.deepStrictEqual(out[1].peak_lines, [
      { text: 'sức mạnh', type: 'anchor' },
      { text: 'của', type: 'connector' },
      { text: 'trí não', type: 'script_climax' }
    ]);
    console.log('✓ TEST 11 PASSED: Middle orphan gap correctly wrapped in connector chunk');
  } catch (err) {
    console.error('❌ TEST 11 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 12: Sequential alignment fallback when chunk does not match foldText
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText,
      maxWordsDefault: 6,
      warn: () => {}
    });

    const pNoMatch = {
      index: 33,
      startTime: 0,
      endTime: 10,
      style: 'peak',
      words: ['chúng', 'ta', 'từ', 'khác', 'hoàn', 'toàn', 'ở', 'đây'],
      text: 'chúng ta từ khác hoàn toàn ở đây',
      peakLines: [
        { text: 'chúng ta', type: 'regular' },
        { text: 'alpha beta', type: 'anchor' },
        { text: 'gamma delta', type: 'script_climax' }
      ]
    };

    const out = splitter.splitLongSentences([pNoMatch]);
    assert.deepStrictEqual(out[1].peak_lines, [
      { text: 'từ khác', type: 'anchor' },
      { text: 'hoàn toàn', type: 'script_climax' },
      { text: 'ở đây', type: 'connector' }
    ]);
    console.log('✓ TEST 12 PASSED: Sequential alignment fallback applied when chunks do not match folded words');
  } catch (err) {
    console.error('❌ TEST 12 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 13: Connector at end of peak remainder
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText,
      maxWordsDefault: 6,
      warn: () => {}
    });

    const pEndGap = {
      index: 34,
      startTime: 0,
      endTime: 10,
      style: 'peak',
      words: ['chúng', 'ta', 'sức', 'mạnh', 'tuyệt', 'vời', 'cho', 'bạn'],
      text: 'chúng ta sức mạnh tuyệt vời cho bạn',
      peakLines: [
        { text: 'chúng ta', type: 'regular' },
        { text: 'sức mạnh', type: 'anchor' },
        { text: 'tuyệt vời', type: 'script_climax' }
      ]
    };

    const out = splitter.splitLongSentences([pEndGap]);
    assert.deepStrictEqual(out[1].peak_lines, [
      { text: 'sức mạnh', type: 'anchor' },
      { text: 'tuyệt vời', type: 'script_climax' },
      { text: 'cho bạn', type: 'connector' }
    ]);
    console.log('✓ TEST 13 PASSED: Trailing gap wrapped in connector chunk');
  } catch (err) {
    console.error('❌ TEST 13 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 14: Exact warning array capture
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const splitter = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText,
      maxWordsDefault: 6,
      warn: (msg) => warnings.push(msg)
    });

    const pWarn = {
      index: 42,
      startTime: 0,
      endTime: 10,
      style: 'peak',
      words: ['người', 'được', 'ngủ', 'sâu', 'rất', 'ngon', 'giấc'],
      text: 'người được ngủ sâu rất ngon giấc',
      peakLines: [
        { text: 'người được', type: 'regular' },
        { text: 'ngủ sâu', type: 'anchor' },
        { text: 'rất ngon giấc', type: 'script_climax' }
      ]
    };

    splitter.splitLongSentences([pWarn]);
    assert.deepStrictEqual(warnings, [
      '[split-align] s42→ anchor("ngủ sâu") | script_climax("rất ngon giấc")'
    ]);
    console.log('✓ TEST 14 PASSED: Exact warning string verified with deepStrictEqual');
  } catch (err) {
    console.error('❌ TEST 14 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 15: foldText dependency spy verification
  // -------------------------------------------------------------
  try {
    let foldTextCalls = 0;
    const foldTextSpy = (val) => {
      foldTextCalls++;
      return foldText(val);
    };

    const splitter = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText: foldTextSpy,
      maxWordsDefault: 6,
      warn: () => {}
    });

    const pFold = {
      index: 50,
      startTime: 0,
      endTime: 10,
      style: 'peak',
      words: ['người', 'được', 'ngủ', 'sâu', 'đạt', 'điểm', 'cao'],
      text: 'người được ngủ sâu đạt điểm cao',
      peakLines: [
        { text: 'người được', type: 'regular' },
        { text: 'ngủ sâu', type: 'anchor' },
        { text: 'đạt điểm cao', type: 'script_climax' }
      ]
    };

    splitter.splitLongSentences([pFold]);
    assert.strictEqual(foldTextCalls > 0, true, 'foldText must be called during peak alignment matching');
    console.log('✓ TEST 15 PASSED: Injected foldText dependency invoked');
  } catch (err) {
    console.error('❌ TEST 15 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 16: normalizeSentence dependency spy verification
  // -------------------------------------------------------------
  try {
    let normalizeCalled = false;
    let receivedArg = null;

    const normalizeSpy = (s) => {
      normalizeCalled = true;
      receivedArg = s;
      return { ...s, normalizedBySpy: true };
    };

    const splitter = createSubtitleSplitter({
      normalizeSentence: normalizeSpy,
      foldText,
      maxWordsDefault: 6,
      warn: () => {}
    });

    const pNorm = {
      index: 60,
      startTime: 0,
      endTime: 10,
      style: 'peak',
      words: ['người', 'được', 'ngủ', 'sâu', 'đạt', 'điểm', 'cao'],
      text: 'người được ngủ sâu đạt điểm cao',
      peakLines: [
        { text: 'người được', type: 'regular' },
        { text: 'ngủ sâu', type: 'anchor' },
        { text: 'đạt điểm cao', type: 'script_climax' }
      ]
    };

    const out = splitter.splitLongSentences([pNorm]);
    assert.strictEqual(normalizeCalled, true, 'normalizeSentence must be called for peak remainder');
    assert.strictEqual(receivedArg.style, 'peak');
    assert.strictEqual(receivedArg.index, 60.5);
    assert.strictEqual(out[1].normalizedBySpy, true);
    console.log('✓ TEST 16 PASSED: Injected normalizeSentence called with exact remainder object');
  } catch (err) {
    console.error('❌ TEST 16 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 17: maxWordsDefault injection (non-6 default)
  // -------------------------------------------------------------
  try {
    const splitter4 = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText,
      maxWordsDefault: 4,
      warn: () => {}
    });

    const s5 = { index: 70, startTime: 0, endTime: 5, words: ['Một', 'hai', 'ba', 'bốn', 'năm'], text: 'Một hai ba bốn năm', style: 'normal' };
    const out = splitter4.splitLongSentences([s5]);
    assert.strictEqual(out.length, 2, '5-word sentence must split when maxWordsDefault is 4');
    console.log('✓ TEST 17 PASSED: Injected maxWordsDefault (4) respected without hardcoded default');
  } catch (err) {
    console.error('❌ TEST 17 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 18: Explicit maxWords override at call-time
  // -------------------------------------------------------------
  try {
    const splitter4 = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText,
      maxWordsDefault: 4,
      warn: () => {}
    });

    const s5 = { index: 71, startTime: 0, endTime: 5, words: ['Một', 'hai', 'ba', 'bốn', 'năm'], text: 'Một hai ba bốn năm', style: 'normal' };
    const out = splitter4.splitLongSentences([s5], 6);
    assert.strictEqual(out.length, 1, '5-word sentence must not split when explicit maxWords=6 is passed');
    console.log('✓ TEST 18 PASSED: Explicit call-time maxWords overrides factory default');
  } catch (err) {
    console.error('❌ TEST 18 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 19: No silent dependency fallbacks
  // -------------------------------------------------------------
  try {
    const brokenSplitter = createSubtitleSplitter({});
    let threw = false;
    try {
      const p = {
        index: 80,
        startTime: 0,
        endTime: 10,
        style: 'peak',
        words: ['người', 'được', 'ngủ', 'sâu', 'đạt', 'điểm', 'cao'],
        text: 'người được ngủ sâu đạt điểm cao',
        peakLines: [{ text: 'người được', type: 'regular' }, { text: 'ngủ sâu', type: 'anchor' }, { text: 'đạt điểm cao', type: 'script_climax' }]
      };
      brokenSplitter.splitLongSentences([p]);
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, true, 'Module must fail if required dependencies are not provided (no silent fallback)');
    console.log('✓ TEST 19 PASSED: No silent dependency fallbacks invented');
  } catch (err) {
    console.error('❌ TEST 19 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 20: Input array & object immutability
  // -------------------------------------------------------------
  try {
    const splitter = createSubtitleSplitter({
      normalizeSentence: (s) => s,
      foldText,
      maxWordsDefault: 6,
      warn: () => {}
    });

    const sOriginal = {
      index: 90,
      startTime: 1.0,
      endTime: 9.0,
      words: ['Một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám'],
      text: 'Một hai ba bốn năm sáu bảy tám',
      style: 'normal'
    };
    const inputArray = [sOriginal];
    const sClone = JSON.parse(JSON.stringify(sOriginal));

    splitter.splitLongSentences(inputArray);

    assert.strictEqual(inputArray.length, 1, 'Input array length must not change');
    assert.strictEqual(inputArray[0], sOriginal, 'Input array elements must not be replaced');
    assert.deepStrictEqual(sOriginal, sClone, 'Input sentence object must not be mutated');
    console.log('✓ TEST 20 PASSED: Input array and objects are completely immutable');
  } catch (err) {
    console.error('❌ TEST 20 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n' + (allPassed ? '====================================\n✅ ALL 20 CHARACTERIZATION TESTS PASSED\n====================================' : '❌ SOME TESTS FAILED'));
  if (!allPassed) process.exit(1);
}

runTests();
