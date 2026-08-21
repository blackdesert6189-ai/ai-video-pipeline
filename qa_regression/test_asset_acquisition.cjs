/**
 * qa_regression/test_asset_acquisition.cjs
 * Comprehensive characterization test suite for extracted Asset Acquisition module.
 * Strictly locks:
 * 1. Pexels query selection, dictionary frequency ordering, fallback, and Gemini count routing
 * 2. Pexels misleading log quirk (geminiQueriesEn.length ? 'Gemini' : 'dictionary')
 * 3. Pexels request contract (URL params, auth header, query slicing)
 * 4. Pexels video filtering, scoring (HD/SD/portrait), and maxNewClips cap
 * 5. Pexels case-insensitive filename deduplication
 * 6. Pexels download redirect (301/302), redirect overflow (> 5), HTTP errors, res.resume() drain, and HTTPS request errors
 * 7. Pexels category detection (food, fitness, medical, body, lifestyle) and first-match-wins
 * 8. Pexels tag/keyword semantics (string vs object tags, fallback to query words)
 * 9. Pexels broll_index.json formatting (null, 2) and no-op write avoidance
 * 10. Lottie basic skips (STAT uppercase/lowercase, empty/whitespace queries)
 * 11. Lottie safeKey sanitization and exact 50-character truncation
 * 12. Lottie exact cache hit and usedPaths deduplication
 * 13. Lottie cache-exists-but-already-used quirk (skips API, proceeds to fuzzy)
 * 14. Lottie IconScout search contract (URL, headers, first item uuid only)
 * 15. Lottie IconScout download POST contract (Client-Secret, body { format: 'json' }, URL extraction)
 * 16. Lottie raw JSON cache file bytes (no indentation)
 * 17. Lottie API error continuation (search 500, download 403, JSON 404)
 * 18. Lottie fuzzy token normalization (stem underscores, token length > 2)
 * 19. Lottie fuzzy scoring (exact +2, prefix +1 bidirectional, threshold >= 4)
 * 20. Lottie tie-breaking and Math.random shuffle behavior
 * 21. Lottie usedPaths exclusion across multiple overlays
 * 22. Lottie in-place overlay object mutation (identity preservation)
 * 23. Lottie combined logSuccess counter formatting (+1 api, 1 exact cache, 1 fuzzy match in ONE call)
 * 24. Network fail-closed guard preventing real internet requests
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

async function runAssetAcquisitionCharacterizationTests() {
  console.log('==================================================================');
  console.log('   ASSET ACQUISITION STRENGTHENED CHARACTERIZATION TEST SUITE');
  console.log('==================================================================\n');

  const assetModule = await import(pathToFileURL(path.resolve('src', 'pipeline', 'assetAcquisition.js')).href);
  const { createAssetAcquisition } = assetModule;

  // Helper for isolated sandbox testing
  function createSandbox() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-asset-test-'));
    const brollDir = path.join(tmpDir, 'assets', 'Broll');
    const lottieDir = path.join(tmpDir, 'assets', 'lottie');
    fs.mkdirSync(brollDir, { recursive: true });
    fs.mkdirSync(lottieDir, { recursive: true });
    return {
      tmpDir,
      brollDir,
      lottieDir,
      indexFile: path.join(tmpDir, 'broll_index.json'),
      cleanup: () => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    };
  }

  // -------------------------------------------------------------
  // 1. PUBLIC API SURFACE CONTRACT
  // -------------------------------------------------------------
  console.log('--- 1. Public API Surface Contract ---');
  assert.strictEqual(typeof createAssetAcquisition, 'function', 'Factory must be exported');
  const publicService = createAssetAcquisition();
  assert.strictEqual(typeof publicService.fetchPexelsBroll, 'function', 'fetchPexelsBroll must be public');
  assert.strictEqual(typeof publicService.fetchLottieForOverlays, 'function', 'fetchLottieForOverlays must be public');
  const exportedKeys = Object.keys(publicService).sort();
  assert.deepStrictEqual(exportedKeys, ['fetchLottieForOverlays', 'fetchPexelsBroll'], 'Only 2 public methods allowed');
  console.log('✓ Section 1 Passed: Public API contract locked.\n');

  // -------------------------------------------------------------
  // 2. PEXELS: QUERY SELECTION, FREQUENCY ORDERING, FALLBACK & LOG QUIRK
  // -------------------------------------------------------------
  console.log('--- 2. Pexels Query Selection, Frequency, Fallback & Log Quirk ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    const capturedRequests = [];
    const capturedLogs = [];
    const origLog = console.log;
    console.log = (...args) => capturedLogs.push(args.join(' '));

    const mockFetch = async (url, opts) => {
      capturedRequests.push({ url, headers: opts.headers });
      return {
        ok: true,
        status: 200,
        json: async () => ({ videos: [] })
      };
    };

    const pexelsConfig = {
      perPage: 5,
      maxDictPass: 10,
      maxGeminiPass: 8,
      maxDictQueries: 5,
      maxGeminiQueries: 6,
      minGeminiCount: 2
    };

    const service = createAssetAcquisition({
      pexelsBroll: pexelsConfig,
      pexelsApiKey: 'test-api-key-999',
      lottieDir: sb.lottieDir,
      fetchImpl: mockFetch
    });

    try {
      // Case A: Frequency ordering: "đi bộ" (2 times) vs "chạy bộ" (1 time)
      const srtFrequency = "đi bộ trong công viên. chạy bộ ngoài phố. đi bộ buổi chiều.";
      await service.fetchPexelsBroll(srtFrequency, 5);

      assert.strictEqual(capturedRequests.length, 2);
      assert.ok(capturedRequests[0].url.includes(encodeURIComponent('person walking park outdoor')), 'Higher frequency query first');
      assert.ok(capturedRequests[1].url.includes(encodeURIComponent('person running jogging street')), 'Lower frequency query second');

      // Case B: Fallback when < 2 hits
      capturedRequests.length = 0;
      const srtSingleHit = "chỉ có một từ gym ở đây.";
      await service.fetchPexelsBroll(srtSingleHit, 5);
      assert.strictEqual(capturedRequests.length, 3);
      assert.ok(capturedRequests[0].url.includes(encodeURIComponent('gym dumbbell lifting weights')));
      assert.ok(capturedRequests[1].url.includes(encodeURIComponent('person healthy active lifestyle')), 'Fallback 1');
      assert.ok(capturedRequests[2].url.includes(encodeURIComponent('healthy food nutrition meal')), 'Fallback 2');

      // Case C: Gemini queries >= minGeminiCount (2) -> uses Gemini queries
      capturedRequests.length = 0;
      await service.fetchPexelsBroll(srtFrequency, 5, ['gemini_q1', 'gemini_q2', 'gemini_q3']);
      assert.strictEqual(capturedRequests.length, 3);
      assert.ok(capturedRequests[0].url.includes('gemini_q1'));
      assert.ok(capturedRequests[1].url.includes('gemini_q2'));
      assert.ok(capturedRequests[2].url.includes('gemini_q3'));

      // Case D: Gemini queries < minGeminiCount (1 < 2) -> FALLS BACK TO DICTIONARY, but LOGS "(Gemini)" (Preserve Quirk!)
      capturedRequests.length = 0;
      capturedLogs.length = 0;
      await service.fetchPexelsBroll(srtFrequency, 5, ['single_gemini_query']);
      // Should execute dictionary queries (walking, running)
      assert.strictEqual(capturedRequests.length, 2);
      assert.ok(capturedRequests[0].url.includes(encodeURIComponent('person walking park outdoor')));
      // But log header contains "(Gemini)" due to `geminiQueriesEn.length ? 'Gemini' : 'dictionary'` quirk
      const logHeader = capturedLogs.find(l => l.includes('B-roll queries'));
      assert.ok(logHeader.includes('(Gemini)'), 'Preserves production log header quirk');

      // Case E: maxGeminiQueries slicing
      capturedRequests.length = 0;
      const eightQueries = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'];
      await service.fetchPexelsBroll(srtFrequency, 10, eightQueries);
      assert.strictEqual(capturedRequests.length, pexelsConfig.maxGeminiQueries, 'Capped at maxGeminiQueries (6)');

      // Case F: maxDictQueries slicing
      capturedRequests.length = 0;
      const srtManyKeywords = "đi bộ chạy bộ tập thể dục gym cơ bắp mỡ bụng giảm cân ăn uống thực phẩm rau củ";
      await service.fetchPexelsBroll(srtManyKeywords, 10);
      assert.strictEqual(capturedRequests.length, pexelsConfig.maxDictQueries, 'Capped at maxDictQueries (5)');
    } finally {
      console.log = origLog;
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 2 Passed: Pexels query selection, frequency, fallback & log quirk locked.\n');

  // -------------------------------------------------------------
  // 3. PEXELS: REQUEST PARAMS, AUTH HEADER & VIDEO SCORING
  // -------------------------------------------------------------
  console.log('--- 3. Pexels Request Params, Auth Header & Video Scoring ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    let downloadedUrl = null;
    const mockFetch = async (url, opts) => {
      assert.strictEqual(opts.headers.Authorization, 'secret-pexels-key-456', 'Authorization header matches pexelsApiKey');
      assert.ok(url.startsWith('https://api.pexels.com/videos/search?'), 'URL base correct');
      assert.ok(url.includes('orientation=portrait'), 'orientation param portrait');
      assert.ok(url.includes('size=medium'), 'size param medium');
      assert.ok(url.includes('per_page=5'), 'per_page param correct');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          videos: [
            {
              id: 701,
              tags: ['workout'],
              video_files: [
                { file_type: 'video/webm', link: 'https://mock/701.webm' }, // ignored (not mp4)
                { file_type: 'video/mp4', quality: 'sd', height: 1080, width: 1920, link: 'https://mock/701_sd_landscape.mp4' }, // score 10
                { file_type: 'video/mp4', quality: 'hd', height: 1080, width: 1920, link: 'https://mock/701_hd_landscape.mp4' }, // score 20
                { file_type: 'video/mp4', quality: 'hd', height: 1920, width: 1080, link: 'https://mock/701_hd_portrait.mp4' }   // score 25 (winner!)
              ]
            },
            {
              id: 702,
              tags: ['no_mp4'],
              video_files: [
                { file_type: 'video/quicktime', link: 'https://mock/702.mov' } // no mp4 -> skipped
              ]
            }
          ]
        })
      };
    };

    const mockHttpsGet = (u, cb) => {
      downloadedUrl = u;
      const res = {
        statusCode: 200,
        headers: {},
        pipe: (dest) => { dest.write('video-bytes'); dest.end(); },
        resume: () => {}
      };
      setImmediate(() => cb(res));
      return { on: () => ({}) };
    };

    const service = createAssetAcquisition({
      pexelsBroll: { perPage: 5, maxDictPass: 2, maxGeminiPass: 2, maxDictQueries: 2, maxGeminiQueries: 2, minGeminiCount: 2 },
      pexelsApiKey: 'secret-pexels-key-456',
      lottieDir: sb.lottieDir,
      fetchImpl: mockFetch,
      httpsGet: mockHttpsGet
    });

    try {
      const entries = await service.fetchPexelsBroll("gym", 1);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].filename, 'pexels_701.mp4');
      assert.strictEqual(downloadedUrl, 'https://mock/701_hd_portrait.mp4', 'HD Portrait file with highest score (25) selected');
    } finally {
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 3 Passed: Pexels request params, auth header & scoring locked.\n');

  // -------------------------------------------------------------
  // 4. PEXELS: CASE-INSENSITIVE DEDUP & INDEX WRITE BEHAVIOR
  // -------------------------------------------------------------
  console.log('--- 4. Pexels Case-Insensitive Dedup & Index Formatting ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    // Pre-populate broll_index.json with uppercase filename
    const preExisting = [{ filename: 'PEXELS_801.MP4', category: 'fitness' }];
    fs.writeFileSync(sb.indexFile, JSON.stringify(preExisting, null, 2), 'utf8');

    let downloadCalled = false;
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        videos: [
          {
            id: 801, // matches existing case-insensitively
            tags: ['gym'],
            video_files: [{ file_type: 'video/mp4', quality: 'hd', height: 1080, width: 1920, link: 'https://mock/801.mp4' }]
          },
          {
            id: 802, // new
            tags: ['fruit', { title: 'apple' }],
            video_files: [{ file_type: 'video/mp4', quality: 'hd', height: 1080, width: 1920, link: 'https://mock/802.mp4' }]
          }
        ]
      })
    });

    const mockHttpsGet = (u, cb) => {
      downloadCalled = true;
      const res = {
        statusCode: 200,
        headers: {},
        pipe: (dest) => { dest.write('bytes'); dest.end(); },
        resume: () => {}
      };
      setImmediate(() => cb(res));
      return { on: () => ({}) };
    };

    const service = createAssetAcquisition({
      pexelsBroll: { perPage: 5, maxDictPass: 5, maxGeminiPass: 5, maxDictQueries: 2, maxGeminiQueries: 2, minGeminiCount: 2 },
      pexelsApiKey: 'key',
      lottieDir: sb.lottieDir,
      fetchImpl: mockFetch,
      httpsGet: mockHttpsGet
    });

    try {
      const newEntries = await service.fetchPexelsBroll("ăn uống", 5);
      assert.strictEqual(newEntries.length, 1);
      assert.strictEqual(newEntries[0].filename, 'pexels_802.mp4');

      // Verify exact raw broll_index.json formatted with indentation (null, 2)
      const rawIndex = fs.readFileSync(sb.indexFile, 'utf8');
      const parsedIndex = JSON.parse(rawIndex);
      assert.strictEqual(parsedIndex.length, 2);
      assert.strictEqual(parsedIndex[0].filename, 'PEXELS_801.MP4');
      assert.strictEqual(parsedIndex[1].filename, 'pexels_802.mp4');
      assert.strictEqual(rawIndex, JSON.stringify([...preExisting, ...newEntries], null, 2), 'Exact 2-space indentation');

      // Run again when all cached -> index file is NOT rewritten
      const indexStatBefore = fs.statSync(sb.indexFile);
      const secondRunEntries = await service.fetchPexelsBroll("ăn uống", 5);
      assert.strictEqual(secondRunEntries.length, 0);
      const rawIndexAfter = fs.readFileSync(sb.indexFile, 'utf8');
      assert.strictEqual(rawIndex, rawIndexAfter, 'Index raw text unchanged when no new entries');
    } finally {
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 4 Passed: Pexels case-insensitive dedup & index formatting locked.\n');

  // -------------------------------------------------------------
  // 5. PEXELS: DOWNLOAD REDIRECTS (301/302), OVERFLOW, HTTP & HTTPS ERRORS + RES.RESUME()
  // -------------------------------------------------------------
  console.log('--- 5. Pexels Download Redirects, Overflow, HTTP & HTTPS Errors + res.resume() ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    let redirectChain = [];
    let redirectCount = 0;
    const resumeCalls = {
      r301: 0,
      r302: 0,
      r404: 0
    };
    const capturedLogs = [];
    const origLog = console.log;
    console.log = (...args) => capturedLogs.push(args.join(' '));

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        videos: [
          {
            id: 901, // 301 then 302 then 200 (redirects <= 5) -> succeeds
            tags: ['test'],
            video_files: [{ file_type: 'video/mp4', quality: 'hd', height: 1080, width: 1920, link: 'https://mock/redirect-start' }]
          },
          {
            id: 902, // infinite redirect (> 5) -> fails
            tags: ['test'],
            video_files: [{ file_type: 'video/mp4', quality: 'hd', height: 1080, width: 1920, link: 'https://mock/infinite-redirect' }]
          },
          {
            id: 903, // 404 -> fails
            tags: ['test'],
            video_files: [{ file_type: 'video/mp4', quality: 'hd', height: 1080, width: 1920, link: 'https://mock/404-error' }]
          },
          {
            id: 904, // HTTPS request-level error -> fails
            tags: ['test'],
            video_files: [{ file_type: 'video/mp4', quality: 'hd', height: 1080, width: 1920, link: 'https://mock/socket-reset-error' }]
          }
        ]
      })
    });

    const mockHttpsGet = (u, cb) => {
      redirectChain.push(u);

      if (u === 'https://mock/socket-reset-error') {
        const reqObj = {
          on: (evt, handler) => {
            if (evt === 'error') {
              setImmediate(() => handler(new Error('socket reset')));
            }
            return reqObj;
          }
        };
        return reqObj;
      }

      const res = {
        statusCode: 200,
        headers: {},
        pipe: (dest) => { dest.write('bytes'); dest.end(); },
        resume: () => {}
      };

      if (u === 'https://mock/redirect-start') {
        res.statusCode = 301;
        res.headers.location = 'https://mock/redirect-step2';
        res.resume = () => { resumeCalls.r301++; };
      } else if (u === 'https://mock/redirect-step2') {
        res.statusCode = 302;
        res.headers.location = 'https://mock/final-200';
        res.resume = () => { resumeCalls.r302++; };
      } else if (u.includes('infinite-redirect')) {
        redirectCount++;
        res.statusCode = 302;
        res.headers.location = `https://mock/infinite-redirect-${redirectCount}`;
      } else if (u === 'https://mock/404-error') {
        res.statusCode = 404;
        res.resume = () => { resumeCalls.r404++; };
      }

      setImmediate(() => cb(res));
      return { on: () => ({}) };
    };

    const service = createAssetAcquisition({
      pexelsBroll: { perPage: 5, maxDictPass: 5, maxGeminiPass: 5, maxDictQueries: 1, maxGeminiQueries: 1, minGeminiCount: 2 },
      pexelsApiKey: 'key',
      lottieDir: sb.lottieDir,
      fetchImpl: mockFetch,
      httpsGet: mockHttpsGet
    });

    try {
      const entries = await service.fetchPexelsBroll("uống nước", 5);
      // Only 901 succeeds
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].filename, 'pexels_901.mp4');

      // Verify redirect chain for 901
      assert.ok(redirectChain.includes('https://mock/redirect-start'));
      assert.ok(redirectChain.includes('https://mock/redirect-step2'));
      assert.ok(redirectChain.includes('https://mock/final-200'));

      // Verify res.resume() explicitly called on 301, 302, and 404
      assert.strictEqual(resumeCalls.r301, 1, 'res.resume() called on 301 redirect');
      assert.strictEqual(resumeCalls.r302, 1, 'res.resume() called on 302 redirect');
      assert.strictEqual(resumeCalls.r404, 1, 'res.resume() called on 404 non-200');

      // Verify error messages logged for 902, 903, and 904
      assert.ok(capturedLogs.some(l => l.includes('✗ Too many redirects')), 'Logs redirect overflow');
      assert.ok(capturedLogs.some(l => l.includes('✗ HTTP 404')), 'Logs HTTP 404 error');
      assert.ok(capturedLogs.some(l => l.includes('✗ socket reset')), 'Logs HTTPS request error');
    } finally {
      console.log = origLog;
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 5 Passed: Pexels download redirects, overflow, HTTP & HTTPS errors + res.resume() locked.\n');

  // -------------------------------------------------------------
  // 6. PEXELS: CATEGORY DETECTION & TAG/KEYWORD EXTRACTION
  // -------------------------------------------------------------
  console.log('--- 6. Pexels Category Detection & Tag Keywords ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        videos: [
          { id: 1, tags: ['vegetable', 'cook'], video_files: [{ file_type: 'video/mp4', link: 'https://mock/1.mp4' }] },
          { id: 2, tags: ['muscle', 'workout'], video_files: [{ file_type: 'video/mp4', link: 'https://mock/2.mp4' }] },
          { id: 3, tags: ['doctor', 'hospital'], video_files: [{ file_type: 'video/mp4', link: 'https://mock/3.mp4' }] },
          { id: 4, tags: ['belly', 'physique'], video_files: [{ file_type: 'video/mp4', link: 'https://mock/4.mp4' }] },
          { id: 5, tags: ['morning', 'sunrise'], video_files: [{ file_type: 'video/mp4', link: 'https://mock/5.mp4' }] }, // lifestyle fallback
          { id: 6, tags: ['fitness', 'meal'], video_files: [{ file_type: 'video/mp4', link: 'https://mock/6.mp4' }] },   // overlap -> food wins
          { id: 7, tags: [], video_files: [{ file_type: 'video/mp4', link: 'https://mock/7.mp4' }] }                      // no tags -> query words
        ]
      })
    });

    const mockHttpsGet = (u, cb) => {
      const res = { statusCode: 200, headers: {}, pipe: (d) => { d.write('v'); d.end(); }, resume: () => {} };
      setImmediate(() => cb(res));
      return { on: () => ({}) };
    };

    const service = createAssetAcquisition({
      pexelsBroll: { perPage: 10, maxDictPass: 10, maxGeminiPass: 10, maxDictQueries: 2, maxGeminiQueries: 2, minGeminiCount: 2 },
      pexelsApiKey: 'key',
      lottieDir: sb.lottieDir,
      fetchImpl: mockFetch,
      httpsGet: mockHttpsGet
    });

    // Use neutral Gemini query so query words don't contaminate tagStr with 'food'
    const neutralGeminiQueries = ['neutral clip alpha', 'neutral clip beta'];

    try {
      const entries = await service.fetchPexelsBroll("thực phẩm", 10, neutralGeminiQueries);
      assert.strictEqual(entries[0].category, 'food');
      assert.strictEqual(entries[1].category, 'fitness');
      assert.strictEqual(entries[2].category, 'medical');
      assert.strictEqual(entries[3].category, 'body');
      assert.strictEqual(entries[4].category, 'lifestyle');
      assert.strictEqual(entries[5].category, 'food', 'Food takes precedence over fitness in category regex order');

      // Check entry fields
      assert.deepStrictEqual(entries[0].keywords_en, ['vegetable', 'cook']);
      assert.deepStrictEqual(entries[0].keywords_vi, []);
      assert.strictEqual(entries[0].description, 'Pexels #1 — neutral clip alpha');

      // Check entry 7 fallback when tags empty
      assert.deepStrictEqual(entries[6].keywords_en, ['neutral', 'clip', 'alpha']);
      assert.deepStrictEqual(entries[6].keywords_vi, []);
    } finally {
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 6 Passed: Pexels category detection & tag keywords locked.\n');

  // -------------------------------------------------------------
  // 7. LOTTIE: BASIC SKIPS, EXACT 50-CHAR SAFEKEY TRUNCATION & EXACT CACHE USED-PATHS QUIRK
  // -------------------------------------------------------------
  console.log('--- 7. Lottie Basic Skips, Exact 50-char SafeKey & Exact Cache usedPaths Quirk ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    // Pre-create exact cache file
    const preCachedKey = 'timer_30_min_clock';
    const preCachedPath = path.join(sb.lottieDir, `${preCachedKey}.json`);
    fs.writeFileSync(preCachedPath, JSON.stringify({ nm: 'timer' }), 'utf8');

    // Also pre-create a file for fuzzy match fallback
    const fuzzyPath = path.join(sb.lottieDir, 'timer_countdown_clock.json');
    fs.writeFileSync(fuzzyPath, JSON.stringify({ nm: 'timer_fuzzy' }), 'utf8');

    // Long query for 50-char truncation check
    const longQuery = "VERY LONG LOTTIE ANIMATION QUERY WITH SPECIAL CHARS: !@#$%^&*() 1234567890 AND MORE TEXT";
    const expectedSafeKey = longQuery.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 50);
    assert.strictEqual(expectedSafeKey.length, 50, 'Computed expected safeKey is exactly 50 chars');
    assert.ok(longQuery.replace(/[^a-z0-9]+/gi, '_').length > 50, 'Pre-truncation safeKey length is > 50 chars');

    let apiCallCount = 0;
    const mockFetch = async (url) => {
      apiCallCount++;
      if (url.includes('/search')) {
        return { ok: true, status: 200, json: async () => ({ response: { items: { data: [{ uuid: 'uuid-long-key' }] } } }) };
      }
      if (url.includes('/api-download')) {
        return { ok: true, status: 200, json: async () => ({ response: { download: { url: 'https://mock.cdn/long_key.json' } } }) };
      }
      if (url.includes('long_key.json')) {
        return { ok: true, status: 200, json: async () => ({ v: '5.5.0', nm: 'long_key_anim' }) };
      }
      return { ok: true, status: 200, json: async () => ({ response: { items: { data: [] } } }) };
    };

    const service = createAssetAcquisition({
      lottieDir: sb.lottieDir,
      iconscoutApiKey: 'icon-sec',
      iconscoutClientId: 'icon-cid',
      fetchImpl: mockFetch
    });

    const overlays = [
      { index: 0, type: 'STAT', title: 'STAT1', lottie_query_en: 'timer 30 min clock' },    // STAT skipped
      { index: 1, type: 'action', title: 'ACT1', lottie_query_en: '' },                     // empty query skipped
      { index: 2, type: 'card', title: 'CARD1', lottie_query_en: 'timer 30 min clock' },    // exact cache hit
      { index: 3, type: 'card', title: 'CARD2', lottie_query_en: 'timer 30 min clock' },    // SAME exact cache key -> usedPaths already has it -> SKIPS API -> proceeds to fuzzy!
      { index: 4, type: 'card', title: 'CARD3', lottie_query_en: longQuery }                // exact 50-char safeKey truncation
    ];

    try {
      await service.fetchLottieForOverlays(overlays);

      assert.strictEqual(overlays[0].lottie_path, undefined, 'STAT skipped');
      assert.strictEqual(overlays[1].lottie_path, undefined, 'Empty query skipped');
      assert.strictEqual(overlays[2].lottie_path, preCachedPath, 'Exact cache hit on first encounter');
      assert.strictEqual(overlays[3].lottie_path, fuzzyPath, 'Second encounter with same exact cache key uses fuzzy fallback');

      // Verify exact safeKey filename and 50-character truncation
      assert.ok(overlays[4].lottie_path, 'Overlay 4 received downloaded path');
      assert.strictEqual(path.basename(overlays[4].lottie_path), `${expectedSafeKey}.json`, 'Filename strictly matches expected 50-char safeKey');
      assert.strictEqual(path.basename(overlays[4].lottie_path).replace('.json', '').length, 50, 'SafeKey stem length is exactly 50 chars');
      assert.ok(fs.existsSync(overlays[4].lottie_path), 'Cache file created on disk');
    } finally {
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 7 Passed: Lottie skips, exact 50-char safeKey & exact cache usedPaths quirk locked.\n');

  // -------------------------------------------------------------
  // 8. LOTTIE: ICONSCOUT API CONTRACT (SEARCH, DOWNLOAD POST & RAW BYTES)
  // -------------------------------------------------------------
  console.log('--- 8. Lottie IconScout Search, Download POST & Raw Bytes ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    const apiRequests = [];
    const mockLottieJson = { v: '5.5.7', fr: 30, ip: 0, op: 60, w: 500, h: 500, nm: 'water_glass', layers: [{ nm: 'wave' }] };

    const mockFetch = async (url, opts = {}) => {
      apiRequests.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body });
      if (url.includes('/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              items: {
                data: [
                  { uuid: 'first-uuid-111', price: 0 },
                  { uuid: 'second-uuid-222', price: 0 } // must be ignored
                ]
              }
            }
          })
        };
      }
      if (url.includes('/api-download')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: { download: { url: 'https://mock.cdn/download/water.json' } } })
        };
      }
      if (url.includes('water.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockLottieJson
        };
      }
      return { ok: false, status: 404 };
    };

    let loggedSummary = '';
    const service = createAssetAcquisition({
      lottieDir: sb.lottieDir,
      iconscoutApiKey: 'icon-sec-key-777',
      iconscoutClientId: 'icon-client-id-333',
      fetchImpl: mockFetch,
      logSuccess: (msg) => { loggedSummary = msg; }
    });

    const overlays = [
      { index: 0, type: 'ACTION', title: 'DRINK', lottie_query_en: 'water glass hydration' }
    ];

    try {
      await service.fetchLottieForOverlays(overlays);

      // Verify search request
      assert.strictEqual(apiRequests[0].headers['Authorization'], 'Bearer icon-sec-key-777');
      assert.strictEqual(apiRequests[0].headers['Client-ID'], 'icon-client-id-333');
      assert.ok(apiRequests[0].url.includes('per_page=5&price=free'));

      // Verify download POST request uses FIRST item uuid only
      assert.strictEqual(apiRequests[1].method, 'POST');
      assert.ok(apiRequests[1].url.includes('/items/first-uuid-111/api-download'));
      assert.strictEqual(apiRequests[1].headers['Client-Secret'], 'icon-sec-key-777');
      assert.strictEqual(apiRequests[1].headers['Client-ID'], 'icon-client-id-333');
      assert.strictEqual(apiRequests[1].body, JSON.stringify({ format: 'json' }));

      // Verify raw cache file bytes: JSON.stringify with NO indentation
      const writtenFile = overlays[0].lottie_path;
      assert.ok(fs.existsSync(writtenFile));
      const rawBytes = fs.readFileSync(writtenFile, 'utf8');
      assert.strictEqual(rawBytes, JSON.stringify(mockLottieJson), 'Raw unindented JSON bytes');

      // Verify summary log
      assert.strictEqual(loggedSummary, 'Lottie: +1 api, 0 exact cache, 0 fuzzy match');
    } finally {
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 8 Passed: Lottie IconScout API contract & raw bytes locked.\n');

  // -------------------------------------------------------------
  // 9. LOTTIE: API ERROR CONTINUATION (SEARCH 500, DL 403, JSON 404)
  // -------------------------------------------------------------
  console.log('--- 9. Lottie API Error Handling & Continuation ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    const capturedLogs = [];
    const origLog = console.log;
    console.log = (...args) => capturedLogs.push(args.join(' '));

    let callStep = 0;
    const mockErrorFetch = async (url) => {
      callStep++;
      if (url.includes('query=err1')) {
        return { ok: false, status: 500 }; // Search fails
      }
      if (url.includes('query=err2')) {
        return { ok: true, status: 200, json: async () => ({ response: { items: { data: [{ uuid: 'uuid-err2' }] } } }) };
      }
      if (url.includes('uuid-err2')) {
        return { ok: false, status: 403 }; // Download fails
      }
      if (url.includes('query=err3')) {
        return { ok: true, status: 200, json: async () => ({ response: { items: { data: [{ uuid: 'uuid-err3' }] } } }) };
      }
      if (url.includes('uuid-err3')) {
        return { ok: true, status: 200, json: async () => ({ response: { download: { url: 'https://mock/err3.json' } } }) };
      }
      if (url.includes('err3.json')) {
        return { ok: false, status: 404 }; // JSON fetch fails
      }
      return { ok: false, status: 404 };
    };

    const service = createAssetAcquisition({
      lottieDir: sb.lottieDir,
      iconscoutApiKey: 'key',
      iconscoutClientId: 'cid',
      fetchImpl: mockErrorFetch
    });

    const overlays = [
      { index: 0, type: 'ACTION', title: 'E1', lottie_query_en: 'err1' },
      { index: 1, type: 'ACTION', title: 'E2', lottie_query_en: 'err2' },
      { index: 2, type: 'ACTION', title: 'E3', lottie_query_en: 'err3' }
    ];

    try {
      await service.fetchLottieForOverlays(overlays);

      assert.ok(capturedLogs.some(l => l.includes('✗ IconScout search 500')), 'Logs search error');
      assert.ok(capturedLogs.some(l => l.includes('✗ IconScout download 403')), 'Logs download error');
      assert.ok(capturedLogs.some(l => l.includes('✗ Lottie JSON fetch 404')), 'Logs JSON fetch error');
    } finally {
      console.log = origLog;
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 9 Passed: Lottie API error continuation locked.\n');

  // -------------------------------------------------------------
  // 10. LOTTIE: FUZZY SCORING, PREFIX +1 BIDIRECTIONAL, THRESHOLD, TIE-BREAKING & RANDOMNESS
  // -------------------------------------------------------------
  console.log('--- 10. Lottie Fuzzy Scoring, Prefix +1, Threshold & Randomness ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    // Candidates for Tie-breaking & Threshold
    const fileA = path.join(sb.lottieDir, 'healthy_heart_pulse.json');
    const fileB = path.join(sb.lottieDir, 'healthy_heart_beat.json');
    const fileC = path.join(sb.lottieDir, 'unrelated_file.json');
    fs.writeFileSync(fileA, JSON.stringify({ nm: 'A' }));
    fs.writeFileSync(fileB, JSON.stringify({ nm: 'B' }));
    fs.writeFileSync(fileC, JSON.stringify({ nm: 'C' }));

    // Candidates specifically testing Prefix +1 bidirectional scoring:
    // Query: "walking fitness cardiovascular workout" -> queryWords = Set(['walking', 'fitness', 'cardiovascular', 'workout'])
    // File P ("walk_fit_cardio_work.json"):
    // - w='walk', qw='walking' -> qw.startsWith(w) (+1)
    // - w='fit', qw='fitness' -> qw.startsWith(w) (+1)
    // - w='cardio', qw='cardiovascular' -> qw.startsWith(w) (+1)
    // - w='work', qw='workout' -> qw.startsWith(w) (+1)
    // Exact matches: 0. Total prefix score: 4 (reaches threshold 4 >= 4).
    // File E ("workout_unrelated_concept.json"):
    // - w='workout' -> exact match (+2). Total score: 2 (< 4).
    const filePrefix = path.join(sb.lottieDir, 'walk_fit_cardio_work.json');
    const fileCompetitor = path.join(sb.lottieDir, 'workout_unrelated_concept.json');
    fs.writeFileSync(filePrefix, JSON.stringify({ nm: 'PrefixWinner' }));
    fs.writeFileSync(fileCompetitor, JSON.stringify({ nm: 'ExactLowerScore' }));

    // Mock API returning no items so it goes straight to fuzzy
    const mockEmptyFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: { items: { data: [] } } })
    });

    const service = createAssetAcquisition({
      lottieDir: sb.lottieDir,
      iconscoutApiKey: 'key',
      iconscoutClientId: 'cid',
      fetchImpl: mockEmptyFetch
    });

    const origRandom = Math.random;

    try {
      // Case 1: Threshold < 4 rejected
      // Query "healthy" matches "healthy" (exact: +2). Total = 2 < 4 -> null
      const overlayBelowThreshold = [{ index: 0, type: 'ACTION', title: 'T1', lottie_query_en: 'healthy' }];
      await service.fetchLottieForOverlays(overlayBelowThreshold);
      assert.strictEqual(overlayBelowThreshold[0].lottie_path, undefined, 'Score 2 < threshold 4 rejected');

      // Case 2: Bidirectional Prefix +1 scoring unlocks threshold >= 4
      // Query "walking fitness cardiovascular workout" has ZERO exact matches with filePrefix, but 4 prefix matches (+1 each) = score 4.
      const overlayPrefix = [{ index: 1, type: 'ACTION', title: 'PREFIX', lottie_query_en: 'walking fitness cardiovascular workout' }];
      await service.fetchLottieForOverlays(overlayPrefix);
      assert.strictEqual(path.basename(overlayPrefix[0].lottie_path), 'walk_fit_cardio_work.json', '4 prefix matches (+1 each) score 4 >= 4 and win over exact-match competitor');

      // Case 3: Threshold >= 4 accepted & Tie-Breaking with Math.random shuffle
      // Query "healthy heart" matches "healthy" (+2) + "heart" (+2) = 4 >= 4 -> accepted
      // Candidate A and Candidate B TIE with score 4.
      // Sequence 1: Math.random() returns 0.9 -> (Math.random() - 0.5) > 0 -> leaves alphabetical order [beat, pulse] -> beat is evaluated first -> beat wins
      Math.random = () => 0.9;
      const overlayTie1 = [{ index: 2, type: 'ACTION', title: 'T2', lottie_query_en: 'healthy heart' }];
      await service.fetchLottieForOverlays(overlayTie1);
      const winner1 = path.basename(overlayTie1[0].lottie_path);

      // Sequence 2: Math.random() returns 0.1 -> (Math.random() - 0.5) < 0 -> inverts order [pulse, beat] -> pulse is evaluated first -> pulse wins
      Math.random = () => 0.1;
      const overlayTie2 = [{ index: 3, type: 'ACTION', title: 'T3', lottie_query_en: 'healthy heart' }];
      await service.fetchLottieForOverlays(overlayTie2);
      const winner2 = path.basename(overlayTie2[0].lottie_path);

      assert.strictEqual(winner1, 'healthy_heart_beat.json', 'Winner with sequence 1');
      assert.strictEqual(winner2, 'healthy_heart_pulse.json', 'Winner with sequence 2');
      assert.notStrictEqual(winner1, winner2, 'Alternate Math.random shuffle sequence changes tie winner as expected');

      // Case 4: In-place object mutation & identity verification
      const rawOverlay = { index: 4, type: 'ACTION', title: 'IN_PLACE', lottie_query_en: 'healthy heart pulse' };
      const list = [rawOverlay];
      await service.fetchLottieForOverlays(list);
      assert.strictEqual(list[0], rawOverlay, 'Overlay object identity preserved');
      assert.ok(rawOverlay.lottie_path, 'lottie_path mutated in-place on original object');
    } finally {
      Math.random = origRandom;
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 10 Passed: Lottie fuzzy scoring, prefix +1, threshold & randomness locked.\n');

  // -------------------------------------------------------------
  // 11. LOTTIE: COMBINED COUNTERS COMPOSITION (API + EXACT CACHE + FUZZY IN ONE CALL)
  // -------------------------------------------------------------
  console.log('--- 11. Lottie Combined Counters Composition (+1 api, 1 exact cache, 1 fuzzy match) ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    // 1. Pre-create exact cache file for Overlay B
    const exactFile = path.join(sb.lottieDir, 'timer_clock.json');
    fs.writeFileSync(exactFile, JSON.stringify({ nm: 'timer_exact' }));

    // 2. Pre-create fuzzy candidate file for Overlay C
    const fuzzyFile = path.join(sb.lottieDir, 'running_exercise_cardio.json');
    fs.writeFileSync(fuzzyFile, JSON.stringify({ nm: 'running_fuzzy' }));

    const mockFetch = async (url) => {
      if (url.includes('/search')) {
        if (url.includes('water')) {
          return { ok: true, status: 200, json: async () => ({ response: { items: { data: [{ uuid: 'uuid-water-api' }] } } }) };
        }
        return { ok: true, status: 200, json: async () => ({ response: { items: { data: [] } } }) };
      }
      if (url.includes('/api-download')) {
        return { ok: true, status: 200, json: async () => ({ response: { download: { url: 'https://mock.cdn/water_download.json' } } }) };
      }
      if (url.includes('water_download.json')) {
        return { ok: true, status: 200, json: async () => ({ v: '5.5.0', nm: 'water_api' }) };
      }
      return { ok: false, status: 404 };
    };

    let capturedSummary = '';
    const service = createAssetAcquisition({
      lottieDir: sb.lottieDir,
      iconscoutApiKey: 'key',
      iconscoutClientId: 'cid',
      fetchImpl: mockFetch,
      logSuccess: (msg) => { capturedSummary = msg; }
    });

    const overlays = [
      { index: 0, type: 'ACTION', title: 'WATER', lottie_query_en: 'water glass drink' },  // 1. API fetch
      { index: 1, type: 'ACTION', title: 'TIMER', lottie_query_en: 'timer clock' },        // 2. Exact cache hit
      { index: 2, type: 'ACTION', title: 'RUN', lottie_query_en: 'running exercise' }       // 3. Fuzzy match
    ];

    try {
      await service.fetchLottieForOverlays(overlays);

      // Assert exact summary shape
      assert.strictEqual(capturedSummary, 'Lottie: +1 api, 1 exact cache, 1 fuzzy match', 'Exact combined counter summary');

      // Assert overlay assignments
      assert.ok(overlays[0].lottie_path.endsWith('water_glass_drink.json'), 'Overlay 0 received API path');
      assert.ok(fs.existsSync(overlays[0].lottie_path), 'Overlay 0 file written to disk');
      assert.strictEqual(overlays[1].lottie_path, exactFile, 'Overlay 1 received exact cache path');
      assert.strictEqual(overlays[2].lottie_path, fuzzyFile, 'Overlay 2 received fuzzy match path');
    } finally {
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 11 Passed: Lottie combined counters (+1 api, 1 exact cache, 1 fuzzy match) locked.\n');

  // -------------------------------------------------------------
  // 12. NETWORK FAIL-CLOSED GUARD
  // -------------------------------------------------------------
  console.log('--- 12. Network Fail-Closed Guard ---');
  {
    const sb = createSandbox();
    const origCwd = process.cwd();
    process.chdir(sb.tmpDir);

    const failClosedFetch = async (url) => {
      throw new Error(`FAIL_CLOSED: Unexpected network call to ${url}`);
    };

    const failClosedService = createAssetAcquisition({
      lottieDir: sb.lottieDir,
      fetchImpl: failClosedFetch
    });

    try {
      // An exact cache hit should NOT trigger fetchImpl at all
      const cachePath = path.join(sb.lottieDir, 'cached_icon.json');
      fs.writeFileSync(cachePath, JSON.stringify({ nm: 'icon' }));

      const overlays = [{ index: 0, type: 'CARD', lottie_query_en: 'cached icon' }];
      await failClosedService.fetchLottieForOverlays(overlays);
      assert.strictEqual(overlays[0].lottie_path, cachePath);
    } finally {
      process.chdir(origCwd);
      sb.cleanup();
    }
  }
  console.log('✓ Section 12 Passed: Network fail-closed guard verified.\n');

  console.log('==================================================================');
  console.log('✓ ALL 12 CHARACTERIZATION SECTIONS AND 50+ ASSERTIONS PASSED 100%!');
  console.log('==================================================================\n');
}

runAssetAcquisitionCharacterizationTests().catch(err => {
  console.error('❌ ASSET ACQUISITION CHARACTERIZATION FAILED:', err);
  process.exit(1);
});
