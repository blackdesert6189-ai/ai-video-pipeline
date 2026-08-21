/**
 * qa_regression/test_presenter_layout.cjs
 * Comprehensive characterization test suite for extracted Presenter Layout module.
 * Strictly locks:
 * 1. Public API surface contract (createPresenterLayout with detectPresenterSide, applyPresenterSide)
 * 2. applyPresenterSide: LEFT positioning, margins, visualRow, and log
 * 3. applyPresenterSide: CENTER cumulative top positioning (+50px per call) and log
 * 4. applyPresenterSide: RIGHT and fallback behavior (no-op layout mutation, infoLeft log)
 * 5. detectPresenterSide: tmp directory path (.face_probe) and mkdir before try
 * 6. detectPresenterSide: duration ffprobe command, parsing, and fallback to 10
 * 7. detectPresenterSide: 25/50/75 frame sampling, min 1s math, filenames, and ffmpeg command
 * 8. detectPresenterSide: fallback to 'right' when 0 probe frames extracted (no Puppeteer launch)
 * 9. detectPresenterSide: Puppeteer launch options (headless: 'new', args array order)
 * 10. detectPresenterSide: per-frame page contract (viewport 640x1136, HTML base64 JPEG, waitForSelector, page.close)
 * 11. detectPresenterSide: Real page.evaluate() callback execution with mocked browser globals (window, document, FaceDetector)
 * 12. detectPresenterSide: Exact ratio boundaries (0.3799 => left, 0.3800 => center, 0.5000 => center, 0.6200 => center, 0.6201 => right)
 * 13. detectPresenterSide: FaceDetector constructor options ({ fastMode: true, maxDetectedFaces: 2 }) through real callback
 * 14. detectPresenterSide: faces[0] only determines result through real callback (order reversed validation)
 * 15. detectPresenterSide: Missing FaceDetector in window returns null and defaults to 'right' with no warning
 * 16. detectPresenterSide: Empty faces array returns null and defaults to 'right' with no warning
 * 17. detectPresenterSide: FaceDetector.detect() throw swallowed in evaluate and defaults to 'right' with no outer warning
 * 18. detectPresenterSide: img.complete = false triggers img.onload() promise path through real callback
 * 19. detectPresenterSide: Majority voting ([left, left, right] -> left, [right, center, right] -> right)
 * 20. detectPresenterSide: Stable tie quirk ([left, right, null] -> left)
 * 21. detectPresenterSide: Outer failure (launch error) logs warning and defaults to 'right'
 * 22. detectPresenterSide: Strict cleanup (.face_probe removed after normal success, 0 frames, and outer error)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

async function runPresenterLayoutCharacterizationTests() {
  console.log('==================================================================');
  console.log('   PRESENTER LAYOUT CHARACTERIZATION TEST SUITE');
  console.log('==================================================================\n');

  const modPath = path.resolve('src', 'pipeline', 'presenterLayout.js');
  const mod = await import(pathToFileURL(modPath).href);
  const { createPresenterLayout } = mod;

  function createLayoutFixture() {
    return {
      canvas: { w: 1080, h: 1920 },
      card: {
        width: 920,
        statWidth: 920,
        neonBarLeft: 70,
        infoLeft: 70,
        statLeft: 70,
        defaultTop: 1100,
        introX: 0,
        exitX: 0
      },
      visualRow: {
        left: 70,
        introX: 0,
        exitX: 0
      }
    };
  }

  // Helper to create Puppeteer mock that executes the REAL page.evaluate() callback
  function createRealCallbackPuppeteerMock({
    faces = [],
    naturalWidth = 10000,
    hasFaceDetector = true,
    complete = true,
    detectThrows = false,
    onDetectorConstructed = null
  } = {}) {
    let capturedDetectorOpts = null;
    let capturedLaunchOpts = null;
    let browserClosed = false;
    const pageCalls = [];

    const mockPuppeteer = {
      launch: async (launchOpts) => {
        capturedLaunchOpts = launchOpts;
        return {
          newPage: async () => {
            const pageState = { setViewport: null, setContent: null, waitForSelector: null, closed: false };
            pageCalls.push(pageState);
            return {
              setViewport: async (vp) => { pageState.setViewport = vp; },
              setContent: async (html) => { pageState.setContent = html; },
              waitForSelector: async (sel) => { pageState.waitForSelector = sel; },
              evaluate: async (fn) => {
                // Execute the REAL production callback under faithful browser globals
                const mockImg = {
                  complete: complete,
                  naturalWidth: naturalWidth,
                  onload: null
                };

                class MockFaceDetector {
                  constructor(opts) {
                    capturedDetectorOpts = opts;
                    if (onDetectorConstructed) onDetectorConstructed(opts);
                  }
                  async detect(img) {
                    if (detectThrows) {
                      throw new Error('detector mock failure');
                    }
                    return typeof faces === 'function' ? faces() : faces;
                  }
                }

                const mockWindow = {};
                if (hasFaceDetector) {
                  mockWindow.FaceDetector = MockFaceDetector;
                }

                const mockDocument = {
                  getElementById: (id) => {
                    if (id === 'i') return mockImg;
                    return null;
                  }
                };

                // Install globals
                const prevWindow = global.window;
                const prevDocument = global.document;
                const prevFaceDetector = global.FaceDetector;

                global.window = mockWindow;
                global.document = mockDocument;
                if (hasFaceDetector) {
                  global.FaceDetector = MockFaceDetector;
                } else {
                  delete global.FaceDetector;
                }

                try {
                  if (!complete) {
                    setImmediate(() => {
                      if (typeof mockImg.onload === 'function') {
                        mockImg.onload();
                      }
                    });
                  }
                  // Invoke the actual function passed by production!
                  return await fn();
                } finally {
                  // Restore globals cleanly
                  if (prevWindow !== undefined) global.window = prevWindow; else delete global.window;
                  if (prevDocument !== undefined) global.document = prevDocument; else delete global.document;
                  if (prevFaceDetector !== undefined) global.FaceDetector = prevFaceDetector; else delete global.FaceDetector;
                }
              },
              close: async () => { pageState.closed = true; }
            };
          },
          close: async () => { browserClosed = true; }
        };
      },
      getCapturedDetectorOpts: () => capturedDetectorOpts,
      getCapturedLaunchOpts: () => capturedLaunchOpts,
      isBrowserClosed: () => browserClosed,
      getPageCalls: () => pageCalls
    };

    return mockPuppeteer;
  }

  // -------------------------------------------------------------
  // 1. PUBLIC API SURFACE CONTRACT
  // -------------------------------------------------------------
  console.log('--- 1. Public API Surface Contract ---');
  assert.strictEqual(typeof createPresenterLayout, 'function', 'Factory must be exported');
  const service = createPresenterLayout({ layout: createLayoutFixture() });
  assert.strictEqual(typeof service.detectPresenterSide, 'function', 'detectPresenterSide must be function');
  assert.strictEqual(typeof service.applyPresenterSide, 'function', 'applyPresenterSide must be function');
  const exportedKeys = Object.keys(service).sort();
  assert.deepStrictEqual(exportedKeys, ['applyPresenterSide', 'detectPresenterSide'], 'Only 2 public methods allowed');
  console.log('✓ Section 1 Passed: Public API contract locked.\n');

  // -------------------------------------------------------------
  // 2. applyPresenterSide: LEFT POSITIONING
  // -------------------------------------------------------------
  console.log('--- 2. applyPresenterSide: LEFT Positioning ---');
  {
    const layout = createLayoutFixture();
    let loggedSuccess = '';
    const svc = createPresenterLayout({
      layout,
      logSuccess: (msg) => { loggedSuccess = msg; }
    });

    svc.applyPresenterSide('left');

    // margin = 70. 1080 - 920 - 70 = 90
    assert.strictEqual(layout.card.infoLeft, 90, 'card.infoLeft mutated to right side (90)');
    assert.strictEqual(layout.card.statLeft, 90, 'card.statLeft mutated to right side (90)');
    assert.strictEqual(layout.card.neonBarLeft, 90, 'card.neonBarLeft set to infoLeft (90)');
    assert.strictEqual(layout.card.introX, 160, 'card.introX set to 160');
    assert.strictEqual(layout.card.exitX, 34, 'card.exitX set to 34');
    assert.strictEqual(layout.visualRow.left, 90, 'visualRow.left set to 90');
    assert.strictEqual(layout.visualRow.introX, 24, 'visualRow.introX set to 24');
    assert.strictEqual(layout.visualRow.exitX, 16, 'visualRow.exitX set to 16');
    assert.strictEqual(loggedSuccess, 'Presenter: LEFT → cards positioned on RIGHT (margin: 70px)');
  }
  console.log('✓ Section 2 Passed: applyPresenterSide LEFT positioning locked.\n');

  // -------------------------------------------------------------
  // 3. applyPresenterSide: CENTER CUMULATIVE TOP POSITIONING
  // -------------------------------------------------------------
  console.log('--- 3. applyPresenterSide: CENTER Cumulative Top Positioning ---');
  {
    const layout = createLayoutFixture();
    let loggedSuccess = '';
    const svc = createPresenterLayout({
      layout,
      logSuccess: (msg) => { loggedSuccess = msg; }
    });

    assert.strictEqual(layout.card.defaultTop, 1100, 'Initial defaultTop = 1100');

    // 1st call -> +50 = 1150
    svc.applyPresenterSide('center');
    assert.strictEqual(layout.card.defaultTop, 1150, 'After 1st center call defaultTop = 1150');
    assert.strictEqual(loggedSuccess, 'Presenter: CENTER → cards positioned lower (+50px)');

    // 2nd call -> +50 = 1200 (cumulative!)
    svc.applyPresenterSide('center');
    assert.strictEqual(layout.card.defaultTop, 1200, 'After 2nd center call defaultTop = 1200 (cumulative)');
  }
  console.log('✓ Section 3 Passed: applyPresenterSide CENTER cumulative behavior locked.\n');

  // -------------------------------------------------------------
  // 4. applyPresenterSide: RIGHT & FALLBACK BEHAVIOR
  // -------------------------------------------------------------
  console.log('--- 4. applyPresenterSide: RIGHT & Fallback Behavior ---');
  {
    const testCases = ['right', 'RIGHT', undefined, null, 'unknown_side'];
    for (const side of testCases) {
      const layout = createLayoutFixture();
      const initialJson = JSON.stringify(layout);
      let loggedSuccess = '';
      const svc = createPresenterLayout({
        layout,
        logSuccess: (msg) => { loggedSuccess = msg; }
      });

      svc.applyPresenterSide(side);

      assert.strictEqual(JSON.stringify(layout), initialJson, `Layout must NOT mutate for side: ${side}`);
      assert.strictEqual(loggedSuccess, 'Presenter: RIGHT → cards centered (infoLeft: 70px)');
    }
  }
  console.log('✓ Section 4 Passed: applyPresenterSide RIGHT & fallback behavior locked.\n');

  // -------------------------------------------------------------
  // 5. detectPresenterSide: DURATION PROBE & SAMPLING COMMANDS
  // -------------------------------------------------------------
  console.log('--- 5. detectPresenterSide: Duration Probe & Frame Sampling Commands ---');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-pres-test-'));
    const dummyVideo = path.join(tmpDir, 'test_video.mp4');
    fs.writeFileSync(dummyVideo, 'fake-mp4-data');

    const execCalls = [];
    const mockExecSync = (cmd, opts) => {
      execCalls.push({ cmd, opts });
      if (cmd.includes('format=duration')) {
        return '20.000000\n'; // Duration = 20s
      }
      if (cmd.includes('ffmpeg')) {
        // Create the probe file so existsSync passes
        const match = cmd.match(/"([^"]+\.jpg)"/);
        if (match && match[1]) {
          fs.writeFileSync(match[1], 'fake-jpg-data');
        }
        return '';
      }
      return '';
    };

    const mockPuppeteer = createRealCallbackPuppeteerMock({
      faces: [{ boundingBox: { x: 2000, width: 1000 } }], // ratio 0.25 -> left
      naturalWidth: 10000
    });

    const svc = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExecSync,
      puppeteerImpl: mockPuppeteer
    });

    try {
      const result = await svc.detectPresenterSide(dummyVideo);

      // Verify duration probe command
      assert.ok(execCalls[0].cmd.includes('-show_entries format=duration -of csv=p=0'), 'Duration probe command formatted');
      assert.ok(execCalls[0].cmd.includes(`"${dummyVideo}"`), 'Duration probe video path quoted');
      assert.strictEqual(execCalls[0].opts.encoding, 'utf8', 'Duration probe uses utf8 encoding');

      // Verify 25%, 50%, 75% sampling for duration 20s -> 5, 10, 15
      assert.strictEqual(execCalls.length, 4); // 1 probe + 3 frames
      assert.ok(execCalls[1].cmd.includes('-ss 5 -i'), 'Frame 0 at 25% (5s)');
      assert.ok(execCalls[1].cmd.includes('probe_0.jpg'), 'Frame 0 named probe_0.jpg');
      assert.ok(execCalls[2].cmd.includes('-ss 10 -i'), 'Frame 1 at 50% (10s)');
      assert.ok(execCalls[2].cmd.includes('probe_1.jpg'), 'Frame 1 named probe_1.jpg');
      assert.ok(execCalls[3].cmd.includes('-ss 15 -i'), 'Frame 2 at 75% (15s)');
      assert.ok(execCalls[3].cmd.includes('probe_2.jpg'), 'Frame 2 named probe_2.jpg');

      assert.strictEqual(result, 'left');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
  console.log('✓ Section 5 Passed: Duration probe and frame sampling commands locked.\n');

  // -------------------------------------------------------------
  // 6. detectPresenterSide: MIN-1-SEC MATH & DURATION FALLBACK
  // -------------------------------------------------------------
  console.log('--- 6. detectPresenterSide: Min-1-sec & Duration Fallback ---');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-pres-test-'));
    const dummyVideo = path.join(tmpDir, 'short_video.mp4');
    fs.writeFileSync(dummyVideo, 'fake-mp4');

    const execCalls = [];
    const mockExecShort = (cmd) => {
      execCalls.push(cmd);
      if (cmd.includes('format=duration')) {
        return '1.200000\n'; // Short duration (1.2s -> 25% = 0.3s -> Math.max(1, 0) = 1)
      }
      if (cmd.includes('ffmpeg')) {
        const match = cmd.match(/"([^"]+\.jpg)"/);
        if (match) fs.writeFileSync(match[1], 'fake-jpg');
      }
      return '';
    };

    const mockPuppeteer = createRealCallbackPuppeteerMock({
      faces: [{ boundingBox: { x: 7000, width: 1000 } }], // ratio 0.75 -> right
      naturalWidth: 10000
    });

    const svc = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExecShort,
      puppeteerImpl: mockPuppeteer
    });

    try {
      await svc.detectPresenterSide(dummyVideo);
      // For short video 1.2s:
      // 25% (0.3s) -> Math.max(1, Math.floor(0.3)) = 1s
      // 50% (0.6s) -> Math.max(1, Math.floor(0.6)) = 1s
      // 75% (0.9s) -> Math.max(1, Math.floor(0.9)) = 1s
      assert.ok(execCalls[1].includes('-ss 1 -i'), 'Frame 0 clamped to min 1s');
      assert.ok(execCalls[2].includes('-ss 1 -i'), 'Frame 1 clamped to min 1s');
      assert.ok(execCalls[3].includes('-ss 1 -i'), 'Frame 2 clamped to min 1s');

      // Case B: Duration ffprobe failure -> defaults to 10s -> 2s, 5s, 7s
      execCalls.length = 0;
      const mockExecFailDuration = (cmd) => {
        execCalls.push(cmd);
        if (cmd.includes('format=duration')) {
          throw new Error('ffprobe duration failed');
        }
        if (cmd.includes('ffmpeg')) {
          const match = cmd.match(/"([^"]+\.jpg)"/);
          if (match) fs.writeFileSync(match[1], 'fake-jpg');
        }
        return '';
      };

      const svc2 = createPresenterLayout({
        layout: createLayoutFixture(),
        execSyncImpl: mockExecFailDuration,
        puppeteerImpl: mockPuppeteer
      });

      await svc2.detectPresenterSide(dummyVideo);
      assert.ok(execCalls[1].includes('-ss 2 -i'), 'Fallback 10s -> 25% = 2s');
      assert.ok(execCalls[2].includes('-ss 5 -i'), 'Fallback 10s -> 50% = 5s');
      assert.ok(execCalls[3].includes('-ss 7 -i'), 'Fallback 10s -> 75% = 7s');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
  console.log('✓ Section 6 Passed: Min-1-sec and duration fallback locked.\n');

  // -------------------------------------------------------------
  // 7. detectPresenterSide: NO-PROBE-FRAME FALLBACK (0 PUPPETEER LAUNCHES)
  // -------------------------------------------------------------
  console.log('--- 7. detectPresenterSide: 0 Probe Frames Fallback ---');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-pres-test-'));
    const dummyVideo = path.join(tmpDir, 'no_frames.mp4');
    fs.writeFileSync(dummyVideo, 'fake-mp4');

    let launchCount = 0;
    const mockExecFailFrames = (cmd) => {
      if (cmd.includes('format=duration')) return '10\n';
      if (cmd.includes('ffmpeg')) throw new Error('ffmpeg failed'); // no probe files created
      return '';
    };

    const mockPuppeteer = {
      launch: async () => { launchCount++; return {}; }
    };

    const svc = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExecFailFrames,
      puppeteerImpl: mockPuppeteer
    });

    try {
      const result = await svc.detectPresenterSide(dummyVideo);
      assert.strictEqual(result, 'right', 'Returns right when 0 probe frames extracted');
      assert.strictEqual(launchCount, 0, 'Puppeteer must NOT launch when 0 probe frames');
      // Verify cleanup
      const probeDir = path.join(tmpDir, '.face_probe');
      assert.strictEqual(fs.existsSync(probeDir), false, '.face_probe cleaned up');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
  console.log('✓ Section 7 Passed: 0 probe frames fallback locked.\n');

  // -------------------------------------------------------------
  // 8. detectPresenterSide: PUPPETEER LAUNCH OPTIONS & PER-FRAME PAGE CONTRACT
  // -------------------------------------------------------------
  console.log('--- 8. detectPresenterSide: Puppeteer Launch Options & Page Contract ---');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-pres-test-'));
    const dummyVideo = path.join(tmpDir, 'contract_test.mp4');
    fs.writeFileSync(dummyVideo, 'fake-mp4');

    const mockExec = (cmd) => {
      if (cmd.includes('format=duration')) return '10\n';
      if (cmd.includes('ffmpeg')) {
        const match = cmd.match(/"([^"]+\.jpg)"/);
        if (match) fs.writeFileSync(match[1], 'fake-frame-bytes');
      }
      return '';
    };

    const mockPuppeteer = createRealCallbackPuppeteerMock({
      faces: [{ boundingBox: { x: 2000, width: 1000 } }], // ratio 0.25 -> left
      naturalWidth: 10000
    });

    const svc = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExec,
      puppeteerImpl: mockPuppeteer
    });

    try {
      const result = await svc.detectPresenterSide(dummyVideo);

      // Verify launch options
      const launchOpts = mockPuppeteer.getCapturedLaunchOpts();
      assert.strictEqual(launchOpts.headless, 'new', 'headless === new');
      assert.deepStrictEqual(
        launchOpts.args,
        ['--no-sandbox', '--disable-setuid-sandbox', '--enable-experimental-web-platform-features'],
        'Exact Puppeteer browser args array'
      );

      // Verify 3 pages created and closed
      const pageCalls = mockPuppeteer.getPageCalls();
      assert.strictEqual(pageCalls.length, 3, '3 probe frames processed');
      for (const p of pageCalls) {
        assert.deepStrictEqual(p.setViewport, { width: 640, height: 1136 }, 'Viewport 640x1136');
        assert.ok(p.setContent.startsWith('<!doctype html><img id="i" src="data:image/jpeg;base64,'), 'HTML template with base64');
        assert.strictEqual(p.waitForSelector, '#i', 'Waits for #i');
        assert.strictEqual(p.closed, true, 'Page closed');
      }
      assert.strictEqual(mockPuppeteer.isBrowserClosed(), true, 'Browser closed');
      assert.strictEqual(result, 'left');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
  console.log('✓ Section 8 Passed: Puppeteer launch options & page contract locked.\n');

  // -------------------------------------------------------------
  // 9. detectPresenterSide: REAL page.evaluate() CALLBACK EXECUTION & FACE THRESHOLD BOUNDARIES
  // -------------------------------------------------------------
  console.log('--- 9. Real page.evaluate() Callback Execution & Face Threshold Boundaries ---');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-pres-test-'));
    const dummyVideo = path.join(tmpDir, 'threshold_test.mp4');
    fs.writeFileSync(dummyVideo, 'fake-mp4');

    const mockExec = (cmd) => {
      if (cmd.includes('format=duration')) return '10\n';
      if (cmd.includes('ffmpeg')) {
        const match = cmd.match(/"([^"]+\.jpg)"/);
        if (match) fs.writeFileSync(match[1], 'fake-frame-bytes');
      }
      return '';
    };

    const W = 10000;

    // Helper to test detectPresenterSide with real callback execution
    async function testThresholdWithRealCallback(facesArray) {
      let detectorOpts = null;
      const mockPuppeteer = createRealCallbackPuppeteerMock({
        faces: facesArray,
        naturalWidth: W,
        onDetectorConstructed: (opts) => { detectorOpts = opts; }
      });

      const svc = createPresenterLayout({
        layout: createLayoutFixture(),
        execSyncImpl: mockExec,
        puppeteerImpl: mockPuppeteer
      });

      const result = await svc.detectPresenterSide(dummyVideo);
      return { result, detectorOpts };
    }

    try {
      // 1. ratio = 0.3799 -> 'left'
      // cx = 3500 + 598/2 = 3799 -> ratio = 0.3799 (< 0.38)
      const res1 = await testThresholdWithRealCallback([{ boundingBox: { x: 3500, width: 598 } }]);
      assert.strictEqual(res1.result, 'left', 'Real callback execution: ratio 0.3799 (< 0.38) yields left');

      // Verify FaceDetector constructor options through real production callback execution
      assert.deepStrictEqual(
        res1.detectorOpts,
        { fastMode: true, maxDetectedFaces: 2 },
        'FaceDetector constructor options match { fastMode: true, maxDetectedFaces: 2 }'
      );

      // 2. ratio = 0.3800 -> 'center' (strict boundary!)
      // cx = 3500 + 600/2 = 3800 -> ratio = 0.3800
      const res2 = await testThresholdWithRealCallback([{ boundingBox: { x: 3500, width: 600 } }]);
      assert.strictEqual(res2.result, 'center', 'Real callback execution: ratio 0.3800 exactly yields center');

      // 3. ratio = 0.5000 -> 'center'
      // cx = 4500 + 1000/2 = 5000 -> ratio = 0.5000
      const res3 = await testThresholdWithRealCallback([{ boundingBox: { x: 4500, width: 1000 } }]);
      assert.strictEqual(res3.result, 'center', 'Real callback execution: ratio 0.5000 yields center');

      // 4. ratio = 0.6200 -> 'center' (strict boundary!)
      // cx = 6000 + 400/2 = 6200 -> ratio = 0.6200
      const res4 = await testThresholdWithRealCallback([{ boundingBox: { x: 6000, width: 400 } }]);
      assert.strictEqual(res4.result, 'center', 'Real callback execution: ratio 0.6200 exactly yields center');

      // 5. ratio = 0.6201 -> 'right'
      // cx = 6000 + 402/2 = 6201 -> ratio = 0.6201 (> 0.62)
      const res5 = await testThresholdWithRealCallback([{ boundingBox: { x: 6000, width: 402 } }]);
      assert.strictEqual(res5.result, 'right', 'Real callback execution: ratio 0.6201 (> 0.62) yields right');

      // 6. Lock faces[0] only: [faceLeft, faceRight] -> yields left
      const resFacesLeftFirst = await testThresholdWithRealCallback([
        { boundingBox: { x: 3500, width: 598 } }, // face 0: ratio 0.3799 -> left
        { boundingBox: { x: 6000, width: 402 } }  // face 1: ratio 0.6201 -> right
      ]);
      assert.strictEqual(resFacesLeftFirst.result, 'left', 'Real callback: faces[0] left takes precedence over faces[1] right');

      // 7. Lock faces[0] only: [faceRight, faceLeft] -> yields right
      const resFacesRightFirst = await testThresholdWithRealCallback([
        { boundingBox: { x: 6000, width: 402 } }, // face 0: ratio 0.6201 -> right
        { boundingBox: { x: 3500, width: 598 } }  // face 1: ratio 0.3799 -> left
      ]);
      assert.strictEqual(resFacesRightFirst.result, 'right', 'Real callback: faces[0] right takes precedence over faces[1] left');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
  console.log('✓ Section 9 Passed: Real callback execution, thresholds & faces[0] locked.\n');

  // -------------------------------------------------------------
  // 10. detectPresenterSide: ERROR / FALLBACK PATHS THROUGH REAL CALLBACK
  // -------------------------------------------------------------
  console.log('--- 10. Real Callback Error & Fallback Paths ---');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-pres-test-'));
    const dummyVideo = path.join(tmpDir, 'err_paths.mp4');
    fs.writeFileSync(dummyVideo, 'fake-mp4');

    const mockExec = (cmd) => {
      if (cmd.includes('format=duration')) return '10\n';
      if (cmd.includes('ffmpeg')) {
        const match = cmd.match(/"([^"]+\.jpg)"/);
        if (match) fs.writeFileSync(match[1], 'fake-frame-bytes');
      }
      return '';
    };

    // Case A: Missing FaceDetector in window -> returns 'right', NO warning
    {
      let warningLogged = '';
      const mockPuppeteerNoFD = createRealCallbackPuppeteerMock({
        hasFaceDetector: false
      });
      const svc = createPresenterLayout({
        layout: createLayoutFixture(),
        execSyncImpl: mockExec,
        puppeteerImpl: mockPuppeteerNoFD,
        logWarning: (w) => { warningLogged = w; }
      });
      const result = await svc.detectPresenterSide(dummyVideo);
      assert.strictEqual(result, 'right', 'Missing FaceDetector in window defaults to right');
      assert.strictEqual(warningLogged, '', 'No warning logged for missing FaceDetector in window');
    }

    // Case B: Empty faces array [] -> returns 'right', NO warning
    {
      let warningLogged = '';
      const mockPuppeteerEmpty = createRealCallbackPuppeteerMock({
        faces: []
      });
      const svc = createPresenterLayout({
        layout: createLayoutFixture(),
        execSyncImpl: mockExec,
        puppeteerImpl: mockPuppeteerEmpty,
        logWarning: (w) => { warningLogged = w; }
      });
      const result = await svc.detectPresenterSide(dummyVideo);
      assert.strictEqual(result, 'right', 'Empty faces array defaults to right');
      assert.strictEqual(warningLogged, '', 'No warning logged for empty faces array');
    }

    // Case C: FaceDetector.detect() throws -> caught inside evaluate callback -> returns 'right', NO outer warning
    {
      let warningLogged = '';
      const mockPuppeteerThrow = createRealCallbackPuppeteerMock({
        detectThrows: true
      });
      const svc = createPresenterLayout({
        layout: createLayoutFixture(),
        execSyncImpl: mockExec,
        puppeteerImpl: mockPuppeteerThrow,
        logWarning: (w) => { warningLogged = w; }
      });
      const result = await svc.detectPresenterSide(dummyVideo);
      assert.strictEqual(result, 'right', 'FaceDetector.detect() throw defaults to right');
      assert.strictEqual(warningLogged, '', 'No outer warning logged when error is swallowed inside page.evaluate');
    }

    // Case D: img.complete = false -> waits for img.onload() and resolves
    {
      const mockPuppeteerOnload = createRealCallbackPuppeteerMock({
        complete: false,
        faces: [{ boundingBox: { x: 2000, width: 1000 } }], // ratio 0.25 -> left
        naturalWidth: 10000
      });
      const svc = createPresenterLayout({
        layout: createLayoutFixture(),
        execSyncImpl: mockExec,
        puppeteerImpl: mockPuppeteerOnload
      });
      const result = await svc.detectPresenterSide(dummyVideo);
      assert.strictEqual(result, 'left', 'img.complete = false path successfully triggers onload and completes');
    }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  console.log('✓ Section 10 Passed: Error & fallback paths through real callback locked.\n');

  // -------------------------------------------------------------
  // 11. MAJORITY VOTING & STABLE TIE BEHAVIOR
  // -------------------------------------------------------------
  console.log('--- 11. Majority Voting & Stable Tie Behavior ---');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-pres-test-'));
    const dummyVideo = path.join(tmpDir, 'voting_video.mp4');
    fs.writeFileSync(dummyVideo, 'fake-mp4');

    const mockExec = (cmd) => {
      if (cmd.includes('format=duration')) return '10\n';
      if (cmd.includes('ffmpeg')) {
        const match = cmd.match(/"([^"]+\.jpg)"/);
        if (match) fs.writeFileSync(match[1], 'fake-jpg');
      }
      return '';
    };

    // Case A: Majority left (left, left, right) -> left
    let evalIdxA = 0;
    const votesA = ['left', 'left', 'right'];
    const mockPuppeteerA = {
      launch: async () => ({
        newPage: async () => ({
          setViewport: async () => {},
          setContent: async () => {},
          waitForSelector: async () => {},
          evaluate: async () => votesA[evalIdxA++],
          close: async () => {}
        }),
        close: async () => {}
      })
    };

    const svcA = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExec,
      puppeteerImpl: mockPuppeteerA
    });

    const resA = await svcA.detectPresenterSide(dummyVideo);
    assert.strictEqual(resA, 'left', 'Majority [left, left, right] -> left');

    // Case B: Majority right (right, center, right) -> right
    let evalIdxB = 0;
    const votesB = ['right', 'center', 'right'];
    const mockPuppeteerB = {
      launch: async () => ({
        newPage: async () => ({
          setViewport: async () => {},
          setContent: async () => {},
          waitForSelector: async () => {},
          evaluate: async () => votesB[evalIdxB++],
          close: async () => {}
        }),
        close: async () => {}
      })
    };

    const svcB = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExec,
      puppeteerImpl: mockPuppeteerB
    });

    const resB = await svcB.detectPresenterSide(dummyVideo);
    assert.strictEqual(resB, 'right', 'Majority [right, center, right] -> right');

    // Case C: Stable Tie: [left, right, null] -> Object.entries(counts) has [['left', 1], ['right', 1]] -> sort((a,b)=>b[1]-a[1]) preserves 'left'
    let evalIdxC = 0;
    const votesC = ['left', 'right', null];
    const mockPuppeteerC = {
      launch: async () => ({
        newPage: async () => ({
          setViewport: async () => {},
          setContent: async () => {},
          waitForSelector: async () => {},
          evaluate: async () => votesC[evalIdxC++],
          close: async () => {}
        }),
        close: async () => {}
      })
    };

    const svcC = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExec,
      puppeteerImpl: mockPuppeteerC
    });

    const resC = await svcC.detectPresenterSide(dummyVideo);
    assert.strictEqual(resC, 'left', 'Stable tie [left, right, null] returns first encountered ("left")');

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  console.log('✓ Section 11 Passed: Majority voting & stable tie behavior locked.\n');

  // -------------------------------------------------------------
  // 12. ERROR HANDLING, WARNING LOG & CLEANUP (NORMAL SUCCESS & FAILURE)
  // -------------------------------------------------------------
  console.log('--- 12. Error Handling, Warning Log & Cleanup ---');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnfi-pres-test-'));
    const dummyVideo = path.join(tmpDir, 'error_video.mp4');
    fs.writeFileSync(dummyVideo, 'fake-mp4');

    const mockExec = (cmd) => {
      if (cmd.includes('format=duration')) return '10\n';
      if (cmd.includes('ffmpeg')) {
        const match = cmd.match(/"([^"]+\.jpg)"/);
        if (match) fs.writeFileSync(match[1], 'fake-jpg');
      }
      return '';
    };

    // Case 1: Puppeteer launch throws (Outer Failure)
    let capturedWarning = '';
    const mockPuppeteerError = {
      launch: async () => {
        throw new Error('Chromium crash mock');
      }
    };

    const svcError = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExec,
      puppeteerImpl: mockPuppeteerError,
      logWarning: (msg) => { capturedWarning = msg; }
    });

    const resError = await svcError.detectPresenterSide(dummyVideo);
    assert.strictEqual(resError, 'right', 'Defaults to right on outer error');
    assert.strictEqual(capturedWarning, 'Face detection failed: Chromium crash mock — defaulting to RIGHT');

    // Verify .face_probe directory was cleaned up on failure
    const probeDir = path.join(tmpDir, '.face_probe');
    assert.strictEqual(fs.existsSync(probeDir), false, '.face_probe must be removed in finally on failure');

    // Case 2: Normal Success Cleanup
    const mockPuppeteerSuccess = createRealCallbackPuppeteerMock({
      faces: [{ boundingBox: { x: 2000, width: 1000 } }], // left
      naturalWidth: 10000
    });

    const svcSuccess = createPresenterLayout({
      layout: createLayoutFixture(),
      execSyncImpl: mockExec,
      puppeteerImpl: mockPuppeteerSuccess
    });

    const resSuccess = await svcSuccess.detectPresenterSide(dummyVideo);
    assert.strictEqual(resSuccess, 'left', 'Normal detection returns left');
    // Explicitly verify .face_probe directory was cleaned up on NORMAL SUCCESS
    assert.strictEqual(fs.existsSync(probeDir), false, '.face_probe must be removed in finally on normal success');

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  console.log('✓ Section 12 Passed: Error handling, warning log & normal success cleanup locked.\n');

  console.log('==================================================================');
  console.log('✓ ALL 12 CHARACTERIZATION SECTIONS AND 50+ ASSERTIONS PASSED 100%!');
  console.log('==================================================================\n');
}

runPresenterLayoutCharacterizationTests().catch(err => {
  console.error('❌ PRESENTER LAYOUT CHARACTERIZATION FAILED:', err);
  process.exit(1);
});
