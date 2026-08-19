const assert = require('assert');

async function runTests() {
  console.log('=== OVERLAY POST PROCESSOR CHARACTERIZATION SUITE ===\n');

  const {
    SPEECH_NOISE,
    BAD_PHRASE,
    BAD_ENDING,
    sanitizeText,
    isValidText,
    isDetailFragment,
    createOverlayPostProcessor
  } = await import('../src/pipeline/overlayPostProcessor.js');

  function toSeconds(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  let allPassed = true;

  // -------------------------------------------------------------
  // TEST 1: Exact Regex / sanitizeText Behavior
  // -------------------------------------------------------------
  try {
    assert.strictEqual(sanitizeText('uh Ăn sáng um  mỗi  uhm ngày erm hmm'), 'Ăn sáng mỗi ngày');
    assert.strictEqual(sanitizeText('  hùm xám   và   ùm bò  '), 'hùm xám và ùm bò');
    assert.strictEqual(sanitizeText('   nhiều    khoảng    trắng   '), 'nhiều khoảng trắng');
    assert.strictEqual(sanitizeText(null), '');
    assert.strictEqual(sanitizeText(undefined), '');
    console.log('✓ TEST 1 PASSED: sanitizeText strips noise and collapses whitespace correctly');
  } catch (err) {
    console.error('❌ TEST 1 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 2: Exact isValidText Behavior
  // -------------------------------------------------------------
  try {
    assert.strictEqual(isValidText(''), false, 'Empty text must be invalid');
    assert.strictEqual(isValidText(null), false, 'Null text must be invalid');
    assert.strictEqual(isValidText('abc'), false, '<4 chars must be invalid');
    assert.strictEqual(isValidText('CALORIES'), false, 'Single word must be invalid');
    assert.strictEqual(isValidText('bạn đang nghĩ'), false, 'BAD_PHRASE must be invalid');
    assert.strictEqual(isValidText('chắc chắn thì'), false, 'BAD_PHRASE must be invalid');
    assert.strictEqual(isValidText('điều đó là'), false, 'BAD_PHRASE ending with đó là must be invalid');
    assert.strictEqual(isValidText('làm ngay nha'), false, 'BAD_PHRASE ending with nha must be invalid');
    assert.strictEqual(isValidText('Ăn uống thì'), false, 'BAD_ENDING must be invalid');
    assert.strictEqual(isValidText('và của'), false, 'BAD_ENDING must be invalid');
    assert.strictEqual(isValidText('TIẾT KIỆM THỜI GIAN'), true, 'Valid title must be valid');
    console.log('✓ TEST 2 PASSED: isValidText matches exact baseline rules');
  } catch (err) {
    console.error('❌ TEST 2 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 3: Exact isDetailFragment Behavior
  // -------------------------------------------------------------
  try {
    assert.strictEqual(isDetailFragment('ngắn'), true, '<8 chars must be fragment');
    assert.strictEqual(isDetailFragment('và phần tiếp theo của câu trước'), true, 'Leading conjunction must be fragment');
    assert.strictEqual(isDetailFragment('hoặc là như thế này nhé bạn'), true, 'Leading conjunction must be fragment');
    assert.strictEqual(isDetailFragment('đó là lý do tại sao ta làm'), true, 'Leading "đó là " must be fragment');
    assert.strictEqual(isDetailFragment('kết quả nghiên cứu khoa học của'), true, 'Trailing preposition "của" must be fragment');
    assert.strictEqual(isDetailFragment('đây là một giải pháp rất hay hoặc'), true, 'Trailing conjunction "hoặc" must be fragment');
    assert.strictEqual(isDetailFragment('tổng lượng calo tiêu thụ mỗi ngày ở mức'), true, 'Trailing "mức" must be fragment');
    assert.strictEqual(isDetailFragment('Giúp theo dõi lượng calo hàng ngày một cách chính xác.'), false, 'Complete sentence must NOT be fragment');
    console.log('✓ TEST 3 PASSED: isDetailFragment matches exact baseline rules');
  } catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 4: Fragment Detail Clearing
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const { postProcessOverlays } = createOverlayPostProcessor({
      toSeconds,
      hookSafeStart: 4.8,
      logWarning: (msg) => warnings.push(msg)
    });

    const input = [
      { startTime: 5.0, endTime: 7.0, title: 'TIẾT KIỆM CALO', detail: 'và phần tiếp theo của câu trước' }
    ];

    const out = postProcessOverlays(input);
    assert.strictEqual(out.length, 1, 'Card should be retained');
    assert.strictEqual(out[0].title, 'TIẾT KIỆM CALO', 'Title should remain');
    assert.strictEqual(out[0].detail, '', 'Fragment detail must be cleared to empty string');
    assert.deepStrictEqual(warnings, [
      'Fragment detail cleared: "TIẾT KIỆM CALO" / "và phần tiếp theo của câu trước"'
    ], 'Must match exact baseline warnings array');
    console.log('✓ TEST 4 PASSED: Fragment detail cleared and warning logged');
  } catch (err) {
    console.error('❌ TEST 4 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 5: Invalid Card Removal
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const { postProcessOverlays } = createOverlayPostProcessor({
      toSeconds,
      hookSafeStart: 4.8,
      logWarning: (msg) => warnings.push(msg)
    });

    const input = [
      { startTime: 5.0, endTime: 7.0, title: 'bạn đang nghĩ', detail: 'Chi tiết hợp lệ' },
      { startTime: 5.5, endTime: 7.5, title: 'HỢP LỆ HOÀN TOÀN', detail: 'Chi tiết hợp lệ' }
    ];

    const out = postProcessOverlays(input);
    assert.strictEqual(out.length, 1, 'Invalid card must be dropped');
    assert.strictEqual(out[0].title, 'HỢP LỆ HOÀN TOÀN');
    assert.deepStrictEqual(warnings, [
      'Dropped bad card: "bạn đang nghĩ" / "Chi tiết hợp lệ"'
    ], 'Must match exact baseline warnings array');
    console.log('✓ TEST 5 PASSED: Invalid card dropped and warning logged');
  } catch (err) {
    console.error('❌ TEST 5 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 6: list_group Windows Calculation
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const { postProcessOverlays } = createOverlayPostProcessor({
      toSeconds,
      hookSafeStart: 4.8,
      logWarning: (msg) => warnings.push(msg)
    });

    const input = [
      { startTime: 5.0, endTime: 7.0, title: 'DANH SÁCH 1', detail: 'Chi tiết 1', list_group: 'grp1' },
      { startTime: 7.0, endTime: 9.0, title: 'DANH SÁCH 2', detail: 'Chi tiết 2', list_group: 'grp1' },
      { startTime: 6.0, endTime: 8.0, title: 'CARD XUNG ĐỘT', detail: 'Chi tiết xung đột' }
    ];

    const out = postProcessOverlays(input);
    assert.strictEqual(out.length, 2, 'Non-list card overlapping list window [5, 9] must be dropped');
    assert.strictEqual(out[0].title, 'DANH SÁCH 1');
    assert.strictEqual(out[1].title, 'DANH SÁCH 2');
    assert.deepStrictEqual(warnings, [
      'Dropped overlap with list: "CARD XUNG ĐỘT"'
    ], 'Must match exact baseline warnings array');
    console.log('✓ TEST 6 PASSED: list_group windows correctly computed and colliding cards dropped');
  } catch (err) {
    console.error('❌ TEST 6 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 7: Overlap Boundary Rules (< and > semantics)
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const { postProcessOverlays } = createOverlayPostProcessor({
      toSeconds,
      hookSafeStart: 4.8,
      logWarning: (msg) => warnings.push(msg)
    });

    const input = [
      { startTime: 5.0, endTime: 7.0, title: 'LIST ITEM', detail: 'Chi tiết', list_group: 'grp1' },
      { startTime: 3.0, endTime: 5.0, title: 'CARD CHẠM ĐẦU', detail: 'Chi tiết' },
      { startTime: 7.0, endTime: 9.0, title: 'CARD CHẠM ĐUÔI', detail: 'Chi tiết' }
    ];

    const out = postProcessOverlays(input);
    const titles = out.map(c => c.title);
    assert(titles.includes('CARD CHẠM ĐẦU'), 'Boundary touching card (end == list.start) must NOT be dropped');
    assert(titles.includes('CARD CHẠM ĐUÔI'), 'Boundary touching card (start == list.end) must NOT be dropped');
    assert.deepStrictEqual(warnings, [
      'Hook overlap fix: "CARD CHẠM ĐẦU" shifted +1.8s'
    ], 'Must match exact baseline warnings array');
    console.log('✓ TEST 7 PASSED: Boundary touching strictly respects < and > clash rules');
  } catch (err) {
    console.error('❌ TEST 7 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 8: Hook Safe-Start Shifting (hookSafeStart = 4.8)
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const { postProcessOverlays } = createOverlayPostProcessor({
      toSeconds,
      hookSafeStart: 4.8,
      logWarning: (msg) => warnings.push(msg)
    });

    const input = [
      { startTime: 1.0, endTime: 3.0, title: 'CARD SỚM', detail: 'Nội dung chi tiết' },
      { startTime: 4.8, endTime: 6.8, title: 'CARD ĐÚNG GIỜ', detail: 'Nội dung chi tiết' }
    ];

    const out = postProcessOverlays(input);
    assert.strictEqual(out[0].startTime, 4.8, 'Early card startTime must shift to 4.8');
    assert.strictEqual(out[0].endTime, 6.8, 'Early card endTime must shift by +3.8s to 6.8');
    assert.deepStrictEqual(warnings, [
      'Hook overlap fix: "CARD SỚM" shifted +3.8s'
    ], 'Must match exact baseline warnings array');

    assert.strictEqual(out[1].startTime, 4.8, 'Exact safeStart card must NOT shift');
    assert.strictEqual(out[1].endTime, 6.8);
    console.log('✓ TEST 8 PASSED: Hook safe start shifting matches exact baseline timing & logs');
  } catch (err) {
    console.error('❌ TEST 8 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 9: List Items are NOT Hook-Shifted
  // -------------------------------------------------------------
  try {
    const warnings = [];
    const { postProcessOverlays } = createOverlayPostProcessor({
      toSeconds,
      hookSafeStart: 4.8,
      logWarning: (msg) => warnings.push(msg)
    });

    const input = [
      { startTime: 1.0, endTime: 3.0, title: 'LIST ITEM SỚM', detail: 'Chi tiết', list_group: 'grp_early' }
    ];

    const out = postProcessOverlays(input);
    assert.strictEqual(out[0].startTime, 1.0, 'List item must NOT be hook-shifted');
    assert.strictEqual(out[0].endTime, 3.0);
    assert.deepStrictEqual(warnings, [], 'No warnings expected for valid list item');
    console.log('✓ TEST 9 PASSED: List items are exempt from hook safe-start shift');
  } catch (err) {
    console.error('❌ TEST 9 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 10: Input Immutability
  // -------------------------------------------------------------
  try {
    const { postProcessOverlays } = createOverlayPostProcessor({
      toSeconds,
      hookSafeStart: 4.8,
      logWarning: () => {}
    });

    const input = [
      { startTime: 1.0, endTime: 3.0, title: 'uh TIẾT KIỆM CALO um', detail: 'và câu tiếp theo' },
      { startTime: 5.0, endTime: 7.0, title: 'TIẾP THEO', detail: 'Chi tiết hợp lệ', list_group: 'g1' }
    ];

    const inputClone = JSON.parse(JSON.stringify(input));
    postProcessOverlays(input);

    assert.deepStrictEqual(input, inputClone, 'Original input objects and array must NOT be mutated');
    console.log('✓ TEST 10 PASSED: Input immutability verified');
  } catch (err) {
    console.error('❌ TEST 10 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 11: Data Idempotency
  // -------------------------------------------------------------
  try {
    const { postProcessOverlays } = createOverlayPostProcessor({
      toSeconds,
      hookSafeStart: 4.8,
      logWarning: () => {}
    });

    const input = [
      { startTime: 1.0, endTime: 3.0, title: 'uh TIẾT KIỆM CALO um', detail: 'và câu tiếp theo' },
      { startTime: 8.0, endTime: 10.0, title: 'TIẾP THEO', detail: 'Chi tiết hợp lệ', list_group: 'g1' }
    ];

    const pass1 = postProcessOverlays(input);
    const pass2 = postProcessOverlays(pass1);

    assert.deepStrictEqual(pass2, pass1, 'Second pass on sanitized data must produce identical output');
    console.log('✓ TEST 11 PASSED: Data idempotency verified');
  } catch (err) {
    console.error('❌ TEST 11 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // TEST 12: Dependency Semantics (No Silent Defaults)
  // -------------------------------------------------------------
  try {
    const missingProc = createOverlayPostProcessor({});
    assert.throws(
      () => missingProc.postProcessOverlays([{ startTime: 1, endTime: 2, title: 'TEST TITLE', detail: 'Chi tiết' }]),
      /TypeError/,
      'Must fail fast when required dependencies are not passed'
    );
    console.log('✓ TEST 12 PASSED: Missing dependencies fail fast without silent replacement');
  } catch (err) {
    console.error('❌ TEST 12 FAILED:', err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------
  // FINAL SUITE RESULT
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  if (allPassed) {
    console.log('✓ ALL OVERLAY POST PROCESSOR CHARACTERIZATION TESTS PASSED 100%');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED IN OVERLAY POST PROCESSOR SUITE');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
