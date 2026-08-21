/**
 * src/pipeline/compositionStyles.js
 * Generates the complete, deterministic CSS stylesheet for the HTML composition.
 */
import fs from 'fs';
import path from 'path';

export function createCompositionStyles(options = {}) {
  const {
    getMetricCSSImpl,
    getPatternCSSImpl,
    readFileSyncImpl = fs.readFileSync,
    resolvePathImpl = path.resolve,
    existsSyncImpl = fs.existsSync
  } = options;

  if (typeof getMetricCSSImpl !== 'function') {
    throw new TypeError('createCompositionStyles requires getMetricCSSImpl function');
  }
  if (typeof getPatternCSSImpl !== 'function') {
    throw new TypeError('createCompositionStyles requires getPatternCSSImpl function');
  }

  return {
    generateStyles(layout) {
      if (!layout) {
        throw new TypeError('generateStyles requires layout parameter');
      }

      // Embed DVN Grandy as base64 — guaranteed load in Puppeteer file:// context
      const _dvnFontPath = resolvePathImpl('assets/fonts/DVN-Grandy-gehcaa.ttf');
      const _dvnFontB64  = existsSyncImpl(_dvnFontPath)
        ? readFileSyncImpl(_dvnFontPath).toString('base64')
        : '';
      const _dvnFontSrc  = _dvnFontB64
        ? `url('data:font/truetype;base64,${_dvnFontB64}') format('truetype')`
        : `url('assets/fonts/DVN-Grandy-gehcaa.ttf') format('truetype')`;

      return `    <!-- DVN Grandy — embedded as base64, guaranteed load in Puppeteer file:// -->
    <style>
      @font-face {
        font-family: '${layout.subtitle.peakScriptClimaxFont}';
        src: ${_dvnFontSrc};
        font-weight: normal;
        font-style: normal;
        font-display: block;
      }
    </style>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.2/dist/gsap.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js"></script>

    <style>
      :root {
        --cnfi-accent:     ${layout.colors.accent};
        --cnfi-accent-rgb: ${layout.colors.accentRgb};
        --cnfi-warning:    ${layout.colors.warning};
        --cnfi-yellow:     ${layout.colors.yellow};
        --cnfi-bg:         ${layout.colors.darkBg};
      }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: transparent;
        font-family: 'Be Vietnam Pro', sans-serif;
        font-weight: 800;
        -webkit-font-smoothing: antialiased;
      }

      #root {
        position: relative;
        width: 1080px;
        height: 1920px;
        background: transparent;
        overflow: hidden;
      }

      .card-container {
        position: absolute;
        inset: 0;
        width: 1080px;
        height: 1920px;
        pointer-events: none;
        z-index: 3;
      }

      .global-neon-rail {
        position: absolute;
        left: 70px;
        top: 980px;
        width: 3px;
        height: 520px;
        background: linear-gradient(
          180deg,
          rgba(166, 255, 61, 0) 0%,
          rgba(166, 255, 61, 0.5) 8%,
          rgba(166, 255, 61, 0.5) 92%,
          rgba(166, 255, 61, 0) 100%
        );
        box-shadow: 0 0 5px rgba(166, 255, 61, 0.35);
        opacity: 1;
        pointer-events: none;
        z-index: 10;
      }

      .semantic-layer {
        position: absolute;
        inset: 0;
        width: 1080px;
        height: 1920px;
        pointer-events: none;
        z-index: 2;
      }

      .semantic-scene {
        position: absolute;
        opacity: 0;
        --sc: #a6ff3d;
        --sc-rgb: 166,255,61;
        color: var(--sc);
        text-transform: uppercase;
        letter-spacing: 0;
        text-shadow: 0 0 16px rgba(166, 255, 61, 0.54), 0 8px 22px rgba(0, 0, 0, 0.75);
        will-change: opacity, transform;
      }

      .vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%);
        pointer-events: none;
        z-index: 1;
      }

      .hook-dim {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.62);
        opacity: 0;
        pointer-events: none;
        z-index: 4;
      }

      .opening-hook {
        position: absolute;
        left: 40px;
        top: 820px;
        width: 1000px;
        opacity: 0;
        pointer-events: none;
        z-index: 6;
        text-transform: uppercase;
        letter-spacing: 0;
        text-align: center;
        text-shadow: 0 12px 28px rgba(0, 0, 0, 0.9), 0 0 22px rgba(166, 255, 61, 0.26);
      }

      .hook-kicker {
        display: inline-block;
        margin-bottom: 18px;
        padding: 7px 16px;
        border: 2px solid rgba(166, 255, 61, 0.7);
        background: rgba(0, 0, 0, 0.68);
        color: #a6ff3d;
        border-radius: 8px;
        font-size: 22px;
        font-weight: 900;
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.28);
        white-space: nowrap;
      }

      .hook-title {
        color: #ffffff;
        font-size: 44px;
        font-weight: 900;
        line-height: 1.38;
        max-width: 1000px;
        margin: 0 auto 18px;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: break-word;
        text-shadow:
          0 10px 24px rgba(0, 0, 0, 0.92),
          0 0 16px rgba(255, 255, 255, 0.25),
          0 0 26px rgba(166, 255, 61, 0.18);
      }

      .hook-punch {
        max-width: 860px;
        margin: 0 auto;
        color: #a6ff3d;
        font-size: 30px;
        font-weight: 900;
        line-height: 1.45;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: break-word;
      }

      .scene-timeline {
        left: 112px;
        top: 1238px;
        width: 590px;
        height: 150px;
      }

      .scene-timeline.variant-1 {
        top: 1240px;
        left: 112px;
      }

      .scene-timeline.variant-2 {
        top: 1240px;
        left: 112px;
      }

      .scene-rail {
        position: absolute;
        left: 0;
        top: 18px;
        width: 450px;
        height: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        overflow: visible;
      }

      .scene-rail-fill {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background: #a6ff3d;
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.78);
      }

      .scene-rail-node {
        position: absolute;
        top: -8px;
        left: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 28px rgba(166, 255, 61, 0.9);
      }

      .scene-footsteps {
        position: absolute;
        left: 28px;
        top: 46px;
        width: 430px;
        height: 70px;
      }

      .scene-foot,
      .pace-foot {
        position: absolute;
        width: 26px;
        height: 15px;
        border: 3px solid rgba(166, 255, 61, 0.85);
        border-radius: 50%;
        transform: rotate(-12deg);
        box-shadow: 0 0 15px rgba(166, 255, 61, 0.5);
      }

      .foot-1,
      .foot-3,
      .foot-5,
      .foot-7 {
        top: 0;
        transform: rotate(-16deg);
      }

      .foot-2,
      .foot-4,
      .foot-6,
      .foot-8 {
        top: 28px;
        transform: rotate(16deg);
      }

      .foot-1 { left: 0; }
      .foot-2 { left: 42px; }
      .foot-3 { left: 92px; }
      .foot-4 { left: 134px; }
      .foot-5 { left: 184px; }
      .foot-6 { left: 226px; }
      .foot-7 { left: 276px; }
      .foot-8 { left: 318px; }

      .semantic-minimum_time .scene-rail {
        width: 315px;
      }

      .semantic-minimum_time .foot-5,
      .semantic-minimum_time .foot-6,
      .semantic-minimum_time .foot-7,
      .semantic-minimum_time .foot-8 {
        display: none;
      }

      .semantic-optimal_time .scene-rail {
        width: 525px;
      }

      .scene-transport {
        left: 112px;
        top: 1118px;
        width: 500px;
        height: 118px;
      }

      .scene-cell {
        position: absolute;
        right: 0;
        top: 2px;
        width: 118px;
        height: 82px;
      }

      .cell-core {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 3px solid rgba(166, 255, 61, 0.46);
        background: radial-gradient(circle, rgba(166, 255, 61, 0.18), rgba(166, 255, 61, 0.02) 62%, rgba(0, 0, 0, 0));
        box-shadow: 0 0 44px rgba(166, 255, 61, 0.34);
      }

      .cell-label {
        position: absolute;
        left: 54px;
        top: 76px;
        font-size: 24px;
        font-weight: 900;
      }

      .transport-stream {
        position: absolute;
        left: 18px;
        top: 38px;
        width: 310px;
        height: 28px;
      }

      .sugar-dot {
        position: absolute;
        left: 0;
        top: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.86);
      }

      .glut4-gate {
        position: absolute;
        left: 326px;
        top: 28px;
        width: 22px;
        height: 42px;
        padding: 0;
        border-radius: 10px;
        border: 2px solid rgba(166, 255, 61, 0.64);
        background: rgba(0, 0, 0, 0.56);
        font-size: 0;
      }

      .scene-carb {
        left: 112px;
        top: 1118px;
        width: 470px;
        height: 116px;
      }

      .carb-source,
      .carb-target {
        position: absolute;
        top: 22px;
        width: 70px;
        height: 46px;
        padding: 0;
        border-radius: 18px;
        border: 2px solid rgba(166, 255, 61, 0.56);
        background: rgba(0, 0, 0, 0.48);
      }

      .carb-source {
        left: 0;
      }

      .carb-target {
        right: 0;
      }

      .carb-flow {
        position: absolute;
        left: 118px;
        top: 42px;
        width: 220px;
        display: flex;
        justify-content: space-between;
      }

      .carb-flow span {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.72);
      }

      .scene-gel,
      .scene-satiety {
        left: 112px;
        top: 1118px;
        width: 500px;
        height: 126px;
      }

      .gel-core {
        position: absolute;
        left: 210px;
        top: 18px;
        width: 96px;
        height: 82px;
        border-radius: 46% 54% 50% 50%;
        border: 3px solid rgba(166, 255, 61, 0.64);
        background: radial-gradient(circle at 50% 50%, rgba(166, 255, 61, 0.22), rgba(166, 255, 61, 0.06) 64%, rgba(0, 0, 0, 0.18));
        box-shadow: 0 0 36px rgba(166, 255, 61, 0.42);
      }

      .gel-ring {
        position: absolute;
        left: 196px;
        top: 4px;
        width: 124px;
        height: 108px;
        border-radius: 50%;
        border: 2px solid rgba(166, 255, 61, 0.32);
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.24);
      }

      .gr2 {
        left: 184px;
        top: -8px;
        width: 148px;
        height: 132px;
        opacity: 0.46;
      }

      .water-drop {
        position: absolute;
        left: 20px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.78);
      }

      .wd1 { top: 30px; }
      .wd2 { top: 60px; left: 58px; }
      .wd3 { top: 88px; left: 18px; }

      .gel-slow-line {
        position: absolute;
        left: 18px;
        top: 112px;
        width: 390px;
        height: 5px;
        border-radius: 999px;
        background: rgba(166, 255, 61, 0.13);
      }

      .gel-slow-line span {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(166, 255, 61, 0.92), rgba(166, 255, 61, 0.16));
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.48);
      }

      .satiety-meter {
        position: absolute;
        left: 18px;
        top: 56px;
        width: 330px;
        height: 10px;
        border-radius: 999px;
        background: rgba(166, 255, 61, 0.12);
        overflow: hidden;
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.16);
      }

      .satiety-meter span {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(166, 255, 61, 0.96), rgba(166, 255, 61, 0.38));
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.62);
      }

      .satiety-dot {
        position: absolute;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.76);
      }

      .st1 { left: 54px; top: 88px; }
      .st2 { left: 156px; top: 30px; }
      .st3 { left: 258px; top: 88px; }

      .satiety-check {
        position: absolute;
        left: 390px;
        top: 42px;
        width: 42px;
        height: 22px;
        border-left: 6px solid #a6ff3d;
        border-bottom: 6px solid #a6ff3d;
        transform: rotate(-45deg);
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.62);
      }

      .scene-benefit {
        left: 112px;
        top: 1118px;
        width: 470px;
        height: 118px;
      }

      .benefit-cell {
        position: absolute;
        right: 10px;
        top: 4px;
        width: 96px;
        height: 78px;
        border-radius: 50%;
        border: 3px solid rgba(166, 255, 61, 0.52);
        background: radial-gradient(circle, rgba(166, 255, 61, 0.16), rgba(166, 255, 61, 0.02) 64%, rgba(0, 0, 0, 0));
        box-shadow: 0 0 34px rgba(166, 255, 61, 0.34);
      }

      .benefit-flow {
        position: absolute;
        left: 18px;
        top: 36px;
        width: 290px;
        height: 26px;
      }

      .benefit-dot {
        position: absolute;
        left: 0;
        top: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.82);
      }

      .benefit-check {
        position: absolute;
        right: 44px;
        top: 34px;
        width: 32px;
        height: 17px;
        border-left: 5px solid #a6ff3d;
        border-bottom: 5px solid #a6ff3d;
        transform: rotate(-45deg);
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.6);
      }

      .receptor-track {
        position: absolute;
        left: 24px;
        top: 54px;
        width: 340px;
        height: 5px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(166, 255, 61, 0.92), rgba(166, 255, 61, 0.1));
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.48);
      }

      .receptor-signal {
        position: absolute;
        top: 44px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.82);
      }

      .rs1 { left: 24px; }
      .rs2 { left: 82px; }
      .rs3 { left: 140px; }

      .receptor-gate {
        position: absolute;
        top: 34px;
        width: 26px;
        height: 48px;
        border-radius: 12px;
        border: 3px solid rgba(166, 255, 61, 0.72);
        background: rgba(0, 0, 0, 0.36);
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.46);
      }

      .rg1 { left: 238px; }
      .rg2 { left: 292px; }
      .rg3 { left: 346px; }

      .sensitivity-arc {
        position: absolute;
        left: 42px;
        top: 16px;
        width: 230px;
        height: 96px;
        border-radius: 260px 260px 0 0;
        border: 5px solid rgba(166, 255, 61, 0.52);
        border-bottom: 0;
        box-shadow: 0 0 26px rgba(166, 255, 61, 0.36);
      }

      .sensitivity-needle {
        position: absolute;
        left: 150px;
        top: 42px;
        width: 5px;
        height: 70px;
        border-radius: 999px;
        background: #a6ff3d;
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.64);
      }

      .sensitivity-check {
        position: absolute;
        left: 342px;
        top: 42px;
        width: 38px;
        height: 20px;
        border-left: 5px solid #a6ff3d;
        border-bottom: 5px solid #a6ff3d;
        transform: rotate(-45deg);
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.6);
      }

      .stability-line {
        position: absolute;
        left: 22px;
        top: 52px;
        width: 310px;
        height: 24px;
      }

      .stability-line span {
        display: block;
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: #a6ff3d;
        box-shadow: 0 0 20px rgba(166, 255, 61, 0.68);
      }

      .stability-dot {
        position: absolute;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #a6ff3d;
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.72);
      }

      .sd1 { left: 70px; top: 28px; }
      .sd2 { left: 164px; top: 72px; }
      .sd3 { left: 258px; top: 30px; }

      .scene-zone {
        left: 112px;
        top: 1228px;
        width: 540px;
        height: 160px;
      }

      .zone-arc {
        position: absolute;
        left: 80px;
        top: 12px;
        width: 300px;
        height: 130px;
        border-radius: 320px 320px 0 0;
        border: 5px solid rgba(166, 255, 61, 0.45);
        border-bottom: 0;
        box-shadow: 0 0 28px rgba(166, 255, 61, 0.36);
      }

      .zone-pulse {
        position: absolute;
        left: 198px;
        top: 58px;
        width: 72px;
        height: 72px;
        border-radius: 50%;
        background: rgba(166, 255, 61, 0.24);
        box-shadow: 0 0 32px rgba(166, 255, 61, 0.68);
      }

      .zone-label {
        position: absolute;
        top: 128px;
        font-size: 24px;
        font-weight: 900;
        opacity: 0.62;
      }

      .z1 { left: 70px; }
      .z2 { left: 218px; color: #a6ff3d; opacity: 1; }
      .z3 { left: 362px; }

      .scene-movement {
        left: 112px;
        top: 1240px;
        width: 560px;
        height: 130px;
      }

      .pace-line {
        position: absolute;
        left: 0;
        top: 44px;
        width: 430px;
        height: 5px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(166, 255, 61, 0.9), rgba(166, 255, 61, 0));
        box-shadow: 0 0 18px rgba(166, 255, 61, 0.48);
      }

      .pace-foot {
        position: absolute;
        top: 72px;
      }

      .p1 { left: 40px; }
      .p2 { left: 138px; top: 94px; }
      .p3 { left: 236px; }
      .p4 { left: 334px; top: 94px; }

      .scene-warning {
        left: 112px;
        top: 1118px;
        width: 500px;
        height: 122px;
        color: #ff4b4b;
        text-shadow: 0 0 16px rgba(255, 75, 75, 0.56);
      }

      .warning-stomach {
        position: absolute;
        left: 0;
        top: 12px;
        width: 98px;
        height: 70px;
        border: 4px solid rgba(255, 75, 75, 0.72);
        border-radius: 42% 58% 50% 50%;
        box-shadow: 0 0 26px rgba(255, 75, 75, 0.42);
      }

      .warning-muscle {
        position: absolute;
        left: 354px;
        top: 24px;
        width: 118px;
        height: 58px;
        border-radius: 999px;
        border: 4px solid rgba(255, 75, 75, 0.72);
        box-shadow: 0 0 26px rgba(255, 75, 75, 0.42);
      }

      .blood-flow {
        position: absolute;
        left: 116px;
        top: 48px;
        width: 270px;
        height: 24px;
      }

      .blood-dot {
        position: absolute;
        left: 0;
        top: 0;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ff4b4b;
        box-shadow: 0 0 24px rgba(255, 75, 75, 0.8);
      }

      .warning-ring {
        position: absolute;
        right: 48px;
        top: 10px;
        width: 84px;
        height: 84px;
        border-radius: 50%;
        border: 4px solid rgba(255, 75, 75, 0.66);
        box-shadow: 0 0 36px rgba(255, 75, 75, 0.52);
      }

      .scene-metric {
        left: 112px;
        top: 1240px;
        width: 520px;
        height: 140px;
      }

      .metric-halo {
        position: absolute;
        left: 16px;
        top: 0;
        width: 118px;
        height: 118px;
        border-radius: 50%;
        border: 3px solid rgba(166, 255, 61, 0.46);
        box-shadow: 0 0 44px rgba(166, 255, 61, 0.42);
      }

      .metric-scan {
        position: absolute;
        left: 0;
        top: 42px;
        width: 390px;
        height: 3px;
        background: rgba(166, 255, 61, 0.86);
        box-shadow: 0 0 22px rgba(166, 255, 61, 0.74);
      }

      /* ═══════════════════════════════════════════════════════════
         CARD BASE — Ghost / Transparent Overlay
         → Video visible through card (35-40% dim only)
         → Thin outline border — card "floats" on footage
         → No lottie icon cell — single column text layout
      ═══════════════════════════════════════════════════════════ */
      .card {
        position: absolute;
        top: ${layout.card.defaultTop}px;
        left: ${layout.card.infoLeft}px;
        width: ${layout.card.width}px;
        /* Ghost panel — video shows through, enough opacity for definition */
        background: rgba(0, 0, 0, 0.60);
        border-radius: 18px;
        border: 1.5px solid rgba(255,255,255,0.30);
        box-shadow:
          0 8px 40px rgba(0,0,0,0.55),
          inset 0 1px 0 rgba(255,255,255,0.10);
        display: flex;
        flex-direction: column;
        justify-content: center;
        opacity: 0;
        overflow: hidden;
        z-index: 3;
      }

      /* Top accent line — CNFI green brand identity, visible at video resolution */
      .card::before {
        content: "";
        position: absolute;
        left: 0; right: 0; top: 0;
        height: 3px;
        background: linear-gradient(
          to right,
          transparent 0%,
          rgba(166,255,61,0.7) 15%,
          rgba(166,255,61,1.0) 50%,
          rgba(166,255,61,0.7) 85%,
          transparent 100%
        );
        z-index: 4;
        border-radius: 18px 18px 0 0;
      }
      .card.card-warning::before {
        background: linear-gradient(
          to right,
          transparent 0%,
          rgba(255,68,68,0.7) 15%,
          rgba(255,68,68,1.0) 50%,
          rgba(255,68,68,0.7) 85%,
          transparent 100%
        );
      }
      /* Warning card: red tint border */
      .card.card-warning {
        border-color: rgba(255, 68, 68, 0.38);
        box-shadow:
          0 4px 32px rgba(0,0,0,0.38),
          0 0 24px rgba(255,68,68,0.08),
          inset 0 1px 0 rgba(255,255,255,0.06);
      }

      /* Action card: CNFI lime top line + border */
      .card.card-action::before {
        background: linear-gradient(
          to right,
          transparent 0%,
          rgba(154,195,59,0.7) 15%,
          rgba(154,195,59,1.0) 50%,
          rgba(154,195,59,0.7) 85%,
          transparent 100%
        );
      }
      .card.card-action {
        border-color: rgba(154, 195, 59, 0.35);
        box-shadow:
          0 4px 32px rgba(0,0,0,0.38),
          0 0 24px rgba(154,195,59,0.08),
          inset 0 1px 0 rgba(255,255,255,0.06);
      }

      /* ── INFO CARD — single column, ghost transparent, shrink to content ── */
      .card-info {
        height: auto;
        width: fit-content;      /* flex to content — no wasted empty space */
        min-width: 300px;        /* never collapse below 300px */
        max-width: ${layout.card.width}px;  /* cap at LAYOUT max */
        padding: 26px 32px 28px 32px;
        overflow: visible;       /* allow card-icon-float to extend outside card bounds */
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
      }
      /* Text area — full width of flexible card */
      .card-text {
        flex: 1;
        min-width: 0;
        width: 100%;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* Animation cell — legacy, not used */
      .card-lottie { display: none; }

      /* ── LOTTIE FLOAT ICON — TYB style: badge tại góc trên-phải của card ──
         Nằm TRONG card (inside), tràn ra ngoài nhờ card-info overflow:visible
         CSS right/top định vị chính xác — không cần getBoundingClientRect() */
      .card-icon-float {
        position: absolute;
        right:  -${Math.round(layout.card.lottieIconSize * 0.5)}px;
        top:    -${Math.round(layout.card.lottieIconSize * 0.5)}px;
        width:  ${layout.card.lottieIconSize}px;
        height: ${layout.card.lottieIconSize}px;
        overflow: visible;
        opacity: 0;
        z-index: 10;
        pointer-events: none;
        /* filter baked server-side vào inline style — brightness rule + glow
           getLottieIconFilter() tính 1 lần dựa trên avg luminance của fills */
      }
      /* card-has-icon: padding-right để title/body không bị icon đè */
      .card.card-has-icon .card-text {
        padding-right: 90px;
      }

      /* LIST cards */
      .card-list-progressive,
      .card-list-check {
        height: auto;
        min-height: ${layout.card.height}px;
        overflow: hidden;
      }
      .card-list-slam {
        height: auto;
        overflow: visible;
      }

      /* Divider — spacing only, không dùng line cứng */
      .card-divider {
        width: 100%;
        height: 0;
        margin: 8px 0;
      }
      .card-divider-fill { display: none; }

      .card-stat {
        position: absolute;
        top: ${layout.card.statTop}px;
        left: ${layout.card.statLeft}px;
        width: ${layout.card.statWidth}px;
        min-height: ${layout.card.statMinHeight}px;
        border-radius: 0;
        background: linear-gradient(
          90deg,
          rgba(0, 0, 0, 0.88) 0%,
          rgba(0, 0, 0, 0.82) 55%,
          rgba(0, 0, 0, 0) 100%
        );
        padding: 30px 46px 28px 20px;
        display: flex;
        align-items: stretch;
        opacity: 0;
        overflow: visible;
        z-index: 3;
      }

      .card-stat::before {
        content: "";
        position: absolute;
        inset: 0;
        background: radial-gradient(
          ellipse at 8% 50%,
          rgba(166, 255, 61, 0.07) 0%,
          rgba(166, 255, 61, 0) 60%
        );
        pointer-events: none;
      }

      .stat-neon-bar {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: rgba(166,255,61,0.55);
        border-radius: 0;
        z-index: 4;
      }

      .stat-content {
        position: relative;
        z-index: 3;
        display: flex;
        flex-direction: column;
        justify-content: center;
        width: 100%;
      }

      .stat-value {
        display: block;
        height: auto;
        max-width: 810px;
        color: #ffffff;
        font-size: 106px;
        font-weight: 900;
        line-height: 1;
        letter-spacing: 0;
        font-variant-numeric: tabular-nums;
        text-shadow: 0 9px 24px rgba(0, 0, 0, 0.92), 0 0 22px rgba(255, 255, 255, 0.12);
        white-space: nowrap;
        overflow: visible;
      }

      .card-stat.stat-medium .stat-value {
        font-size: 88px;
      }

      .card-stat.stat-compact .stat-value {
        font-size: 74px;
      }

      .digit-window {
        display: inline-flex;
        align-items: flex-start;
        width: 0.78em;
        height: 1.1em;
        overflow: hidden;
        vertical-align: bottom;
      }

      .digit-reel {
        display: flex;
        flex-direction: column;
        flex: 0 0 auto;
        height: auto;
        will-change: transform;
      }

      .digit-cell {
        display: block;
        flex: 0 0 1.1em;
        width: 0.78em;
        height: 1.1em;
        line-height: 1.06;
        text-align: center;
      }

      .stat-static {
        display: inline-block;
        height: 1.1em;
        line-height: 1.06;
      }

      .stat-space {
        width: 0.28em;
      }

      .stat-divider {
        width: 320px;
        height: 7px;
        margin-top: 18px;
        margin-bottom: 16px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        overflow: hidden;
      }

      .stat-divider-fill {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background: #a6ff3d;
        box-shadow: 0 0 14px rgba(166, 255, 61, 0.82), 0 0 30px rgba(166, 255, 61, 0.35);
      }

      .stat-label {
        max-width: 790px;
        color: rgba(238, 243, 240, 0.9);
        font-size: 30px;
        font-weight: 800;
        line-height: 1.16;
        letter-spacing: 0;
        text-transform: uppercase;
        white-space: normal;
        overflow-wrap: break-word;
        text-shadow: 0 5px 16px rgba(0, 0, 0, 0.82);
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }

      /* ── BADGE — full pill, semi-transparent glass style ── */
      .badge {
        font-size: 15px;
        font-weight: 800;
        padding: 4px 14px;
        border-radius: 9999px;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        flex-shrink: 0;
      }

      .warning-badge {
        background: rgba(255, 68, 68, 0.18);
        color: #ff7b7b;
        border: 1px solid rgba(255, 68, 68, 0.32);
        box-shadow: 0 0 12px rgba(255,68,68,0.15);
      }

      .success-badge {
        background: rgba(166, 255, 61, 0.14);
        color: #a6ff3d;
        border: 1px solid rgba(166, 255, 61, 0.28);
        box-shadow: 0 0 12px rgba(166,255,61,0.12);
      }

      /* ── TITLE — dominates the card, no question who's boss ── */
      .card-title {
        font-size: ${layout.card.titleFontSize}px;
        font-weight: 900;
        color: rgba(255, 255, 255, 1.0);
        text-transform: uppercase;
        letter-spacing: 1.2px;
        line-height: 1.08;
        text-shadow:
          0 2px 6px rgba(0,0,0,0.95),
          0 4px 18px rgba(0,0,0,0.80);
      }

      /* Warning card: title đỏ — override trắng mặc định */
      .card.card-warning .card-title {
        color: #ff6b6b;
        text-shadow:
          0 2px 6px rgba(0,0,0,0.95),
          0 4px 18px rgba(0,0,0,0.80),
          0 0 22px rgba(255,68,68,0.28);
      }

      /* ── BODY — supporting detail, clearly subordinate to title ── */
      .card-body {
        font-size: ${layout.card.bodyFontSize}px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.78);
        line-height: 1.38;
        letter-spacing: 0.2px;
        text-shadow:
          0 1px 3px rgba(0,0,0,0.9),
          0 2px 10px rgba(0,0,0,0.65);
      }

      /* ── LIST STYLES ────────────────────────────────────────────── */
      .card-list-progressive {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 18px;
        padding: 20px 24px;
      }
      .list-num {
        flex: 0 0 58px;
        height: 58px;
        border-radius: 50%;
        background: #a6ff3d;
        color: #0a0a0a;
        font-size: 28px;
        font-weight: 900;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 18px rgba(166,255,61,0.6);
        flex-shrink: 0;
      }
      .card-warning .list-num {
        background: #ff4b4b;
        box-shadow: 0 0 18px rgba(255,75,75,0.6);
      }
      .list-content { flex: 1; min-width: 0; }
      .list-header {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 6px;
      }
      .list-title {
        font-size: ${layout.card.listTitleFontSize}px;
        font-weight: 900;
        color: #ffffff;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        line-height: 1.25;
      }
      .list-progress {
        font-size: 18px;
        font-weight: 700;
        color: rgba(166,255,61,0.7);
        white-space: nowrap;
      }
      .list-detail {
        font-size: ${layout.card.listDetailFontSize}px;
        font-weight: 700;
        color: rgba(255,255,255,0.82);
        line-height: 1.35;
      }

      /* number slam */
      .card-list-slam {
        text-align: center;
        padding: 22px 28px 18px;
        align-items: center;
      }
      .slam-num {
        font-size: 96px;
        font-weight: 900;
        color: #ffffff;
        line-height: 1;
        letter-spacing: -4px;
        text-shadow: 0 0 30px rgba(166,255,61,0.5), 0 8px 24px rgba(0,0,0,0.9);
      }
      .slam-sup {
        font-size: 36px;
        font-weight: 700;
        color: rgba(166,255,61,0.8);
        vertical-align: super;
        letter-spacing: 0;
      }
      .slam-title {
        font-size: ${layout.card.listTitleFontSize}px;
        font-weight: 900;
        color: #a6ff3d;
        text-transform: uppercase;
        margin-top: 6px;
        letter-spacing: 1px;
      }
      .slam-detail {
        font-size: ${layout.card.listDetailFontSize}px;
        font-weight: 700;
        color: rgba(255,255,255,0.8);
        margin-top: 6px;
        line-height: 1.3;
      }

      /* checklist */
      .card-list-check {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 16px;
        padding: 18px 22px;
      }
      .check-icon {
        flex: 0 0 48px;
        height: 48px;
        border-radius: 10px;
        font-size: 26px;
        font-weight: 900;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .check-yes {
        background: rgba(166,255,61,0.18);
        color: #a6ff3d;
        border: 2px solid rgba(166,255,61,0.6);
        box-shadow: 0 0 12px rgba(166,255,61,0.3);
      }
      .check-no {
        background: rgba(255,75,75,0.18);
        color: #ff4b4b;
        border: 2px solid rgba(255,75,75,0.6);
        box-shadow: 0 0 12px rgba(255,75,75,0.3);
      }

      .subtitle-container {
        position: absolute;
        top: ${layout.subtitle.top}px;
        left: ${layout.subtitle.left}px;
        width: ${layout.subtitle.width}px;
        height: ${layout.subtitle.height}px;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        pointer-events: none;
      }

      /* ── Render-context sentence base — NO border (matches first style block) ── */
      .sentence {
        position: absolute;
        width: auto;
        max-width: 960px;
        display: inline-flex;
        flex-wrap: nowrap;
        justify-content: center;
        align-items: center;
        gap: 0 10px;
        opacity: 0;
        background: rgba(0, 0, 0, 0.72);
        border: none;
        border-radius: 12px;
        padding: 10px 20px;
        left: 50%;
        transform: translateX(-50%);
        overflow: visible;
      }

      .word {
        display: inline-block;
        font-size: ${layout.subtitle.normalFontSize}px;
        font-weight: 800;
        color: rgba(255, 255, 255, 0.5);
        opacity: 1;
        transform: scale(1);
        text-transform: none;   /* chữ thường — TYB style */
        letter-spacing: 0;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
        white-space: nowrap;
        transform-origin: center center;
        will-change: transform, color;
      }

      /* ── Peak subtitle overrides (must come AFTER .sentence redefinition) ──
         Use !important to guarantee these always win over base .sentence cascade */
      .sentence-peak {
        background: none !important; border: none !important; border-radius: 0 !important;
        padding: 2px 0 !important; flex-direction: column !important;
        align-items: flex-start !important; gap: 0 !important;
        flex-wrap: nowrap !important; max-width: ${layout.subtitle.width}px !important;
      }
      .peak-chunk {
        display: flex !important; flex-wrap: nowrap !important;
        justify-content: flex-start !important; align-items: flex-start !important;
        gap: 0 6px !important; line-height: 0.9 !important;
        margin-bottom: 2px !important;
      }
      .peak-chunk-connector .word {
        font-size: ${layout.subtitle.peakConnectorSize}px !important;
        font-weight: 600 !important; color: rgba(255,255,255,0.50) !important;
        text-shadow: 0 2px 8px rgba(0,0,0,0.9) !important; white-space: nowrap !important;
      }
      .peak-chunk-regular .word {
        font-size: ${layout.subtitle.peakRegularSize}px !important;
        font-weight: 700 !important; color: rgba(255,255,255,0.82) !important;
        letter-spacing: -0.2px !important;
        text-shadow: 0 2px 10px rgba(0,0,0,0.95), 0 4px 18px rgba(0,0,0,0.70) !important;
        white-space: nowrap !important;
      }
      .peak-chunk-anchor .word {
        font-size: ${layout.subtitle.peakAnchorSize}px !important;
        font-weight: 900 !important; color: rgba(255,255,255,1.0) !important;
        letter-spacing: -0.5px !important;
        text-shadow:
          0 2px 18px rgba(0,0,0,1.0),
          0 5px 32px rgba(0,0,0,0.90),
          0 0 48px rgba(255,255,255,0.18) !important;
        white-space: nowrap !important;
      }
      .peak-chunk-script .word {
        font-family: '${layout.subtitle.peakScriptClimaxFont}', cursive !important;
        font-size: ${layout.subtitle.peakScriptSize}px !important;
        font-weight: normal !important; font-style: normal !important;
        color: rgba(154,195,59,0.82) !important; letter-spacing: 0.02em !important;
        text-shadow: 0 2px 12px rgba(0,0,0,0.95), 0 0 20px rgba(154,195,59,0.25) !important;
        white-space: nowrap !important;
      }
      .peak-chunk-script-climax .word, .peak-chunk-script-climax .word-peak-key {
        font-family: '${layout.subtitle.peakScriptClimaxFont}', cursive !important;
        font-size: ${layout.subtitle.peakScriptClimaxSize}px !important;
        font-weight: normal !important; font-style: normal !important;
        color: #C4F040 !important; letter-spacing: 0.04em !important;
        margin-right: 0.15em !important;
        line-height: ${layout.subtitle.peakScriptClimaxLineHeight} !important;
        -webkit-text-stroke: 1.5px #C4F040 !important;
        text-shadow: 0 0 20px rgba(196,240,64,0.90), 0 0 40px rgba(196,240,64,0.55), 0 3px 14px rgba(0,0,0,0.98) !important;
        white-space: nowrap !important;
      }

      ${getPatternCSSImpl()}
      ${getMetricCSSImpl()}

      /* .visual-row và .lottie-cell đã được xoá — animation nằm trong .card-lottie */

      /* ── GAP IMAGE OVERLAY ───────────────────────────────── */
      .gap-img-wrap {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        z-index: 4;
      }
      .gap-img-bg { display: none; }
      .gap-img-wrap img {
        position: relative;
        max-width: 68%;
        max-height: 52%;
        object-fit: contain;
        border-radius: 20px;
        border: 2px solid rgba(166, 255, 61, 0.5);
        box-shadow: 0 0 60px rgba(166, 255, 61, 0.22), 0 0 120px rgba(0,0,0,0.8);
        background: rgba(20, 30, 20, 0.85);
        mix-blend-mode: normal !important;
        filter: none !important;
        padding: 20px;
        box-sizing: border-box;
      }
    </style>`;
    }
  };
}
