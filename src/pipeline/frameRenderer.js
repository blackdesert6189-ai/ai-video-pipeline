/**
 * src/pipeline/frameRenderer.js
 * Puppeteer Frame Capture Service for CNFI Video Pipeline.
 * 
 * Handles browser lifecycle, page viewport configuration, runtime DOM patches,
 * font readiness, GSAP timeline detection, pre-capture frame directory management,
 * and deterministic transparent PNG frame sequence capturing.
 */

export function createFrameRenderer(options = {}) {
  const {
    puppeteerImpl,
    applyRuntimeVisualPatchesImpl,
    fsImpl,
    pathImpl,
    logStep = console.log,
    logSuccess = console.log,
    consoleLogImpl = console.log
  } = options;

  if (!puppeteerImpl) {
    throw new Error('createFrameRenderer: puppeteerImpl is required');
  }
  if (!applyRuntimeVisualPatchesImpl) {
    throw new Error('createFrameRenderer: applyRuntimeVisualPatchesImpl is required');
  }
  if (!fsImpl) {
    throw new Error('createFrameRenderer: fsImpl is required');
  }
  if (!pathImpl) {
    throw new Error('createFrameRenderer: pathImpl is required');
  }

  async function captureFrames({
    compositionHtmlPath,
    totalDuration,
    tempDir,
    layout,
    fps
  }) {
    if (!compositionHtmlPath) {
      throw new Error('captureFrames: compositionHtmlPath is required');
    }
    if (typeof totalDuration !== 'number') {
      throw new Error('captureFrames: totalDuration is required');
    }
    if (!tempDir) {
      throw new Error('captureFrames: tempDir is required');
    }
    if (!layout) {
      throw new Error('captureFrames: layout is required');
    }
    if (typeof fps !== 'number') {
      throw new Error('captureFrames: fps is required');
    }

    logStep("Launching Headless Chrome with Puppeteer...");
    const browser = await puppeteerImpl.launch({
      headless: "new",
      defaultViewport: {
        width: 1080,
        height: 1920,
        deviceScaleFactor: 1
      },
      protocolTimeout: 300000, // 5 minutes to permanently prevent CDP timeouts on Windows
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--hide-scrollbars'
      ]
    });
    const page = await browser.newPage();

    const fileUrl = `file:///${compositionHtmlPath.replace(/\\/g, '/')}`;
    logStep(`Loading composition in Puppeteer: ${fileUrl}`);
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    logSuccess("Composition loaded!");

    await applyRuntimeVisualPatchesImpl(page, layout);
    logSuccess("Applied fixed neon rail and clean metric text patches.");

    // Wait for fonts — explicit load hero cursive font trước, sau đó ready
    logStep("Waiting for document fonts to load completely...");
    await page.evaluate((fontName, fontSize) => document.fonts.load(`normal ${fontSize}px "${fontName}"`), layout.subtitle.peakScriptClimaxFont, layout.subtitle.peakScriptClimaxSize);
    await page.evaluate(() => document.fonts.ready);
    logSuccess("Fonts successfully loaded!");

    // Verify timeline registration
    const hasTimeline = await page.evaluate(() => {
      return !!(window.__timelines && window.__timelines["elegant-maxwell"]);
    });
    if (!hasTimeline) {
      throw new Error("Could not find registered GSAP timeline 'elegant-maxwell' on window.__timelines!");
    }
    logSuccess("GSAP timeline detected!");

    // Clean and recreate temp frames folder
    if (fsImpl.existsSync(tempDir)) {
      fsImpl.rmSync(tempDir, { recursive: true, force: true });
    }
    fsImpl.mkdirSync(tempDir, { recursive: true });

    const totalFrames = Math.ceil(totalDuration * fps);
    logStep(`Starting transparent PNG frame capture loop at ${fps}fps (${totalFrames} total frames)...`);

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const currentTime = frameIdx / fps;

      // Deterministically seek the composition playhead.
      await page.evaluate((t) => {
        if (typeof window.renderAt === "function") {
          window.renderAt(t);
        } else {
          window.__timelines["elegant-maxwell"].seek(t);
        }
      }, currentTime);

      // Screenshot with alpha-transparency enabled (omitBackground: true)
      const framePath = pathImpl.join(tempDir, `frame_${String(frameIdx).padStart(5, '0')}.png`);
      await page.screenshot({
        path: framePath,
        omitBackground: true,
        type: 'png'
      });

      if (frameIdx % 100 === 0 || frameIdx === totalFrames - 1) {
        const percent = ((frameIdx + 1) / totalFrames * 100).toFixed(1);
        consoleLogImpl(`   [Puppeteer] Captured frame ${frameIdx + 1}/${totalFrames} (${percent}%) | Timestamp: ${currentTime.toFixed(2)}s`);
      }
    }

    await browser.close();
    logSuccess("Custom Puppeteer capture loop completed! Staged all transparent PNGs.");
  }

  return {
    captureFrames
  };
}
