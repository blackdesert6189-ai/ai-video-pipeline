/**
 * qa_regression/test_frame_renderer.cjs
 * Comprehensive characterization test suite for extracted Puppeteer Frame Capture Service.
 * Strictly locks:
 * 1. Public API surface contract (createFrameRenderer factory returning ONLY captureFrames)
 * 2. Dependency validation & fail-fast parameter guards
 * 3. Exact Puppeteer launch options & args ordering (headless: "new", viewport, protocolTimeout: 300000)
 * 4. Exact navigation trace, normalized file URL & exact { waitUntil: 'networkidle0' } option
 * 5. Live LAYOUT reference semantics (post-presenter mutations preserved without cloning) via real evaluate callback
 * 6. Actual page.evaluate callback execution (document.fonts.load, document.fonts.ready via observable getter, timeline verify, renderAt / seek)
 * 7. GSAP timeline registration verification, fail-closed missing timeline error & zero browser close on timeline failure
 * 8. Frame stepping & playhead seek parity (injected fps consumption, renderAt preference vs seek fallback)
 * 9. Screenshot file naming, alpha-transparency options (omitBackground: true), and pre-capture tempDir lifecycle (existing & absent)
 * 10. Success-path browser close (ordered after final screenshot) vs baseline failure error propagation (launch reject, goto reject, timeline missing, screenshot mid-loop failure - all zero close)
 * 11. Progress logging format at 0, 100, and final frame
 * 12. Composition-root shared FPS wiring lock (same fps passed to captureFrames and buildFinalFfmpegCommand)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

async function runFrameRendererCharacterizationTests() {
  console.log('==================================================================');
  console.log('    FRAME RENDERER MODULE CHARACTERIZATION TEST SUITE (REVIEW FIX #1)');
  console.log('==================================================================\n');

  let sectionCount = 0;
  let assertionCount = 0;
  let caseCount = 0;

  async function countAssert(fn) {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    assertionCount++;
  }

  const modPath = path.resolve('src', 'pipeline', 'frameRenderer.js');
  const mod = await import(pathToFileURL(modPath).href);
  const { createFrameRenderer } = mod;

  const layoutModPath = path.resolve('src', 'pipeline', 'layout.js');
  const { createLayout } = await import(pathToFileURL(layoutModPath).href);

  // Helper to build mock Puppeteer harness that executes REAL page.evaluate callbacks
  function createMockPuppeteerHarness(options = {}) {
    const callLog = [];
    let closeCallCount = 0;
    let newPageCallCount = 0;
    const gotoCalls = [];
    const evaluateCallbacksExecuted = [];
    const screenshots = [];
    const fontLoadCalls = [];
    let readyAccessCount = 0;

    const mockBrowser = {
      close: async () => {
        closeCallCount++;
        callLog.push('browser.close');
        if (options.onClose) options.onClose();
      },
      newPage: async () => {
        newPageCallCount++;
        callLog.push('browser.newPage');
        if (options.newPageRejects) throw new Error('newPage simulated failure');

        const mockPage = {
          goto: async (url, opts) => {
            gotoCalls.push({ url, opts });
            callLog.push(`page.goto:${url}`);
            if (options.gotoRejects) throw new Error('goto simulated failure');
            return { ok: true, url, opts };
          },
          evaluate: async (fn, ...args) => {
            callLog.push('page.evaluate');
            evaluateCallbacksExecuted.push({ fn, args });

            if (options.evaluateRejects) throw new Error('evaluate simulated failure');

            // Set up simulated browser environment for executing the actual callback
            const mockWindow = options.window || {
              __timelines: {
                'elegant-maxwell': {
                  seek: (t) => {
                    if (options.onSeek) options.onSeek(t);
                  }
                }
              },
              renderAt: options.hasRenderAt !== false ? ((t) => {
                if (options.onRenderAt) options.onRenderAt(t);
              }) : undefined
            };

            const mockDocument = options.document || {
              fonts: {
                load: (fontSpec) => {
                  fontLoadCalls.push(fontSpec);
                  if (options.onFontLoad) options.onFontLoad(fontSpec);
                  return Promise.resolve();
                },
                get ready() {
                  readyAccessCount++;
                  if (options.onReadyAccess) options.onReadyAccess();
                  return Promise.resolve('ready');
                }
              }
            };

            // Temporarily mount globals for callback execution
            const prevWindow = global.window;
            const prevDocument = global.document;
            global.window = mockWindow;
            global.document = mockDocument;

            try {
              return fn(...args);
            } finally {
              if (prevWindow === undefined) delete global.window;
              else global.window = prevWindow;
              if (prevDocument === undefined) delete global.document;
              else global.document = prevDocument;
            }
          },
          screenshot: async (opts) => {
            callLog.push(`page.screenshot:${opts.path}`);
            screenshots.push(opts);
            if (options.screenshotRejectsOnFrame !== undefined && screenshots.length === options.screenshotRejectsOnFrame) {
              throw new Error(`screenshot simulated failure on frame ${screenshots.length}`);
            }
            return Buffer.from('mock_png');
          }
        };

        return mockPage;
      }
    };

    let launchCalled = false;
    let launchOptions = null;

    const mockPuppeteer = {
      launch: async (opts) => {
        launchCalled = true;
        launchOptions = opts;
        callLog.push('puppeteer.launch');
        if (options.launchRejects) {
          if (options.launchError) throw options.launchError;
          throw new Error('launch simulated failure');
        }
        return mockBrowser;
      }
    };

    return {
      mockPuppeteer,
      mockBrowser,
      callLog,
      getCloseCallCount: () => closeCallCount,
      getNewPageCallCount: () => newPageCallCount,
      getLaunchCalled: () => launchCalled,
      getLaunchOptions: () => launchOptions,
      getGotoCalls: () => gotoCalls,
      getScreenshots: () => screenshots,
      getFontLoadCalls: () => fontLoadCalls,
      getReadyAccessCount: () => readyAccessCount,
      getEvaluateCallbacks: () => evaluateCallbacksExecuted
    };
  }

  // Standard safe mock fs helper
  function createSafeMockFs(custom = {}) {
    return {
      existsSync: () => false,
      rmSync: () => {},
      mkdirSync: () => {},
      ...custom
    };
  }

  // -------------------------------------------------------------
  // 1. PUBLIC API SURFACE CONTRACT & INPUT VALIDATION
  // -------------------------------------------------------------
  console.log('--- 1. Public API Surface Contract & Input Validation ---');
  sectionCount++;
  await countAssert(() => assert.strictEqual(typeof createFrameRenderer, 'function', 'createFrameRenderer must be a function'));
  await countAssert(() => assert.deepStrictEqual(Object.keys(mod).sort(), ['createFrameRenderer'], 'Only createFrameRenderer should be exported'));

  // Factory dependency guards
  await countAssert(() => assert.throws(() => createFrameRenderer({}), /puppeteerImpl/, 'Must throw if puppeteerImpl is missing'));
  await countAssert(() => assert.throws(() => createFrameRenderer({ puppeteerImpl: {} }), /applyRuntimeVisualPatchesImpl/, 'Must throw if applyRuntimeVisualPatchesImpl is missing'));
  await countAssert(() => assert.throws(() => createFrameRenderer({ puppeteerImpl: {}, applyRuntimeVisualPatchesImpl: () => {} }), /fsImpl/, 'Must throw if fsImpl is missing'));
  await countAssert(() => assert.throws(() => createFrameRenderer({ puppeteerImpl: {}, applyRuntimeVisualPatchesImpl: () => {}, fsImpl: {} }), /pathImpl/, 'Must throw if pathImpl is missing'));

  const dummyService = createFrameRenderer({
    puppeteerImpl: { launch: async () => ({}) },
    applyRuntimeVisualPatchesImpl: () => {},
    fsImpl: createSafeMockFs(),
    pathImpl: path
  });

  await countAssert(() => assert.deepStrictEqual(Object.keys(dummyService).sort(), ['captureFrames'], 'Service public API must ONLY expose captureFrames'));
  await countAssert(() => assert.strictEqual(typeof dummyService.captureFrames, 'function', 'captureFrames must be a function'));

  // captureFrames call-time parameter guards
  await countAssert(() => assert.rejects(() => dummyService.captureFrames({}), /compositionHtmlPath/));
  await countAssert(() => assert.rejects(() => dummyService.captureFrames({ compositionHtmlPath: 'x.html' }), /totalDuration/));
  await countAssert(() => assert.rejects(() => dummyService.captureFrames({ compositionHtmlPath: 'x.html', totalDuration: 5 }), /tempDir/));
  await countAssert(() => assert.rejects(() => dummyService.captureFrames({ compositionHtmlPath: 'x.html', totalDuration: 5, tempDir: 't' }), /layout/));
  await countAssert(() => assert.rejects(() => dummyService.captureFrames({ compositionHtmlPath: 'x.html', totalDuration: 5, tempDir: 't', layout: {} }), /fps/));

  console.log('✓ Section 1 Passed: Public API contract & validation locked.\n');

  // -------------------------------------------------------------
  // 2. PUPPETEER LAUNCH OPTIONS & NAVIGATION TRACE
  // -------------------------------------------------------------
  console.log('--- 2. Puppeteer Launch Options & Navigation Trace ---');
  sectionCount++;
  {
    caseCount++;
    const harness = createMockPuppeteerHarness();
    const layout = createLayout();
    let patchesCalledWith = null;

    const fsCalls = [];
    const mockFs = createSafeMockFs({
      existsSync: (p) => { fsCalls.push(`exists:${p}`); return true; },
      rmSync: (p, opts) => { fsCalls.push(`rm:${p}:${JSON.stringify(opts)}`); },
      mkdirSync: (p, opts) => { fsCalls.push(`mkdir:${p}:${JSON.stringify(opts)}`); }
    });

    const service = createFrameRenderer({
      puppeteerImpl: harness.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async (page, lay) => {
        harness.callLog.push('applyRuntimeVisualPatches');
        patchesCalledWith = { page, lay };
      },
      fsImpl: mockFs,
      pathImpl: path,
      logStep: (msg) => harness.callLog.push(`logStep:${msg}`),
      logSuccess: (msg) => harness.callLog.push(`logSuccess:${msg}`),
      consoleLogImpl: () => {}
    });

    const testTempDir = path.resolve('test_temp_frames');
    const testHtmlPath = path.resolve('test_composition.html');

    await service.captureFrames({
      compositionHtmlPath: testHtmlPath,
      totalDuration: 0.1,
      tempDir: testTempDir,
      layout,
      fps: 10
    });

    // Verify exact launch options
    const expectedLaunchOptions = {
      headless: 'new',
      defaultViewport: {
        width: 1080,
        height: 1920,
        deviceScaleFactor: 1
      },
      protocolTimeout: 300000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--hide-scrollbars'
      ]
    };
    await countAssert(() => assert.deepStrictEqual(harness.getLaunchOptions(), expectedLaunchOptions, 'Launch options must match exact baseline'));

    // Verify exact goto call url and options object
    const expectedFileUrl = `file:///${testHtmlPath.replace(/\\/g, '/')}`;
    const gotoCalls = harness.getGotoCalls();
    await countAssert(() => assert.strictEqual(gotoCalls.length, 1, 'page.goto must be called exactly once'));
    await countAssert(() => assert.strictEqual(gotoCalls[0].url, expectedFileUrl, 'page.goto must receive normalized file URL'));
    await countAssert(() => assert.deepStrictEqual(gotoCalls[0].opts, { waitUntil: 'networkidle0' }, 'page.goto must receive exact { waitUntil: "networkidle0" } option'));

    // Verify exact execution sequence
    const expectedCallSequence = [
      'logStep:Launching Headless Chrome with Puppeteer...',
      'puppeteer.launch',
      'browser.newPage',
      `logStep:Loading composition in Puppeteer: ${expectedFileUrl}`,
      `page.goto:${expectedFileUrl}`,
      'logSuccess:Composition loaded!',
      'applyRuntimeVisualPatches',
      'logSuccess:Applied fixed neon rail and clean metric text patches.',
      'logStep:Waiting for document fonts to load completely...',
      'page.evaluate', // font load
      'page.evaluate', // fonts.ready
      'logSuccess:Fonts successfully loaded!',
      'page.evaluate', // timeline verify
      'logSuccess:GSAP timeline detected!',
      'logStep:Starting transparent PNG frame capture loop at 10fps (1 total frames)...',
      'page.evaluate', // renderAt frame 0
      `page.screenshot:${path.join(testTempDir, 'frame_00000.png')}`,
      'browser.close',
      'logSuccess:Custom Puppeteer capture loop completed! Staged all transparent PNGs.'
    ];

    await countAssert(() => assert.deepStrictEqual(harness.callLog, expectedCallSequence, 'Lifecycle sequence must match exact baseline ordering'));
  }
  console.log('✓ Section 2 Passed: Launch options, navigation trace & networkidle0 locked.\n');

  // -------------------------------------------------------------
  // 3. LIVE LAYOUT REFERENCE SEMANTICS (REAL CALLBACK EXECUTION)
  // -------------------------------------------------------------
  console.log('--- 3. Live Layout Reference Semantics ---');
  sectionCount++;
  {
    caseCount++;
    const harness = createMockPuppeteerHarness();
    const dynamicLayout = createLayout();
    let passedLayoutRef = null;

    const service = createFrameRenderer({
      puppeteerImpl: harness.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async (page, lay) => {
        passedLayoutRef = lay;
      },
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    // Mutate LAYOUT AFTER factory creation
    dynamicLayout.subtitle.peakScriptClimaxFont = 'MutatedHeroCursiveFont';
    dynamicLayout.subtitle.peakScriptClimaxSize = 99;

    await service.captureFrames({
      compositionHtmlPath: 'test.html',
      totalDuration: 0.1,
      tempDir: 'temp_frames',
      layout: dynamicLayout,
      fps: 10
    });

    // Verify that the actual production font callback executed with mutated values
    const fontCalls = harness.getFontLoadCalls();
    await countAssert(() => assert.strictEqual(fontCalls.length, 1, 'document.fonts.load must be called once'));
    await countAssert(() => assert.strictEqual(fontCalls[0], 'normal 99px "MutatedHeroCursiveFont"', 'Real evaluate callback must execute with mutated font name and size'));
    await countAssert(() => assert.strictEqual(passedLayoutRef, dynamicLayout, 'applyRuntimeVisualPatches must receive exact same live layout instance'));
  }
  console.log('✓ Section 3 Passed: Live LAYOUT reference semantics locked with real callback execution.\n');

  // -------------------------------------------------------------
  // 4. ACTUAL page.evaluate CALLBACK EXECUTION & TIMELINE GUARDS
  // -------------------------------------------------------------
  console.log('--- 4. Actual page.evaluate Callback Execution & Timeline Guards ---');
  sectionCount++;
  {
    // A. Actual document.fonts.load & document.fonts.ready getter access
    caseCount++;
    const loadTrace = [];
    const harnessFont = createMockPuppeteerHarness({
      onFontLoad: (spec) => loadTrace.push({ type: 'load', spec }),
      onReadyAccess: () => loadTrace.push({ type: 'ready' })
    });
    const service = createFrameRenderer({
      puppeteerImpl: harnessFont.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    const layout = createLayout();
    await service.captureFrames({
      compositionHtmlPath: 'test.html',
      totalDuration: 0.1,
      tempDir: 'temp_frames',
      layout,
      fps: 10
    });

    const fontCalls = harnessFont.getFontLoadCalls();
    await countAssert(() => assert.strictEqual(fontCalls[0], `normal ${layout.subtitle.peakScriptClimaxSize}px "${layout.subtitle.peakScriptClimaxFont}"`, 'Actual document.fonts.load callback executed'));
    await countAssert(() => assert.strictEqual(harnessFont.getReadyAccessCount(), 1, 'document.fonts.ready getter must be accessed exactly once by actual callback'));

    // Verify ordering: document.fonts.load executed before document.fonts.ready
    await countAssert(() => assert.strictEqual(loadTrace.length, 2, 'Must record both font load and ready getter accesses'));
    await countAssert(() => assert.strictEqual(loadTrace[0].type, 'load', 'document.fonts.load must execute first'));
    await countAssert(() => assert.strictEqual(loadTrace[1].type, 'ready', 'document.fonts.ready must execute second'));

    // B. Missing timeline fail-closed error guard & zero browser close
    caseCount++;
    const harnessNoTimeline = createMockPuppeteerHarness({
      window: { __timelines: {} } // missing 'elegant-maxwell'
    });
    const serviceNoTimeline = createFrameRenderer({
      puppeteerImpl: harnessNoTimeline.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    await countAssert(async () => {
      await assert.rejects(
        () => serviceNoTimeline.captureFrames({ compositionHtmlPath: 'test.html', totalDuration: 0.1, tempDir: 'temp_frames', layout, fps: 10 }),
        /Could not find registered GSAP timeline 'elegant-maxwell' on window\.__timelines!/,
        'Must fail-closed with exact missing timeline error string'
      );
    });
    await countAssert(() => assert.strictEqual(harnessNoTimeline.getCloseCallCount(), 0, 'browser.close must NOT be called on missing timeline failure'));
  }
  console.log('✓ Section 4 Passed: Actual page.evaluate callback execution & timeline guards locked.\n');

  // -------------------------------------------------------------
  // 5. FRAME STEPPING, TIMESTAMPS & renderAt PREFERENCE
  // -------------------------------------------------------------
  console.log('--- 5. Frame Stepping, Timestamps & renderAt Preference ---');
  sectionCount++;
  {
    // A. With window.renderAt available
    caseCount++;
    const renderAtCalls = [];
    const seekCalls = [];

    const harnessRenderAt = createMockPuppeteerHarness({
      hasRenderAt: true,
      onRenderAt: (t) => renderAtCalls.push(t),
      onSeek: (t) => seekCalls.push(t)
    });

    const serviceA = createFrameRenderer({
      puppeteerImpl: harnessRenderAt.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    const layout = createLayout();
    // Test with totalDuration = 0.2, fps = 10 -> exactly 2 frames: t=0 and t=0.1
    await serviceA.captureFrames({
      compositionHtmlPath: 'test.html',
      totalDuration: 0.2,
      tempDir: 'temp_frames',
      layout,
      fps: 10
    });

    await countAssert(() => assert.deepStrictEqual(renderAtCalls, [0, 0.1], 'renderAt must be called with exact timestamps calculated from injected fps'));
    await countAssert(() => assert.strictEqual(seekCalls.length, 0, 'seek must NOT be called when renderAt is available'));

    // B. Fallback when window.renderAt is absent -> seek called
    caseCount++;
    const seekCallsOnly = [];
    const harnessSeek = createMockPuppeteerHarness({
      hasRenderAt: false,
      onSeek: (t) => seekCallsOnly.push(t)
    });

    const serviceB = createFrameRenderer({
      puppeteerImpl: harnessSeek.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    await serviceB.captureFrames({
      compositionHtmlPath: 'test.html',
      totalDuration: 0.2,
      tempDir: 'temp_frames',
      layout,
      fps: 10
    });

    await countAssert(() => assert.deepStrictEqual(seekCallsOnly, [0, 0.1], 'Timeline seek must be called when renderAt is absent'));
  }
  console.log('✓ Section 5 Passed: Frame stepping and renderAt preference verified.\n');

  // -------------------------------------------------------------
  // 6. SCREENSHOT NAMING, FORMAT & PRE-CAPTURE TEMPDIR (EXISTING & ABSENT)
  // -------------------------------------------------------------
  console.log('--- 6. Screenshot Naming, Format & Pre-Capture TempDir ---');
  sectionCount++;
  {
    const layout = createLayout();

    // A. Existing TempDir Case: rmSync + mkdirSync
    caseCount++;
    const harnessExisting = createMockPuppeteerHarness();
    const rmCalls = [];
    const mkdirCalls = [];

    const mockFsExisting = createSafeMockFs({
      existsSync: (p) => p.includes('existing'),
      rmSync: (p, opts) => rmCalls.push({ path: p, opts }),
      mkdirSync: (p, opts) => mkdirCalls.push({ path: p, opts })
    });

    const serviceExisting = createFrameRenderer({
      puppeteerImpl: harnessExisting.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: mockFsExisting,
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    const testExistingDir = path.resolve('existing_temp_frames');

    await serviceExisting.captureFrames({
      compositionHtmlPath: 'test.html',
      totalDuration: 0.3,
      tempDir: testExistingDir,
      layout,
      fps: 10
    });

    await countAssert(() => assert.strictEqual(rmCalls.length, 1, 'rmSync must be called for existing tempDir'));
    await countAssert(() => assert.deepStrictEqual(rmCalls[0], { path: testExistingDir, opts: { recursive: true, force: true } }, 'rmSync options must be recursive & force'));
    await countAssert(() => assert.strictEqual(mkdirCalls.length, 1, 'mkdirSync must be called once'));
    await countAssert(() => assert.deepStrictEqual(mkdirCalls[0], { path: testExistingDir, opts: { recursive: true } }, 'mkdirSync options must be recursive'));

    // Verify screenshot file paths and options
    const screenshots = harnessExisting.getScreenshots();
    await countAssert(() => assert.strictEqual(screenshots.length, 3, 'Must capture 3 frames for duration 0.3 at 10fps'));
    await countAssert(() => assert.strictEqual(screenshots[0].path, path.join(testExistingDir, 'frame_00000.png'), 'Frame 0 name must be zero-padded 5 digits'));
    await countAssert(() => assert.strictEqual(screenshots[1].path, path.join(testExistingDir, 'frame_00001.png'), 'Frame 1 name must be zero-padded 5 digits'));
    await countAssert(() => assert.strictEqual(screenshots[2].path, path.join(testExistingDir, 'frame_00002.png'), 'Frame 2 name must be zero-padded 5 digits'));
    await countAssert(() => assert.strictEqual(screenshots[0].omitBackground, true, 'omitBackground must be true for alpha transparency'));
    await countAssert(() => assert.strictEqual(screenshots[0].type, 'png', 'Screenshot type must be png'));

    // B. Absent TempDir Case: NO rmSync, only mkdirSync
    caseCount++;
    const harnessAbsent = createMockPuppeteerHarness();
    const rmCallsAbsent = [];
    const mkdirCallsAbsent = [];

    const mockFsAbsent = createSafeMockFs({
      existsSync: () => false,
      rmSync: (p, opts) => rmCallsAbsent.push({ path: p, opts }),
      mkdirSync: (p, opts) => mkdirCallsAbsent.push({ path: p, opts })
    });

    const serviceAbsent = createFrameRenderer({
      puppeteerImpl: harnessAbsent.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: mockFsAbsent,
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    const testAbsentDir = path.resolve('absent_temp_frames');

    await serviceAbsent.captureFrames({
      compositionHtmlPath: 'test.html',
      totalDuration: 0.1,
      tempDir: testAbsentDir,
      layout,
      fps: 10
    });

    await countAssert(() => assert.strictEqual(rmCallsAbsent.length, 0, 'rmSync must NOT be called when tempDir is absent'));
    await countAssert(() => assert.strictEqual(mkdirCallsAbsent.length, 1, 'mkdirSync must be called once when tempDir is absent'));
    await countAssert(() => assert.deepStrictEqual(mkdirCallsAbsent[0], { path: testAbsentDir, opts: { recursive: true } }, 'mkdirSync options must be recursive'));
  }
  console.log('✓ Section 6 Passed: Screenshot naming, alpha options & tempDir lifecycle (existing & absent) locked.\n');

  // -------------------------------------------------------------
  // 7. SUCCESS BROWSER CLOSE ORDER VS BASELINE FAILURE ERROR PROPAGATION
  // -------------------------------------------------------------
  console.log('--- 7. Success Browser Close Order vs Baseline Failure Error Semantics ---');
  sectionCount++;
  {
    const layout = createLayout();

    // A. Normal success: browser.close called exactly once, strictly AFTER final screenshot
    caseCount++;
    const harnessSuccess = createMockPuppeteerHarness();
    const testTempDir = path.resolve('temp_frames_success');

    const serviceSuccess = createFrameRenderer({
      puppeteerImpl: harnessSuccess.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    // 3 frames fixture
    await serviceSuccess.captureFrames({
      compositionHtmlPath: 'test.html',
      totalDuration: 0.3,
      tempDir: testTempDir,
      layout,
      fps: 10
    });

    await countAssert(() => assert.strictEqual(harnessSuccess.getCloseCallCount(), 1, 'browser.close must be called exactly once on success'));

    // Prove ordering: final screenshot call happened strictly before browser.close
    const finalScreenshotCall = `page.screenshot:${path.join(testTempDir, 'frame_00002.png')}`;
    const finalScreenshotIdx = harnessSuccess.callLog.indexOf(finalScreenshotCall);
    const browserCloseIdx = harnessSuccess.callLog.indexOf('browser.close');
    await countAssert(() => assert.ok(finalScreenshotIdx !== -1, 'Final screenshot must be recorded in call log'));
    await countAssert(() => assert.ok(browserCloseIdx !== -1, 'browser.close must be recorded in call log'));
    await countAssert(() => assert.ok(finalScreenshotIdx < browserCloseIdx, 'Final screenshot must occur before browser.close'));

    // B. puppeteer.launch failure -> error propagated, newPage not called, browser.close NOT called
    caseCount++;
    const launchErrInstance = new Error('launch simulated failure instance');
    const harnessLaunchFail = createMockPuppeteerHarness({ launchRejects: true, launchError: launchErrInstance });
    let fsTouchedBeforeLaunch = false;

    const mockFsLaunch = createSafeMockFs({
      existsSync: () => { fsTouchedBeforeLaunch = true; return false; },
      rmSync: () => { fsTouchedBeforeLaunch = true; },
      mkdirSync: () => { fsTouchedBeforeLaunch = true; }
    });

    const serviceLaunchFail = createFrameRenderer({
      puppeteerImpl: harnessLaunchFail.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: mockFsLaunch,
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    let caughtLaunchErr = null;
    try {
      await serviceLaunchFail.captureFrames({ compositionHtmlPath: 'test.html', totalDuration: 0.1, tempDir: 'temp_frames', layout, fps: 10 });
    } catch (e) {
      caughtLaunchErr = e;
    }

    await countAssert(() => assert.strictEqual(caughtLaunchErr, launchErrInstance, 'Original launch error instance must propagate'));
    await countAssert(() => assert.strictEqual(harnessLaunchFail.getNewPageCallCount(), 0, 'newPage must NOT be called when launch fails'));
    await countAssert(() => assert.strictEqual(harnessLaunchFail.getCloseCallCount(), 0, 'browser.close must NOT be called when launch fails'));
    await countAssert(() => assert.strictEqual(fsTouchedBeforeLaunch, false, 'tempDir operations must NOT occur before launch succeeds'));

    // C. page.goto failure -> error propagated, browser.close NOT called (baseline behavior preserved)
    caseCount++;
    const harnessGotoFail = createMockPuppeteerHarness({ gotoRejects: true });
    const serviceGotoFail = createFrameRenderer({
      puppeteerImpl: harnessGotoFail.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    await countAssert(async () => {
      await assert.rejects(
        () => serviceGotoFail.captureFrames({ compositionHtmlPath: 'test.html', totalDuration: 0.1, tempDir: 'temp_frames', layout, fps: 10 }),
        /goto simulated failure/,
        'Original goto error must propagate'
      );
    });
    await countAssert(() => assert.strictEqual(harnessGotoFail.getCloseCallCount(), 0, 'browser.close must NOT be called on goto failure (baseline semantics)'));

    // D. screenshot failure mid-loop -> error propagated, browser.close NOT called
    caseCount++;
    const harnessShotFail = createMockPuppeteerHarness({ screenshotRejectsOnFrame: 1 });
    const serviceShotFail = createFrameRenderer({
      puppeteerImpl: harnessShotFail.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: () => {}
    });

    await countAssert(async () => {
      await assert.rejects(
        () => serviceShotFail.captureFrames({ compositionHtmlPath: 'test.html', totalDuration: 0.2, tempDir: 'temp_frames', layout, fps: 10 }),
        /screenshot simulated failure on frame 1/,
        'Original screenshot error must propagate'
      );
    });
    await countAssert(() => assert.strictEqual(harnessShotFail.getCloseCallCount(), 0, 'browser.close must NOT be called on screenshot failure (baseline semantics)'));
  }
  console.log('✓ Section 7 Passed: Success close order and baseline failure error propagation locked.\n');

  // -------------------------------------------------------------
  // 8. PROGRESS LOGGING FORMAT AT 0, 100, AND FINAL FRAME
  // -------------------------------------------------------------
  console.log('--- 8. Progress Logging Format at 0, 100, and Final Frame ---');
  sectionCount++;
  {
    caseCount++;
    const harness = createMockPuppeteerHarness();
    const layout = createLayout();
    const progressLogs = [];

    const service = createFrameRenderer({
      puppeteerImpl: harness.mockPuppeteer,
      applyRuntimeVisualPatchesImpl: async () => {},
      fsImpl: createSafeMockFs(),
      pathImpl: path,
      logStep: () => {},
      logSuccess: () => {},
      consoleLogImpl: (msg) => progressLogs.push(msg)
    });

    // 101 frames total (totalDuration = 10.1s at 10fps -> 101 frames: indices 0..100)
    // Frame 0: percent = (1/101)*100 = 1.0% | Timestamp: 0.00s
    // Frame 100: percent = (101/101)*100 = 100.0% | Timestamp: 10.00s
    await service.captureFrames({
      compositionHtmlPath: 'test.html',
      totalDuration: 10.1,
      tempDir: 'temp_frames',
      layout,
      fps: 10
    });

    await countAssert(() => assert.strictEqual(progressLogs.length, 2, 'Progress log must trigger at frame 0 and frame 100 (final frame)'));
    await countAssert(() => assert.strictEqual(progressLogs[0], '   [Puppeteer] Captured frame 1/101 (1.0%) | Timestamp: 0.00s'));
    await countAssert(() => assert.strictEqual(progressLogs[1], '   [Puppeteer] Captured frame 101/101 (100.0%) | Timestamp: 10.00s'));
  }
  console.log('✓ Section 8 Passed: Progress logging format locked.\n');

  // -------------------------------------------------------------
  // 9. COMPOSITION-ROOT SHARED FPS WIRING LOCK
  // -------------------------------------------------------------
  console.log('--- 9. Composition-Root Shared FPS Wiring Lock ---');
  sectionCount++;
  {
    caseCount++;
    const pipelineCode = fs.readFileSync(path.resolve('pipeline.js'), 'utf8');

    // 1. Pipeline imports createFrameRenderer
    await countAssert(() => assert.ok(pipelineCode.includes("import { createFrameRenderer } from './src/pipeline/frameRenderer.js';"), 'pipeline.js must import createFrameRenderer'));

    // 2. Pipeline instantiates createFrameRenderer
    await countAssert(() => assert.ok(pipelineCode.includes('createFrameRenderer({'), 'pipeline.js must instantiate createFrameRenderer'));

    // 3. Pipeline owns shared const fps = 15;
    await countAssert(() => assert.ok(pipelineCode.includes('const fps = 15;'), 'pipeline.js must own shared const fps = 15;'));

    // 4. Same fps passed to captureFrames
    await countAssert(() => assert.ok(pipelineCode.includes('await captureFrames({\n      compositionHtmlPath,\n      totalDuration,\n      tempDir,\n      layout: LAYOUT,\n      fps\n    });') ||
      pipelineCode.includes('await captureFrames({\r\n      compositionHtmlPath,\r\n      totalDuration,\r\n      tempDir,\r\n      layout: LAYOUT,\r\n      fps\r\n    });'),
      'captureFrames must receive pipeline-owned fps'));

    // 5. Same fps passed to buildFinalFfmpegCommand
    await countAssert(() => assert.ok(pipelineCode.includes('buildFinalFfmpegCommand({\n      videoPath,\n      brollFilterInputs: brollFilter.inputs,\n      fps,') ||
      pipelineCode.includes('buildFinalFfmpegCommand({\r\n      videoPath,\r\n      brollFilterInputs: brollFilter.inputs,\r\n      fps,'),
      'buildFinalFfmpegCommand must receive same pipeline-owned fps'));
  }
  console.log('✓ Section 9 Passed: Shared FPS wiring contract locked.\n');

  console.log('==================================================================');
  console.log(`✓ ALL ${sectionCount} SECTIONS PASSED (${assertionCount} assertions, ${caseCount} cases) 100%!`);
  console.log('==================================================================\n');
}

runFrameRendererCharacterizationTests().catch(err => {
  console.error('❌ FRAME RENDERER CHARACTERIZATION FAILED:', err);
  process.exit(1);
});
