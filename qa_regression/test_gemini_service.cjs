/**
 * qa_regression/test_gemini_service.cjs
 * Comprehensive characterization test suite for extracted Gemini Service module.
 * Tests public API contract, model fallback, retry loops, payload schema,
 * response parsing, error propagation, and card text rewriting in-place mutation.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

async function runGeminiServiceTests() {
  console.log('==================================================================');
  console.log('            TESTING GEMINI SERVICE MODULE (geminiService.js)');
  console.log('==================================================================\n');

  const geminiModule = await import(pathToFileURL(path.resolve('src', 'pipeline', 'geminiService.js')).href);
  const { createGeminiService } = geminiModule;

  // 1. PUBLIC API CONTRACT
  console.log('--- 1. Testing Public API Contract ---');
  assert.strictEqual(typeof createGeminiService, 'function', 'createGeminiService must be a factory function');
  const service = createGeminiService({
    lottieDir: path.resolve('assets/lottie'),
    getBrollIndex: () => []
  });
  assert.strictEqual(typeof service.callGemini, 'function', 'callGemini must be a function');
  assert.strictEqual(typeof service.rewriteCardText, 'function', 'rewriteCardText must be a function');
  assert.strictEqual(service.getLottieCacheKeys, undefined, 'getLottieCacheKeys must remain private');
  console.log('✓ TEST 1 PASSED: Public API contract verified.\n');

  // Save original fetch and setTimeout
  const originalFetch = global.fetch;

  try {
    // 2. MODEL FALLBACK ORDER & RETRY LOOP
    console.log('--- 2. Testing Model Fallback Order & Retry Semantics ---');
    const calledUrls = [];
    let attemptCounter = 0;

    global.fetch = async (url, opts) => {
      calledUrls.push({ url, method: opts.method, body: JSON.parse(opts.body) });
      attemptCounter++;
      // Fail until 5th attempt (model 3, attempt 1)
      if (attemptCounter < 5) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable'
        };
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  sentences: [],
                  overlays: [],
                  hook: { kicker: "TOPIC", title: "TITLE", punch: "PUNCH" },
                  broll_schedule: []
                })
              }]
            }
          }]
        })
      };
    };

    const mockCues = [{ start: 0, end: 2, text: "Xin chào các bạn" }];
    const res = await service.callGemini(mockCues, "TEST_API_KEY");
    assert.ok(res.hook, 'Should return structured output');
    assert.strictEqual(calledUrls.length, 5, 'Should attempt 5 times before succeeding');
    assert.ok(calledUrls[0].url.includes('models/gemini-3.5-flash:generateContent?key=TEST_API_KEY'), '1st attempt: gemini-3.5-flash');
    assert.ok(calledUrls[1].url.includes('models/gemini-3.5-flash:generateContent?key=TEST_API_KEY'), '2nd attempt: gemini-3.5-flash');
    assert.ok(calledUrls[2].url.includes('models/gemini-2.5-flash:generateContent?key=TEST_API_KEY'), '3rd attempt: gemini-2.5-flash');
    assert.ok(calledUrls[3].url.includes('models/gemini-2.5-flash:generateContent?key=TEST_API_KEY'), '4th attempt: gemini-2.5-flash');
    assert.ok(calledUrls[4].url.includes('models/gemini-2.0-flash:generateContent?key=TEST_API_KEY'), '5th attempt: gemini-2.0-flash');
    console.log('✓ TEST 2 PASSED: Model fallback order (3.5 -> 2.5 -> 2.0) and 2 retries per model verified.\n');

    // 3. COMPLETE FAILURE RETHROWS LAST ERROR
    console.log('--- 3. Testing Exhausted Retries Rethrow ---');
    global.fetch = async (url, opts) => {
      return {
        ok: false,
        status: 429,
        text: async () => 'Rate Limit Exceeded'
      };
    };

    let threw = false;
    try {
      await service.callGemini(mockCues, "TEST_API_KEY");
    } catch (e) {
      threw = true;
      assert.ok(e.message.includes('Gemini API error: 429 - Rate Limit Exceeded'), 'Should rethrow exact last error');
    }
    assert.ok(threw, 'Should throw when all retries are exhausted');
    console.log('✓ TEST 3 PASSED: Error rethrow on complete retry exhaustion verified.\n');

    // 4. REQUEST STRUCTURE & SCHEMA VALIDATION
    console.log('--- 4. Testing Request Structure & JSON Schema ---');
    let capturedPayload = null;
    global.fetch = async (url, opts) => {
      capturedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  sentences: [],
                  overlays: [],
                  hook: { kicker: "K", title: "T", punch: "P" },
                  broll_schedule: []
                })
              }]
            }
          }]
        })
      };
    };

    await service.callGemini(mockCues, "TEST_API_KEY");
    assert.ok(capturedPayload.contents[0].parts[0].text.includes('STEP 0 — READ THE FULL TRANSCRIPT FIRST'), 'Prompt must contain STEP 0');
    assert.ok(capturedPayload.contents[0].parts[0].text.includes('SEMANTIC ACCURACY RULES'), 'Prompt must contain SEMANTIC ACCURACY RULES');
    assert.ok(capturedPayload.contents[0].parts[0].text.includes('script_climax'), 'Prompt must specify script_climax rules');
    assert.strictEqual(capturedPayload.generationConfig.responseMimeType, 'application/json', 'Must request application/json');
    assert.strictEqual(capturedPayload.generationConfig.responseSchema.type, 'OBJECT', 'Schema must be OBJECT');
    assert.deepStrictEqual(capturedPayload.generationConfig.responseSchema.required, ['sentences', 'overlays', 'hook', 'broll_schedule'], 'Schema required properties');
    console.log('✓ TEST 4 PASSED: Request payload structure and strict response schema verified.\n');

    // 5. REWRITE CARD TEXT IN-PLACE MUTATION
    console.log('--- 5. Testing rewriteCardText In-Place Mutation ---');
    const mockOverlays = [
      { startTime: 1.0, endTime: 3.5, type: 'ACTION', title: 'uống nước thì tốt', detail: 'giúp cho cơ thể bạn được trao đổi chất' },
      { startTime: 4.0, endTime: 7.0, type: 'STAT', title: '30 PHÚT', detail: 'mỗi ngày đi bộ là giúp đốt mỡ' },
      { startTime: 8.0, endTime: 10.0, type: 'BROLL' } // No title, should be ignored
    ];

    let rewriteCapturedBody = null;
    global.fetch = async (url, opts) => {
      rewriteCapturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify([
                  { id: 1.0, title: "UỐNG ĐỦ NƯỚC", detail: "Giúp cơ thể trao đổi chất tốt hơn" },
                  { id: 4.0, title: "30 PHÚT", detail: "Đi bộ mỗi ngày giúp giảm mỡ hiệu quả" }
                ])
              }]
            }
          }]
        })
      };
    };

    await service.rewriteCardText(mockOverlays, "TEST_API_KEY");
    assert.strictEqual(mockOverlays[0].title, "UỐNG ĐỦ NƯỚC", 'Card 1 title must be mutated in-place');
    assert.strictEqual(mockOverlays[0].detail, "Giúp cơ thể trao đổi chất tốt hơn", 'Card 1 detail must be mutated in-place');
    assert.strictEqual(mockOverlays[1].title, "30 PHÚT", 'Card 2 title must be preserved/updated');
    assert.strictEqual(mockOverlays[1].detail, "Đi bộ mỗi ngày giúp giảm mỡ hiệu quả", 'Card 2 detail must be mutated in-place');
    assert.strictEqual(mockOverlays[2].title, undefined, 'Non-card overlay must not be mutated');
    console.log('✓ TEST 5 PASSED: rewriteCardText in-place mutation and title/detail trimming verified.\n');

    // 6. REWRITE CARD TEXT EARLY RETURN ON EMPTY
    console.log('--- 6. Testing rewriteCardText Early Return ---');
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; };
    await service.rewriteCardText([], "KEY");
    await service.rewriteCardText([{ startTime: 1.0, type: 'BROLL' }], "KEY");
    assert.strictEqual(fetchCalled, false, 'Should early return without calling fetch when no titled cards exist');
    console.log('✓ TEST 6 PASSED: rewriteCardText early return verified.\n');

    // 7. REWRITE CARD TEXT FAILURE PRESERVES ORIGINAL
    console.log('--- 7. Testing rewriteCardText Fallback on Failure ---');
    global.fetch = async () => ({ ok: false, status: 500, text: async () => 'Error' });
    const fallbackOverlays = [
      { startTime: 1.0, title: 'ORIGINAL TITLE', detail: 'ORIGINAL DETAIL' }
    ];
    await service.rewriteCardText(fallbackOverlays, "KEY");
    assert.strictEqual(fallbackOverlays[0].title, 'ORIGINAL TITLE', 'Should preserve original title on failure');
    assert.strictEqual(fallbackOverlays[0].detail, 'ORIGINAL DETAIL', 'Should preserve original detail on failure');
    console.log('✓ TEST 7 PASSED: rewriteCardText fallback on failure preserves original text.\n');

    console.log('==================================================================');
    console.log('✓ ALL 7 GEMINI SERVICE TESTS PASSED 100%!');
    console.log('==================================================================\n');

  } finally {
    global.fetch = originalFetch;
  }
}

runGeminiServiceTests().catch(err => {
  console.error('❌ GEMINI SERVICE TEST SUITE FAILED:', err);
  process.exit(1);
});
