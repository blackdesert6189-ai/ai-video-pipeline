/**
 * visualPatternRenderer.js — CNFI Semantic Visual Pattern Renderer
 *
 * Universal animation primitives, topic-agnostic and parameterized.
 * Archetype alone drives which pattern renders — no topic keywords needed.
 *
 * Active primitives:
 *   FLOW, FILL, PULSE, PROGRESS, ALERT,
 *   WAVE, GAUGE, STACK, NETWORK, CLOCK_ARC,
 *   STEPS, BARRIER, SCALE, ARROW, STREAM, PULSE_SPIKE
 *
 * Planned: COMPARE
 */

// ─────────────────────────────────────────────────────────────────
// RESULT CONTRACT
// ─────────────────────────────────────────────────────────────────
function emptyResult() {
  return { html: "", gsapCode: "" };
}

// ─────────────────────────────────────────────────────────────────
// COLOR HELPERS
// ─────────────────────────────────────────────────────────────────
function toHex(c) {
  if (!c || typeof c !== 'string') return '#a6ff3d';
  if (c.startsWith('#')) return c;
  return { accent: '#a6ff3d', warning: '#ff4b4b' }[c] || '#a6ff3d';
}

function hexToRGB(c) {
  const h = toHex(c);
  return `${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)}`;
}

// ─────────────────────────────────────────────────────────────────
// FLOW — particles travel from source blob to target blob
// flowing_in (LTR) / flowing_out (RTL)
// Params: particleCount 2-6, hasGate bool, direction LTR|RTL, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderFlow(params = {}, sceneId, startTime, endTime) {
  const {
    particleCount = 3,
    hasGate       = false,
    direction     = "LTR",
    subjectColor  = "#a6ff3d"
  } = params;
  const isRTL = direction === "RTL";
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const pc    = Math.max(2, Math.min(6, Math.round(particleCount)));

  const dots = Array.from({ length: pc }, (_, i) =>
    `<span class="flow-dot fd${i + 1}"></span>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-flow" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="flow-source"></div>
      <div class="flow-track">${dots}</div>
      <div class="flow-target"></div>
      ${hasGate ? '<div class="flow-gate"></div>' : ""}
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .flow-source", { scale: 0.84, opacity: 0.32 }, { scale: 1.06, opacity: 0.82, duration: 0.74, yoyo: true, repeat: 1, ease: "sine.inOut" }, ${(isRTL ? start + 0.52 : start + 0.14).toFixed(3)});
      fromToIfPresent("#${sceneId} .flow-dot", { x: ${isRTL ? 220 : -72}, opacity: 0.14, scale: 0.68 }, { x: ${isRTL ? -72 : 220}, opacity: 1, scale: 1, stagger: ${isRTL ? -0.12 : 0.12}, duration: 0.92, ease: "power2.inOut" }, ${(start + 0.20).toFixed(3)});
      fromToIfPresent("#${sceneId} .flow-target", { scale: 0.84, opacity: 0.28 }, { scale: 1.09, opacity: 0.82, duration: 0.58, ease: "back.out(1.7)" }, ${(isRTL ? start + 0.14 : start + 0.52).toFixed(3)});
      ${hasGate ? `fromToIfPresent("#${sceneId} .flow-gate", { scaleY: 0.42, opacity: 0.28 }, { scaleY: 1.06, opacity: 1, duration: 0.44, ease: "back.out(1.7)" }, ${(start + 0.48).toFixed(3)});` : ""}`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// FILL — container fills progressively toward a target level
// filling_up (high magnitude) / filling_down (low magnitude)
// Params: magnitude 0-1, hasConfirm bool, particleCount 0-5, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderFill(params = {}, sceneId, startTime, endTime) {
  const {
    magnitude     = 0.85,
    hasConfirm    = true,
    particleCount = 3,
    subjectColor  = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const pc    = Math.max(0, Math.min(5, Math.round(particleCount)));
  const mag   = Math.max(0.2, Math.min(1, magnitude));

  const dots = Array.from({ length: pc }, (_, i) =>
    `<span class="fill-dot fl${i + 1}"></span>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-fill" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="fill-bar"><span class="fill-bar-inner"></span></div>
      ${dots}
      ${hasConfirm ? '<div class="fill-confirm"></div>' : ""}
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .fill-bar-inner", { scaleX: 0, transformOrigin: "left center" }, { scaleX: ${mag.toFixed(2)}, duration: 0.94, ease: "power2.out" }, ${(start + 0.16).toFixed(3)});
      fromToIfPresent("#${sceneId} .fill-dot", { y: 24, opacity: 0.14, scale: 0.7 }, { y: 0, opacity: 1, scale: 1, stagger: 0.13, duration: 0.52, ease: "back.out(1.6)" }, ${(start + 0.28).toFixed(3)});
      ${hasConfirm ? `fromToIfPresent("#${sceneId} .fill-confirm", { scale: 0.66, opacity: 0.14 }, { scale: 1.08, opacity: 0.88, duration: 0.46, ease: "back.out(1.8)" }, ${(start + 0.68).toFixed(3)});` : ""}`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// PULSE — core element expands/contracts rhythmically with rings
// pulsing — biologically active processes
// Params: repeatCount 1-4, hasConfirm bool, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderPulse(params = {}, sceneId, startTime, endTime) {
  const {
    repeatCount  = 2,
    hasConfirm   = false,
    subjectColor = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const rep   = Math.max(1, Math.min(4, Math.round(repeatCount)));

  const html = `
    <div class="semantic-scene scene-pulse" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="pulse-core"></div>
      <span class="pulse-ring pr1"></span>
      <span class="pulse-ring pr2"></span>
      ${hasConfirm ? '<div class="pulse-confirm"></div>' : ""}
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .pulse-core", { scale: 0.82, opacity: 0.26 }, { scale: 1.16, opacity: 0.86, duration: 0.78, yoyo: true, repeat: ${rep}, ease: "sine.inOut" }, ${(start + 0.14).toFixed(3)});
      fromToIfPresent("#${sceneId} .pulse-ring", { scale: 0.66, opacity: 0.1 }, { scale: 1.26, opacity: 0.46, stagger: 0.18, duration: 0.82, ease: "sine.out" }, ${(start + 0.26).toFixed(3)});
      ${hasConfirm ? `fromToIfPresent("#${sceneId} .pulse-confirm", { scale: 0.66, opacity: 0.14 }, { scale: 1.08, opacity: 0.88, duration: 0.46, ease: "back.out(1.8)" }, ${(start + 0.70).toFixed(3)});` : ""}`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// PROGRESS — rail with sliding marker and optional step nodes
// progressing — timed or sequential activities
// Params: steps 2-8, variant "range"|"minimum_time"|"optimal_time", subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderProgress(params = {}, sceneId, startTime, endTime) {
  const {
    steps        = 6,
    variant      = "range",
    subjectColor = "#a6ff3d"
  } = params;
  const start  = Number(startTime) || 0;
  const end    = Number(endTime)   || start + 3.5;
  const outro  = Math.max(start + 0.7, end - 0.42);
  const sc     = Math.max(2, Math.min(8, Math.round(steps)));
  const fillX  = variant === "minimum_time" ? 0.46 : variant === "optimal_time" ? 0.82 : 0.64;
  const markerX = Math.round(fillX * 320);

  const nodes = Array.from({ length: sc }, (_, i) =>
    `<span class="prog-node pn${i + 1}"></span>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-progress" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="prog-rail"><span class="prog-fill"></span></div>
      ${nodes}
      <div class="prog-marker"></div>
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .prog-fill", { scaleX: 0, transformOrigin: "left center" }, { scaleX: ${fillX.toFixed(2)}, duration: 1.2, ease: "power2.out" }, ${(start + 0.16).toFixed(3)});
      fromToIfPresent("#${sceneId} .prog-marker", { x: 0 }, { x: ${markerX}, duration: 1.2, ease: "power2.out" }, ${(start + 0.16).toFixed(3)});
      fromToIfPresent("#${sceneId} .prog-node", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, stagger: 0.11, duration: 0.34, ease: "back.out(1.8)" }, ${(start + 0.24).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// ALERT — warning ring pulses outward with orbiting dots
// Params: dotCount 2-4, ringCount 1-2, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderAlert(params = {}, sceneId, startTime, endTime) {
  const {
    dotCount     = 3,
    ringCount    = 2,
    subjectColor = "#ff4b4b"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const dc    = Math.max(2, Math.min(4, Math.round(dotCount)));

  const dots  = Array.from({ length: dc }, (_, i) =>
    `<span class="alert-dot ad${i + 1}"></span>`
  ).join("\n        ");
  const rings = Array.from({ length: Math.min(2, ringCount) }, (_, i) =>
    `<div class="alert-ring ar${i + 1}"></div>`
  ).join("\n      ");

  const html = `
    <div class="semantic-scene scene-alert" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      ${rings}
      <div class="alert-core"></div>
      ${dots}
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .alert-core", { scale: 0.78, opacity: 0.3 }, { scale: 1.08, opacity: 0.9, duration: 0.62, yoyo: true, repeat: 2, ease: "sine.inOut" }, ${(start + 0.14).toFixed(3)});
      fromToIfPresent("#${sceneId} .alert-ring", { scale: 0.72, opacity: 0.22 }, { scale: 1.32, opacity: 0, stagger: 0.24, duration: 0.72, ease: "sine.out" }, ${(start + 0.18).toFixed(3)});
      fromToIfPresent("#${sceneId} .alert-dot", { x: 0, y: 0, opacity: 0.18 }, { x: 110, opacity: 1, stagger: 0.12, duration: 0.82, ease: "power2.inOut" }, ${(start + 0.22).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// WAVE — vertical bars animate as a sine wave
// waving — rhythmic/oscillating/repeating processes
// Params: barCount 5-9, amplitude 0-1, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderWave(params = {}, sceneId, startTime, endTime) {
  const {
    barCount     = 7,
    amplitude    = 0.8,
    subjectColor = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const bc    = Math.max(5, Math.min(9, Math.round(barCount)));

  const bars = Array.from({ length: bc }, (_, i) =>
    `<span class="wave-bar wb${i + 1}"></span>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-wave" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="wave-baseline"></div>
      <div class="wave-bars">${bars}</div>
    </div>`;

  const delays = Array.from({ length: bc }, (_, i) => (start + 0.14 + i * 0.06).toFixed(3));
  const heights = [0.38, 0.62, 0.86, 1.0, 0.86, 0.62, 0.38, 0.52, 0.72];
  const amp = Math.max(0.3, Math.min(1, amplitude));

  const barAnims = Array.from({ length: bc }, (_, i) => {
    const h = Math.round((heights[i % heights.length] * amp) * 52);
    return `fromToIfPresent("#${sceneId} .wb${i + 1}", { scaleY: 0.12, opacity: 0.2 }, { scaleY: 1, opacity: 0.92, transformOrigin: "bottom center", duration: 0.52, yoyo: true, repeat: 2, ease: "sine.inOut" }, ${delays[i]});`;
  }).join("\n      ");

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      ${barAnims}`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// GAUGE — arc gauge fills to a target level with a needle
// gauging — metrics reaching a value, intensity, performance
// Params: level 0-1, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderGauge(params = {}, sceneId, startTime, endTime) {
  const {
    level        = 0.72,
    subjectColor = "#a6ff3d"
  } = params;
  const start   = Number(startTime) || 0;
  const end     = Number(endTime)   || start + 3.5;
  const outro   = Math.max(start + 0.7, end - 0.42);
  const lv      = Math.max(0.1, Math.min(1, level));
  const needleR = Math.round(-90 + lv * 180);

  const html = `
    <div class="semantic-scene scene-gauge" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="gauge-track"></div>
      <div class="gauge-fill"></div>
      <div class="gauge-needle"></div>
      <div class="gauge-center"></div>
      <div class="gauge-glow"></div>
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .gauge-fill", { rotation: -90, transformOrigin: "bottom center" }, { rotation: ${needleR - 90}, duration: 1.1, ease: "power3.out" }, ${(start + 0.18).toFixed(3)});
      fromToIfPresent("#${sceneId} .gauge-needle", { rotation: -90, transformOrigin: "bottom center", opacity: 0.4 }, { rotation: ${needleR}, opacity: 1, duration: 1.1, ease: "power3.out" }, ${(start + 0.18).toFixed(3)});
      fromToIfPresent("#${sceneId} .gauge-center", { scale: 0.6, opacity: 0.2 }, { scale: 1, opacity: 1, duration: 0.46, ease: "back.out(1.8)" }, ${(start + 0.14).toFixed(3)});
      fromToIfPresent("#${sceneId} .gauge-glow", { opacity: 0, scale: 0.8 }, { opacity: 0.6, scale: 1.1, duration: 0.82, yoyo: true, repeat: 1, ease: "sine.inOut" }, ${(start + 0.52).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// STACK — rows build up sequentially from top
// stacking — lists, accumulation, layered concepts
// Params: rowCount 2-5, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderStack(params = {}, sceneId, startTime, endTime) {
  const {
    rowCount     = 3,
    subjectColor = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const rc    = Math.max(2, Math.min(5, Math.round(rowCount)));

  const rows = Array.from({ length: rc }, (_, i) =>
    `<div class="stack-row sr${i + 1}"><span class="stack-fill"></span></div>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-stack" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      ${rows}
      <div class="stack-confirm"></div>
    </div>`;

  const rowAnims = Array.from({ length: rc }, (_, i) => {
    const t = (start + 0.16 + i * 0.22).toFixed(3);
    return `fromToIfPresent("#${sceneId} .sr${i + 1}", { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.38, ease: "power3.out" }, ${t});
      fromToIfPresent("#${sceneId} .sr${i + 1} .stack-fill", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.52, ease: "power2.out" }, ${t});`;
  }).join("\n      ");

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      ${rowAnims}
      fromToIfPresent("#${sceneId} .stack-confirm", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 0.9, duration: 0.4, ease: "back.out(1.8)" }, ${(start + 0.16 + rc * 0.22).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// NETWORK — nodes appear then connect with lines
// networking — relationships, systems, interconnected concepts
// Params: nodeCount 3-5, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderNetwork(params = {}, sceneId, startTime, endTime) {
  const {
    nodeCount    = 4,
    subjectColor = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const nc    = Math.max(3, Math.min(5, Math.round(nodeCount)));

  const nodes = Array.from({ length: nc }, (_, i) =>
    `<div class="net-node nn${i + 1}"></div>`
  ).join("\n        ");
  const lines = Array.from({ length: nc - 1 }, (_, i) =>
    `<div class="net-line nl${i + 1}"></div>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-network" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      ${lines}
      ${nodes}
    </div>`;

  const nodeAnims = Array.from({ length: nc }, (_, i) => {
    const t = (start + 0.14 + i * 0.14).toFixed(3);
    return `fromToIfPresent("#${sceneId} .nn${i + 1}", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.36, ease: "back.out(2.0)" }, ${t});`;
  }).join("\n      ");
  const lineAnims = Array.from({ length: nc - 1 }, (_, i) => {
    const t = (start + 0.28 + i * 0.14).toFixed(3);
    return `fromToIfPresent("#${sceneId} .nl${i + 1}", { scaleX: 0, transformOrigin: "left center", opacity: 0 }, { scaleX: 1, opacity: 0.72, duration: 0.34, ease: "power2.out" }, ${t});`;
  }).join("\n      ");

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      ${nodeAnims}
      ${lineAnims}`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// CLOCK_ARC — hand sweeps around a ring to mark elapsed time
// clocking — durations, countdowns, time windows
// Params: sweepFraction 0-1 (how far the hand travels), subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderClockArc(params = {}, sceneId, startTime, endTime) {
  const {
    sweepFraction = 0.75,
    subjectColor  = "#a6ff3d"
  } = params;
  const start      = Number(startTime) || 0;
  const end        = Number(endTime)   || start + 3.5;
  const outro      = Math.max(start + 0.7, end - 0.42);
  const sweepDeg   = Math.round(Math.max(0.1, Math.min(1, sweepFraction)) * 360);

  const html = `
    <div class="semantic-scene scene-clock" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="clock-ring"></div>
      <div class="clock-orbit">
        <span class="clock-marker"></span>
      </div>
      <div class="clock-center"></div>
      <span class="clock-tick ct1"></span>
      <span class="clock-tick ct2"></span>
      <span class="clock-tick ct3"></span>
      <span class="clock-tick ct4"></span>
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .clock-ring", { scale: 0.78, opacity: 0.2 }, { scale: 1, opacity: 0.72, duration: 0.46, ease: "back.out(1.6)" }, ${(start + 0.12).toFixed(3)});
      fromToIfPresent("#${sceneId} .clock-orbit", { rotation: -90, transformOrigin: "50% 50%" }, { rotation: ${sweepDeg - 90}, transformOrigin: "50% 50%", duration: 1.4, ease: "power2.inOut" }, ${(start + 0.22).toFixed(3)});
      fromToIfPresent("#${sceneId} .clock-center", { scale: 0.5, opacity: 0.3 }, { scale: 1, opacity: 1, duration: 0.38, ease: "back.out(1.8)" }, ${(start + 0.14).toFixed(3)});
      fromToIfPresent("#${sceneId} .clock-tick", { scale: 0, opacity: 0 }, { scale: 1, opacity: 0.64, stagger: 0.12, duration: 0.28, ease: "back.out(1.6)" }, ${(start + 0.18).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// STEPS — numbered nodes appear in sequence with connecting links
// stepping — numbered processes, sequential instructions
// Params: stepCount 2-5, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderSteps(params = {}, sceneId, startTime, endTime) {
  const {
    stepCount    = 3,
    subjectColor = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const sc    = Math.max(2, Math.min(5, Math.round(stepCount)));

  const nodes = Array.from({ length: sc }, (_, i) =>
    `<div class="step-node sn${i + 1}"><span class="step-num">${i + 1}</span></div>`
  ).join("\n        ");
  const links = Array.from({ length: sc - 1 }, (_, i) =>
    `<div class="step-link sl${i + 1}"></div>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-steps" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      ${links}
      ${nodes}
      <div class="step-check"></div>
    </div>`;

  const nodeAnims = Array.from({ length: sc }, (_, i) => {
    const t = (start + 0.18 + i * 0.26).toFixed(3);
    return `fromToIfPresent("#${sceneId} .sn${i + 1}", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.38, ease: "back.out(2.0)" }, ${t});`;
  }).join("\n      ");
  const linkAnims = Array.from({ length: sc - 1 }, (_, i) => {
    const t = (start + 0.34 + i * 0.26).toFixed(3);
    return `fromToIfPresent("#${sceneId} .sl${i + 1}", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.24, ease: "power2.out" }, ${t});`;
  }).join("\n      ");

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      ${nodeAnims}
      ${linkAnims}
      fromToIfPresent("#${sceneId} .step-check", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 0.9, duration: 0.4, ease: "back.out(1.8)" }, ${(start + 0.18 + sc * 0.26).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// BARRIER — two halves part to let particles through
// blocking — gates, access control, permission, blocking/allowing
// Params: opens bool (true = parts open), particleCount 2-4, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderBarrier(params = {}, sceneId, startTime, endTime) {
  const {
    opens         = true,
    particleCount = 3,
    subjectColor  = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const pc    = Math.max(2, Math.min(4, Math.round(particleCount)));

  const dots = Array.from({ length: pc }, (_, i) =>
    `<span class="barrier-dot bd${i + 1}"></span>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-barrier" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="barrier-left"></div>
      <div class="barrier-right"></div>
      <div class="barrier-glow"></div>
      ${opens ? "" : '<div class="barrier-x"><span class="bx-arm bx1"></span><span class="bx-arm bx2"></span></div>'}
      ${dots}
    </div>`;

  const dotAnim = opens
    ? `fromToIfPresent("#${sceneId} .barrier-dot", { x: 100, opacity: 0, scale: 0.7 }, { x: 320, opacity: 1, scale: 1, stagger: 0.13, duration: 0.72, ease: "power2.inOut" }, ${(start + 0.56).toFixed(3)});`
    : `fromToIfPresent("#${sceneId} .barrier-dot", { x: 100, opacity: 1, scale: 1 }, { x: 200, opacity: 0, scale: 0.7, stagger: 0.1, duration: 0.52, ease: "power2.in" }, ${(start + 0.22).toFixed(3)});`;

  const barrierAnim = opens
    ? `fromToIfPresent("#${sceneId} .barrier-left", { x: 0 }, { x: -54, duration: 0.44, ease: "power3.out" }, ${(start + 0.32).toFixed(3)});
      fromToIfPresent("#${sceneId} .barrier-right", { x: 0 }, { x: 54, duration: 0.44, ease: "power3.out" }, ${(start + 0.32).toFixed(3)});`
    : `fromToIfPresent("#${sceneId} .barrier-left", { x: -54 }, { x: 0, duration: 0.44, ease: "power3.in" }, ${(start + 0.14).toFixed(3)});
      fromToIfPresent("#${sceneId} .barrier-right", { x: 54 }, { x: 0, duration: 0.44, ease: "power3.in" }, ${(start + 0.14).toFixed(3)});`;

  const xAnim = opens ? "" : `
      fromToIfPresent("#${sceneId} .bx1", { scaleX: 0, transformOrigin: "center center" }, { scaleX: 1, duration: 0.22, ease: "power3.out" }, ${(start + 0.62).toFixed(3)});
      fromToIfPresent("#${sceneId} .bx2", { scaleX: 0, transformOrigin: "center center" }, { scaleX: 1, duration: 0.22, ease: "power3.out" }, ${(start + 0.68).toFixed(3)});
      tl.to("#${sceneId} .barrier-x", { scale: 1.18, duration: 0.18, yoyo: true, repeat: 1, ease: "sine.inOut" }, ${(start + 0.86).toFixed(3)});`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      ${barrierAnim}
      fromToIfPresent("#${sceneId} .barrier-glow", { opacity: 0 }, { opacity: 0.7, duration: 0.32, ease: "power2.out" }, ${(start + 0.28).toFixed(3)});
      ${dotAnim}${xAnim}`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// SCALE — balance beam tilts toward the heavier side
// weighing — comparisons, trade-offs, pros vs cons
// Params: tiltDirection "left"|"right"|"balanced", subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderScale(params = {}, sceneId, startTime, endTime) {
  const {
    tiltDirection = "right",
    subjectColor  = "#a6ff3d"
  } = params;
  const start  = Number(startTime) || 0;
  const end    = Number(endTime)   || start + 3.5;
  const outro  = Math.max(start + 0.7, end - 0.42);
  const tilt   = tiltDirection === "balanced" ? 0 : tiltDirection === "left" ? -18 : 18;
  const leftY  = tiltDirection === "left" ? 18 : tiltDirection === "right" ? -18 : 0;
  const rightY = -leftY;

  const html = `
    <div class="semantic-scene scene-scale" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="scale-post"></div>
      <div class="scale-beam"></div>
      <div class="scale-pan-left"></div>
      <div class="scale-pan-right"></div>
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .scale-post", { scaleY: 0, transformOrigin: "bottom center", opacity: 0.3 }, { scaleY: 1, opacity: 0.9, duration: 0.38, ease: "power2.out" }, ${(start + 0.12).toFixed(3)});
      fromToIfPresent("#${sceneId} .scale-beam", { rotation: 0, opacity: 0.4 }, { rotation: ${tilt}, opacity: 1, duration: 0.92, ease: "elastic.out(1, 0.6)" }, ${(start + 0.28).toFixed(3)});
      fromToIfPresent("#${sceneId} .scale-pan-left", { y: 0, opacity: 0.4 }, { y: ${leftY}, opacity: 1, duration: 0.92, ease: "elastic.out(1, 0.6)" }, ${(start + 0.28).toFixed(3)});
      fromToIfPresent("#${sceneId} .scale-pan-right", { y: 0, opacity: 0.4 }, { y: ${rightY}, opacity: 1, duration: 0.92, ease: "elastic.out(1, 0.6)" }, ${(start + 0.28).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// ARROW — directional arrow extends toward a target
// pointing — direction, guidance, emphasis, redirection
// Params: direction "right"|"up"|"down", subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderArrow(params = {}, sceneId, startTime, endTime) {
  const {
    direction    = "right",
    subjectColor = "#a6ff3d"
  } = params;
  const start     = Number(startTime) || 0;
  const end       = Number(endTime)   || start + 3.5;
  const outro     = Math.max(start + 0.7, end - 0.42);
  const rotations = { right: 0, up: -90, down: 90, left: 180 };
  const rotation  = rotations[direction] ?? 0;

  const html = `
    <div class="semantic-scene scene-arrow" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="arrow-wrap" style="transform: rotate(${rotation}deg);">
        <div class="arrow-shaft"></div>
        <div class="arrow-head"></div>
      </div>
      <div class="arrow-glow"></div>
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .arrow-shaft", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.52, ease: "power3.out" }, ${(start + 0.16).toFixed(3)});
      fromToIfPresent("#${sceneId} .arrow-head", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.36, ease: "back.out(2.0)" }, ${(start + 0.46).toFixed(3)});
      fromToIfPresent("#${sceneId} .arrow-glow", { opacity: 0, x: -20 }, { opacity: 0.62, x: 0, duration: 0.54, ease: "power2.out" }, ${(start + 0.42).toFixed(3)});
      tl.to("#${sceneId} .arrow-wrap", { x: 12, duration: 0.46, yoyo: true, repeat: 1, ease: "sine.inOut" }, ${(start + 0.72).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// STREAM — dense continuous particle stream
// streaming — data flow, ongoing supply, continuous delivery
// Params: particleCount 4-8, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderStream(params = {}, sceneId, startTime, endTime) {
  const {
    particleCount = 5,
    subjectColor  = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const pc    = Math.max(4, Math.min(8, Math.round(particleCount)));

  const dots = Array.from({ length: pc }, (_, i) =>
    `<span class="stream-dot sd${i + 1}"></span>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-stream" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="stream-source"></div>
      <div class="stream-channel">${dots}</div>
      <div class="stream-target"></div>
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .stream-source", { scale: 0.82, opacity: 0.3 }, { scale: 1.04, opacity: 0.78, duration: 0.58, yoyo: true, repeat: 2, ease: "sine.inOut" }, ${(start + 0.12).toFixed(3)});
      fromToIfPresent("#${sceneId} .stream-dot", { x: -40, opacity: 0, scale: 0.6 }, { x: 280, opacity: 1, scale: 1, stagger: 0.08, duration: 0.72, repeat: 1, ease: "none" }, ${(start + 0.18).toFixed(3)});
      fromToIfPresent("#${sceneId} .stream-target", { scale: 0.8, opacity: 0.28 }, { scale: 1.06, opacity: 0.84, duration: 0.52, ease: "back.out(1.7)" }, ${(start + 0.46).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// PULSE_SPIKE — flat baseline with a sharp vertical spike
// spiking — activation events, alerts, energy peaks, heart rate
// Params: spikeCount 1-3, subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderPulseSpike(params = {}, sceneId, startTime, endTime) {
  const {
    spikeCount   = 2,
    subjectColor = "#a6ff3d"
  } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);
  const sc    = Math.max(1, Math.min(3, Math.round(spikeCount)));

  const spikes = Array.from({ length: sc }, (_, i) =>
    `<div class="spike-peak sp${i + 1}"><div class="spike-inner"></div></div>`
  ).join("\n        ");

  const html = `
    <div class="semantic-scene scene-spike" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="spike-baseline"></div>
      ${spikes}
      <div class="spike-glow"></div>
    </div>`;

  const spikeAnims = Array.from({ length: sc }, (_, i) => {
    const t = (start + 0.28 + i * 0.46).toFixed(3);
    return `fromToIfPresent("#${sceneId} .sp${i + 1} .spike-inner", { scaleY: 0, transformOrigin: "bottom center", opacity: 0.3 }, { scaleY: 1, opacity: 1, duration: 0.18, ease: "power4.out" }, ${t});
      tl.to("#${sceneId} .sp${i + 1} .spike-inner", { scaleY: 0, opacity: 0.3, duration: 0.22, ease: "power2.in" }, ${(parseFloat(t) + 0.18).toFixed(3)});`;
  }).join("\n      ");

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .spike-baseline", { scaleX: 0, transformOrigin: "left center", opacity: 0.3 }, { scaleX: 1, opacity: 0.72, duration: 0.38, ease: "power2.out" }, ${(start + 0.14).toFixed(3)});
      ${spikeAnims}
      fromToIfPresent("#${sceneId} .spike-glow", { opacity: 0 }, { opacity: 0.54, duration: 0.26, yoyo: true, repeat: ${sc}, ease: "sine.inOut" }, ${(start + 0.28).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// COMPARE — split-screen before/after: left panel = bad/before (dim),
//           right panel = good/after (lit green), divider wipes down
// Params: subjectColor
// ─────────────────────────────────────────────────────────────────
export function renderCompare(params = {}, sceneId, startTime, endTime) {
  const { subjectColor = "#a6ff3d" } = params;
  const start = Number(startTime) || 0;
  const end   = Number(endTime)   || start + 3.5;
  const outro = Math.max(start + 0.7, end - 0.42);

  const html = `
    <div class="semantic-scene scene-compare" id="${sceneId}" style="--sc:${toHex(subjectColor)};--sc-rgb:${hexToRGB(subjectColor)}" aria-hidden="true">
      <div class="cmp-left">
        <div class="cmp-x"><span class="cx-arm cx1"></span><span class="cx-arm cx2"></span></div>
      </div>
      <div class="cmp-divider"></div>
      <div class="cmp-right">
        <div class="cmp-check"></div>
      </div>
    </div>`;

  const gsapCode = `
      tl.set("#${sceneId}", { opacity: 0 }, 0);
      tl.to("#${sceneId}", { opacity: 1, duration: 0.42, ease: "power2.out" }, ${start.toFixed(3)});
      tl.to("#${sceneId}", { opacity: 0, duration: 0.36, ease: "power2.in" }, ${outro.toFixed(3)});
      fromToIfPresent("#${sceneId} .cmp-left",    { opacity: 0 }, { opacity: 1, duration: 0.34, ease: "power2.out" }, ${(start + 0.14).toFixed(3)});
      fromToIfPresent("#${sceneId} .cmp-right",   { opacity: 0 }, { opacity: 1, duration: 0.34, ease: "power2.out" }, ${(start + 0.14).toFixed(3)});
      fromToIfPresent("#${sceneId} .cmp-divider", { scaleY: 0, transformOrigin: "top center" }, { scaleY: 1, duration: 0.52, ease: "power3.out" }, ${(start + 0.28).toFixed(3)});
      fromToIfPresent("#${sceneId} .cx1", { scaleX: 0, transformOrigin: "center center" }, { scaleX: 1, duration: 0.22, ease: "power3.out" }, ${(start + 0.52).toFixed(3)});
      fromToIfPresent("#${sceneId} .cx2", { scaleX: 0, transformOrigin: "center center" }, { scaleX: 1, duration: 0.22, ease: "power3.out" }, ${(start + 0.58).toFixed(3)});
      fromToIfPresent("#${sceneId} .cmp-check",   { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.38, ease: "back.out(1.8)" }, ${(start + 0.62).toFixed(3)});
      fromToIfPresent("#${sceneId} .cmp-right",   { boxShadow: "none" }, { boxShadow: "inset 0 0 28px rgba(var(--sc-rgb),0.18), 0 0 22px rgba(var(--sc-rgb),0.28)", duration: 0.46, ease: "power2.out" }, ${(start + 0.58).toFixed(3)});`;

  return { html, gsapCode };
}

// ─────────────────────────────────────────────────────────────────
// DISPATCH
// ─────────────────────────────────────────────────────────────────
export function renderPattern(pattern, params = {}, sceneId, startTime, endTime) {
  switch (pattern) {
    case "FLOW":        return renderFlow(params, sceneId, startTime, endTime);
    case "FILL":        return renderFill(params, sceneId, startTime, endTime);
    case "PULSE":       return renderPulse(params, sceneId, startTime, endTime);
    case "PROGRESS":    return renderProgress(params, sceneId, startTime, endTime);
    case "ALERT":       return renderAlert(params, sceneId, startTime, endTime);
    case "WAVE":        return renderWave(params, sceneId, startTime, endTime);
    case "GAUGE":       return renderGauge(params, sceneId, startTime, endTime);
    case "STACK":       return renderStack(params, sceneId, startTime, endTime);
    case "NETWORK":     return renderNetwork(params, sceneId, startTime, endTime);
    case "CLOCK_ARC":   return renderClockArc(params, sceneId, startTime, endTime);
    case "STEPS":       return renderSteps(params, sceneId, startTime, endTime);
    case "BARRIER":     return renderBarrier(params, sceneId, startTime, endTime);
    case "SCALE":       return renderScale(params, sceneId, startTime, endTime);
    case "ARROW":       return renderArrow(params, sceneId, startTime, endTime);
    case "STREAM":      return renderStream(params, sceneId, startTime, endTime);
    case "PULSE_SPIKE": return renderPulseSpike(params, sceneId, startTime, endTime);
    case "COMPARE":     return renderCompare(params, sceneId, startTime, endTime);
    default:            return emptyResult();
  }
}

// ─────────────────────────────────────────────────────────────────
// CSS — injected once into the HTML template.
// Generic class names only — no topic words.
// ─────────────────────────────────────────────────────────────────
export function getPatternCSS() {
  return `
      /* ── SCENE CELL: all scenes fill their .primitive-cell parent ── */
      .scene-flow,.scene-fill,.scene-pulse,.scene-progress,.scene-alert,
      .scene-wave,.scene-gauge,.scene-stack,.scene-network,.scene-clock,
      .scene-steps,.scene-barrier,.scene-scale,.scene-arrow,.scene-stream,
      .scene-spike,.scene-compare {
        left: 0 !important; top: 0 !important;
        width: 100% !important; height: 100% !important;
        overflow: visible !important;
      }

      /* ── FLOW ────────────────────────────────────────── */
      .scene-flow { left: 112px; top: 1118px; width: 500px; height: 120px; }
      .flow-source {
        position: absolute; left: 0; top: 16px;
        width: 78px; height: 78px;
        border-radius: 42% 58% 54% 46%;
        border: 3px solid rgba(var(--sc-rgb),0.62);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.18), rgba(var(--sc-rgb),0.03) 64%);
        box-shadow: 0 0 30px rgba(var(--sc-rgb),0.36);
      }
      .flow-track {
        position: absolute; left: 92px; top: 42px;
        width: 240px; height: 30px;
      }
      .flow-dot {
        position: absolute; left: 0; top: 4px;
        width: 20px; height: 20px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 20px rgba(var(--sc-rgb),0.82);
      }
      .flow-target {
        position: absolute; right: 0; top: 16px;
        width: 80px; height: 80px; border-radius: 50%;
        border: 3px solid rgba(var(--sc-rgb),0.52);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.17), rgba(var(--sc-rgb),0.02) 64%);
        box-shadow: 0 0 36px rgba(var(--sc-rgb),0.34);
      }
      .flow-gate {
        position: absolute; right: 84px; top: 28px;
        width: 20px; height: 54px; border-radius: 10px;
        border: 2px solid rgba(var(--sc-rgb),0.64);
        background: rgba(0,0,0,0.54);
        box-shadow: 0 0 14px rgba(var(--sc-rgb),0.38);
      }

      /* ── FILL ────────────────────────────────────────── */
      .scene-fill { left: 112px; top: 1118px; width: 500px; height: 128px; }
      .fill-bar {
        position: absolute; left: 18px; top: 58px;
        width: 334px; height: 10px; border-radius: 999px;
        background: rgba(var(--sc-rgb),0.12); overflow: hidden;
        box-shadow: 0 0 18px rgba(var(--sc-rgb),0.16);
      }
      .fill-bar-inner {
        display: block; width: 100%; height: 100%; border-radius: inherit;
        background: linear-gradient(90deg, rgba(var(--sc-rgb),0.96), rgba(var(--sc-rgb),0.38));
        box-shadow: 0 0 20px rgba(var(--sc-rgb),0.62);
      }
      .fill-dot {
        position: absolute; width: 22px; height: 22px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 22px rgba(var(--sc-rgb),0.76);
      }
      .fill-dot.fl1 { left: 54px;  top: 88px; }
      .fill-dot.fl2 { left: 156px; top: 30px; }
      .fill-dot.fl3 { left: 258px; top: 88px; }
      .fill-dot.fl4 { left: 105px; top: 88px; }
      .fill-dot.fl5 { left: 207px; top: 30px; }
      .fill-confirm {
        position: absolute; left: 396px; top: 44px;
        width: 44px; height: 23px;
        border-left: 6px solid var(--sc); border-bottom: 6px solid var(--sc);
        transform: rotate(-45deg); box-shadow: 0 0 20px rgba(var(--sc-rgb),0.62);
      }

      /* ── PULSE ───────────────────────────────────────── */
      .scene-pulse { left: 112px; top: 1118px; width: 500px; height: 124px; }
      .pulse-core {
        position: absolute; left: 192px; top: 16px;
        width: 88px; height: 88px; border-radius: 50%;
        border: 3px solid rgba(var(--sc-rgb),0.52);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.22), rgba(var(--sc-rgb),0.04) 64%);
        box-shadow: 0 0 38px rgba(var(--sc-rgb),0.36);
      }
      .pulse-ring {
        position: absolute; border-radius: 50%;
        border: 2px solid rgba(var(--sc-rgb),0.26);
        box-shadow: 0 0 20px rgba(var(--sc-rgb),0.20);
      }
      .pulse-ring.pr1 { left: 176px; top: 2px;  width: 118px; height: 118px; }
      .pulse-ring.pr2 { left: 162px; top: -12px; width: 146px; height: 146px; opacity: 0.40; }
      .pulse-confirm {
        position: absolute; right: 54px; top: 46px;
        width: 36px; height: 20px;
        border-left: 5px solid var(--sc); border-bottom: 5px solid var(--sc);
        transform: rotate(-45deg); box-shadow: 0 0 18px rgba(var(--sc-rgb),0.60);
      }

      /* ── PROGRESS ────────────────────────────────────── */
      .scene-progress { left: 112px; top: 1118px; width: 500px; height: 112px; }
      .prog-rail {
        position: absolute; left: 18px; top: 52px;
        width: 340px; height: 6px; border-radius: 999px;
        background: rgba(var(--sc-rgb),0.14); overflow: hidden;
        box-shadow: 0 0 14px rgba(var(--sc-rgb),0.14);
      }
      .prog-fill {
        display: block; width: 100%; height: 100%; border-radius: inherit;
        background: linear-gradient(90deg, rgba(var(--sc-rgb),0.96), rgba(var(--sc-rgb),0.46));
        box-shadow: 0 0 16px rgba(var(--sc-rgb),0.58);
      }
      .prog-marker {
        position: absolute; left: 14px; top: 42px;
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 18px rgba(var(--sc-rgb),0.9);
      }
      .prog-node {
        position: absolute; top: 43px;
        width: 10px; height: 10px; border-radius: 50%;
        background: rgba(var(--sc-rgb),0.28);
        border: 2px solid rgba(var(--sc-rgb),0.52);
      }
      .prog-node.pn1 { left: 68px; }
      .prog-node.pn2 { left: 118px; }
      .prog-node.pn3 { left: 178px; }
      .prog-node.pn4 { left: 228px; }
      .prog-node.pn5 { left: 288px; }
      .prog-node.pn6 { left: 338px; }
      .prog-node.pn7 { left: 258px; }
      .prog-node.pn8 { left: 308px; }

      /* ── ALERT ───────────────────────────────────────── */
      .scene-alert { left: 112px; top: 1118px; width: 500px; height: 130px; }
      .alert-core {
        position: absolute; left: 190px; top: 18px;
        width: 72px; height: 72px; border-radius: 50%;
        border: 3px solid rgba(var(--sc-rgb),0.72);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.22), rgba(var(--sc-rgb),0.03) 64%);
        box-shadow: 0 0 30px rgba(var(--sc-rgb),0.42);
      }
      .alert-ring {
        position: absolute; border-radius: 50%;
        border: 2px solid rgba(var(--sc-rgb),0.38);
        box-shadow: 0 0 18px rgba(var(--sc-rgb),0.24);
      }
      .alert-ring.ar1 { left: 176px; top: 4px;  width: 100px; height: 100px; }
      .alert-ring.ar2 { left: 160px; top: -12px; width: 132px; height: 132px; opacity: 0.38; }
      .alert-dot {
        position: absolute; top: 50px;
        width: 14px; height: 14px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 16px rgba(var(--sc-rgb),0.72);
      }
      .alert-dot.ad1 { left: 18px; }
      .alert-dot.ad2 { left: 38px; top: 44px; }
      .alert-dot.ad3 { left: 28px; top: 60px; }
      .alert-dot.ad4 { left: 48px; top: 56px; }

      /* ── WAVE ────────────────────────────────────────── */
      .scene-wave { left: 112px; top: 1118px; width: 500px; height: 120px; }
      .wave-baseline {
        position: absolute; left: 18px; top: 68px;
        width: 360px; height: 3px; border-radius: 2px;
        background: rgba(var(--sc-rgb),0.22);
      }
      .wave-bars {
        position: absolute; left: 28px; top: 20px;
        width: 340px; height: 90px;
        display: flex; align-items: flex-end; gap: 14px;
      }
      .wave-bar {
        display: block; flex: 1; border-radius: 3px 3px 0 0;
        background: linear-gradient(180deg, rgba(var(--sc-rgb),0.9), rgba(var(--sc-rgb),0.28));
        box-shadow: 0 0 12px rgba(var(--sc-rgb),0.46);
        transform-origin: bottom center;
      }
      .wave-bar.wb1 { height: 34px; }
      .wave-bar.wb2 { height: 52px; }
      .wave-bar.wb3 { height: 72px; }
      .wave-bar.wb4 { height: 82px; }
      .wave-bar.wb5 { height: 72px; }
      .wave-bar.wb6 { height: 52px; }
      .wave-bar.wb7 { height: 34px; }
      .wave-bar.wb8 { height: 48px; }
      .wave-bar.wb9 { height: 62px; }

      /* ── GAUGE ───────────────────────────────────────── */
      .scene-gauge { left: 112px; top: 1090px; width: 500px; height: 160px; }
      .gauge-track {
        position: absolute; left: 148px; top: 12px;
        width: 120px; height: 120px; border-radius: 50%;
        border: 10px solid rgba(var(--sc-rgb),0.14);
        clip-path: polygon(0 50%, 100% 50%, 100% 100%, 0 100%);
        box-shadow: 0 0 20px rgba(var(--sc-rgb),0.12);
      }
      .gauge-fill {
        position: absolute; left: 148px; top: 12px;
        width: 120px; height: 120px; border-radius: 50%;
        border: 10px solid transparent;
        border-top-color: rgba(var(--sc-rgb),0.88);
        border-right-color: rgba(var(--sc-rgb),0.72);
        box-shadow: 0 0 24px rgba(var(--sc-rgb),0.48);
        clip-path: polygon(0 50%, 100% 50%, 100% 100%, 0 100%);
      }
      .gauge-needle {
        position: absolute; left: 202px; top: 66px;
        width: 3px; height: 56px; border-radius: 2px;
        background: var(--sc); transform-origin: bottom center;
        box-shadow: 0 0 12px rgba(var(--sc-rgb),0.72);
      }
      .gauge-center {
        position: absolute; left: 198px; top: 118px;
        width: 12px; height: 12px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 14px rgba(var(--sc-rgb),0.9);
      }
      .gauge-glow {
        position: absolute; left: 144px; top: 8px;
        width: 128px; height: 128px; border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.08), transparent 64%);
      }

      /* ── STACK ───────────────────────────────────────── */
      .scene-stack { left: 112px; top: 1108px; width: 500px; height: 150px; }
      .stack-row {
        position: absolute; left: 18px;
        height: 24px; border-radius: 4px;
        background: rgba(var(--sc-rgb),0.08);
        border: 1.5px solid rgba(var(--sc-rgb),0.32);
        overflow: hidden;
      }
      .stack-row.sr1 { top: 10px;  width: 280px; }
      .stack-row.sr2 { top: 46px;  width: 220px; }
      .stack-row.sr3 { top: 82px;  width: 250px; }
      .stack-row.sr4 { top: 118px; width: 200px; }
      .stack-row.sr5 { top: 154px; width: 240px; }
      .stack-fill {
        display: block; width: 100%; height: 100%;
        background: linear-gradient(90deg, rgba(var(--sc-rgb),0.58), rgba(var(--sc-rgb),0.18));
        border-radius: inherit;
      }
      .stack-confirm {
        position: absolute; right: 48px; top: 46px;
        width: 34px; height: 18px;
        border-left: 5px solid var(--sc); border-bottom: 5px solid var(--sc);
        transform: rotate(-45deg); box-shadow: 0 0 16px rgba(var(--sc-rgb),0.6);
      }

      /* ── NETWORK ─────────────────────────────────────── */
      .scene-network { left: 112px; top: 1108px; width: 500px; height: 140px; }
      .net-node {
        position: absolute;
        width: 28px; height: 28px; border-radius: 50%;
        border: 3px solid rgba(var(--sc-rgb),0.72);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.26), rgba(var(--sc-rgb),0.04) 64%);
        box-shadow: 0 0 18px rgba(var(--sc-rgb),0.44);
      }
      .net-node.nn1 { left: 18px;  top: 52px; }
      .net-node.nn2 { left: 128px; top: 16px; }
      .net-node.nn3 { left: 238px; top: 66px; }
      .net-node.nn4 { left: 348px; top: 24px; }
      .net-node.nn5 { left: 408px; top: 72px; }
      .net-line {
        position: absolute; height: 2px;
        background: linear-gradient(90deg, rgba(var(--sc-rgb),0.62), rgba(var(--sc-rgb),0.24));
        border-radius: 1px; top: 52px;
        transform-origin: left center;
      }
      .net-line.nl1 { left: 46px;  width: 102px; top: 62px;  transform: rotate(-22deg); }
      .net-line.nl2 { left: 154px; width: 102px; top: 38px;  transform: rotate(28deg);  }
      .net-line.nl3 { left: 262px; width: 102px; top: 56px;  transform: rotate(-24deg); }
      .net-line.nl4 { left: 372px; width: 56px;  top: 44px;  transform: rotate(32deg);  }

      /* ── CLOCK_ARC ───────────────────────────────────── */
      .scene-clock { left: 112px; top: 1100px; width: 500px; height: 148px; }
      .clock-ring {
        position: absolute; left: 172px; top: 12px;
        width: 108px; height: 108px; border-radius: 50%;
        border: 4px solid rgba(var(--sc-rgb),0.34);
        box-shadow: 0 0 22px rgba(var(--sc-rgb),0.22);
      }
      .clock-orbit {
        position: absolute; left: 172px; top: 12px;
        width: 108px; height: 108px; border-radius: 50%;
      }
      .clock-marker {
        position: absolute; top: -6px; left: 50%;
        transform: translateX(-50%);
        width: 12px; height: 12px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 14px rgba(var(--sc-rgb),0.9);
      }
      .clock-center {
        position: absolute; left: 220px; top: 60px;
        width: 14px; height: 14px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 16px rgba(var(--sc-rgb),0.9);
      }
      .clock-tick {
        position: absolute;
        width: 6px; height: 6px; border-radius: 50%;
        background: rgba(var(--sc-rgb),0.52);
      }
      .clock-tick.ct1 { left: 172px; top: 12px;  }
      .clock-tick.ct2 { left: 278px; top: 62px;  }
      .clock-tick.ct3 { left: 172px; top: 114px; }
      .clock-tick.ct4 { left: 122px; top: 62px;  }

      /* ── STEPS ───────────────────────────────────────── */
      .scene-steps { left: 112px; top: 1118px; width: 500px; height: 110px; }
      .step-node {
        position: absolute; top: 30px;
        width: 44px; height: 44px; border-radius: 50%;
        border: 3px solid rgba(var(--sc-rgb),0.72);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.24), rgba(var(--sc-rgb),0.04) 64%);
        box-shadow: 0 0 16px rgba(var(--sc-rgb),0.38);
        display: flex; align-items: center; justify-content: center;
      }
      .step-node.sn1 { left: 18px;  }
      .step-node.sn2 { left: 118px; }
      .step-node.sn3 { left: 218px; }
      .step-node.sn4 { left: 318px; }
      .step-node.sn5 { left: 388px; }
      .step-num {
        font-size: 18px; font-weight: 900; color: var(--sc);
        line-height: 1;
      }
      .step-link {
        position: absolute; top: 50px; height: 3px;
        background: rgba(var(--sc-rgb),0.38); border-radius: 2px;
      }
      .step-link.sl1 { left: 62px;  width: 56px; }
      .step-link.sl2 { left: 162px; width: 56px; }
      .step-link.sl3 { left: 262px; width: 56px; }
      .step-link.sl4 { left: 362px; width: 26px; }
      .step-check {
        position: absolute; right: 48px; top: 38px;
        width: 30px; height: 16px;
        border-left: 5px solid var(--sc); border-bottom: 5px solid var(--sc);
        transform: rotate(-45deg); box-shadow: 0 0 16px rgba(var(--sc-rgb),0.6);
      }

      /* ── BARRIER ─────────────────────────────────────── */
      .scene-barrier { left: 112px; top: 1118px; width: 500px; height: 116px; }
      .barrier-left {
        position: absolute; left: 158px; top: 12px;
        width: 44px; height: 88px; border-radius: 6px 0 0 6px;
        background: linear-gradient(180deg, rgba(var(--sc-rgb),0.52), rgba(var(--sc-rgb),0.18));
        border: 2px solid rgba(var(--sc-rgb),0.64); border-right: none;
        box-shadow: -4px 0 18px rgba(var(--sc-rgb),0.32);
      }
      .barrier-right {
        position: absolute; left: 202px; top: 12px;
        width: 44px; height: 88px; border-radius: 0 6px 6px 0;
        background: linear-gradient(180deg, rgba(var(--sc-rgb),0.52), rgba(var(--sc-rgb),0.18));
        border: 2px solid rgba(var(--sc-rgb),0.64); border-left: none;
        box-shadow: 4px 0 18px rgba(var(--sc-rgb),0.32);
      }
      .barrier-glow {
        position: absolute; left: 148px; top: 2px;
        width: 108px; height: 108px; border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.12), transparent 64%);
      }
      .barrier-dot {
        position: absolute; top: 50px;
        width: 14px; height: 14px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 14px rgba(var(--sc-rgb),0.82);
      }
      .barrier-dot.bd1 { left: 68px; }
      .barrier-dot.bd2 { left: 84px; top: 42px; }
      .barrier-dot.bd3 { left: 74px; top: 62px; }
      .barrier-dot.bd4 { left: 90px; top: 54px; }
      .barrier-x {
        position: absolute; left: 178px; top: 36px;
        width: 48px; height: 48px;
      }
      .bx-arm {
        position: absolute; top: 50%; left: 0;
        width: 48px; height: 5px; border-radius: 3px;
        background: var(--sc);
        box-shadow: 0 0 12px rgba(var(--sc-rgb),0.72);
        transform-origin: center center;
      }
      .bx-arm.bx1 { transform: translateY(-50%) rotate(45deg);  }
      .bx-arm.bx2 { transform: translateY(-50%) rotate(-45deg); }

      /* ── SCALE ───────────────────────────────────────── */
      .scene-scale { left: 112px; top: 1100px; width: 500px; height: 148px; }
      .scale-post {
        position: absolute; left: 234px; top: 40px;
        width: 4px; height: 72px; border-radius: 2px;
        background: rgba(var(--sc-rgb),0.62);
        box-shadow: 0 0 12px rgba(var(--sc-rgb),0.38);
      }
      .scale-beam {
        position: absolute; left: 128px; top: 38px;
        width: 216px; height: 4px; border-radius: 2px;
        background: rgba(var(--sc-rgb),0.78);
        box-shadow: 0 0 14px rgba(var(--sc-rgb),0.48);
        transform-origin: center center;
      }
      .scale-pan-left {
        position: absolute; left: 112px; top: 44px;
        width: 56px; height: 56px; border-radius: 50%;
        border: 3px solid rgba(var(--sc-rgb),0.62);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.16), rgba(var(--sc-rgb),0.03) 64%);
        box-shadow: 0 0 18px rgba(var(--sc-rgb),0.32);
      }
      .scale-pan-right {
        position: absolute; right: 112px; top: 44px;
        width: 56px; height: 56px; border-radius: 50%;
        border: 3px solid rgba(var(--sc-rgb),0.62);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.16), rgba(var(--sc-rgb),0.03) 64%);
        box-shadow: 0 0 18px rgba(var(--sc-rgb),0.32);
      }

      /* ── ARROW ───────────────────────────────────────── */
      .scene-arrow { left: 112px; top: 1130px; width: 500px; height: 100px; }
      .arrow-wrap {
        position: absolute; left: 88px; top: 30px;
        width: 280px; height: 40px;
        display: flex; align-items: center;
        transform-origin: center center;
      }
      .arrow-shaft {
        display: block; height: 5px; width: 230px;
        border-radius: 3px;
        background: linear-gradient(90deg, rgba(var(--sc-rgb),0.9), rgba(var(--sc-rgb),0.52));
        box-shadow: 0 0 16px rgba(var(--sc-rgb),0.52);
        transform-origin: left center;
      }
      .arrow-head {
        width: 0; height: 0;
        border-top: 18px solid transparent;
        border-bottom: 18px solid transparent;
        border-left: 32px solid rgba(var(--sc-rgb),0.92);
        filter: drop-shadow(0 0 12px rgba(var(--sc-rgb),0.72));
        transform-origin: left center;
      }
      .arrow-glow {
        position: absolute; left: 248px; top: 10px;
        width: 80px; height: 80px; border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.14), transparent 64%);
      }

      /* ── STREAM ──────────────────────────────────────── */
      .scene-stream { left: 112px; top: 1118px; width: 500px; height: 120px; }
      .stream-source {
        position: absolute; left: 0; top: 20px;
        width: 66px; height: 66px;
        border-radius: 38% 62% 56% 44%;
        border: 3px solid rgba(var(--sc-rgb),0.58);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.2), rgba(var(--sc-rgb),0.03) 64%);
        box-shadow: 0 0 28px rgba(var(--sc-rgb),0.34);
      }
      .stream-channel {
        position: absolute; left: 80px; top: 40px;
        width: 300px; height: 28px;
        background: linear-gradient(90deg, rgba(var(--sc-rgb),0.06), rgba(var(--sc-rgb),0.02));
        border-radius: 14px;
      }
      .stream-dot {
        position: absolute; left: 0; top: 4px;
        width: 16px; height: 16px; border-radius: 50%;
        background: var(--sc); box-shadow: 0 0 16px rgba(var(--sc-rgb),0.78);
        opacity: 0;
      }
      .stream-target {
        position: absolute; right: 0; top: 20px;
        width: 68px; height: 68px; border-radius: 50%;
        border: 3px solid rgba(var(--sc-rgb),0.48);
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.18), rgba(var(--sc-rgb),0.02) 64%);
        box-shadow: 0 0 32px rgba(var(--sc-rgb),0.32);
      }

      /* ── PULSE_SPIKE ─────────────────────────────────── */
      .scene-spike { left: 112px; top: 1128px; width: 500px; height: 110px; }
      .spike-baseline {
        position: absolute; left: 18px; top: 72px;
        width: 380px; height: 3px; border-radius: 2px;
        background: rgba(var(--sc-rgb),0.36);
        box-shadow: 0 0 10px rgba(var(--sc-rgb),0.28);
      }
      .spike-peak {
        position: absolute; top: 18px;
        display: flex; align-items: flex-end; justify-content: center;
        width: 24px; height: 54px;
      }
      .spike-peak.sp1 { left: 88px; }
      .spike-peak.sp2 { left: 218px; }
      .spike-peak.sp3 { left: 308px; }
      .spike-inner {
        display: block; width: 4px; height: 54px; border-radius: 2px;
        background: linear-gradient(180deg, rgba(var(--sc-rgb),0.96), rgba(var(--sc-rgb),0.28));
        box-shadow: 0 0 14px rgba(var(--sc-rgb),0.72);
        transform-origin: bottom center; transform: scaleY(0);
      }
      .spike-glow {
        position: absolute; left: 68px; top: 4px;
        width: 80px; height: 80px; border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--sc-rgb),0.1), transparent 64%);
      }

      /* ── COMPARE ─────────────────────────────────────── */
      .scene-compare { left: 112px; top: 1118px; width: 500px; height: 116px; }
      .cmp-left {
        position: absolute; left: 0; top: 0;
        width: 228px; height: 116px; border-radius: 8px 0 0 8px;
        background: rgba(var(--sc-rgb),0.07);
        border: 1.5px solid rgba(var(--sc-rgb),0.28);
        border-right: none;
      }
      .cmp-right {
        position: absolute; right: 0; top: 0;
        width: 228px; height: 116px; border-radius: 0 8px 8px 0;
        background: rgba(var(--sc-rgb),0.07);
        border: 1.5px solid rgba(var(--sc-rgb),0.32);
        border-left: none;
      }
      .cmp-divider {
        position: absolute; left: 246px; top: 0;
        width: 4px; height: 116px; border-radius: 2px;
        background: linear-gradient(180deg, rgba(255,255,255,0.62), rgba(255,255,255,0.18));
        box-shadow: 0 0 10px rgba(255,255,255,0.28);
      }
      .cmp-x {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 42px; height: 42px;
      }
      .cx-arm {
        position: absolute; top: 50%; left: 0;
        width: 42px; height: 5px; border-radius: 3px;
        background: var(--sc);
        box-shadow: 0 0 12px rgba(var(--sc-rgb),0.72);
        transform-origin: center center;
      }
      .cx-arm.cx1 { transform: translateY(-50%) rotate(45deg);  }
      .cx-arm.cx2 { transform: translateY(-50%) rotate(-45deg); }
      .cmp-check {
        position: absolute; right: 52px; top: 38px;
        width: 36px; height: 20px;
        border-left: 6px solid var(--sc); border-bottom: 6px solid var(--sc);
        transform: rotate(-45deg);
        box-shadow: 0 0 16px rgba(var(--sc-rgb),0.62);
      }
  `;
}
