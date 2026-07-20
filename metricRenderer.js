/**
 * metricRenderer.js — CNFI Semantic Overlay Library
 *
 * Count-up driven by window.renderAt() — called every frame by Puppeteer.
 * No GSAP tl.set/tl.call for text update — those don't fire during seek.
 *
 * single_value / comparison_value:
 *   - renders <span id="mn-...">0</span>
 *   - registers { id, targetValue, startTime, endTime } into window.__countUps
 *   - renderAt() reads registry, computes eased value, writes textContent directly
 *
 * range_value / text_metric:
 *   - static text, no animation needed
 */

import { parseOverlayTitle, detectDirection } from "./metricParser.js";

// direction → { symbol, color }
const DIRECTION_DISPLAY = {
  down:     { symbol: "↓", color: "rgba(255,90,90,0.9)"  },
  up:       { symbol: "↑", color: "rgba(166,255,61,0.95)" },
  multiply: { symbol: "×", color: "rgba(255,255,255,0.82)" },
  min:      { symbol: "≥", color: "rgba(245,197,24,0.95)" },
  max:      { symbol: "≤", color: "rgba(245,197,24,0.95)" },
  cycle:    { symbol: "↻", color: "rgba(166,255,61,0.80)" },
  approx:   { symbol: "≈", color: "rgba(255,255,255,0.60)" },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getMetricCSS() {
  return `
    .metric-value-wrap {
      display: inline-flex;
      align-items: baseline;
      flex-wrap: nowrap;
      gap: 0;
      white-space: nowrap;
    }
    .metric-number {
      display: inline-block;
      font-variant-numeric: tabular-nums;
      min-width: 0.5em;
    }
    .metric-sep    { display: inline-block; margin: 0 0.04em; }
    .metric-comparator {
      display: inline-block;
      font-size: 0.75em;
      font-weight: 900;
      color: #a6ff3d;
      margin-right: 0.06em;
      text-shadow: 0 0 12px rgba(166,255,61,0.7);
    }
    .metric-unit {
      display: inline-block;
      font-size: 0.52em;
      font-weight: 700;
      opacity: 0.82;
      margin-left: 0.22em;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      vertical-align: baseline;
    }
    .metric-text-static { display: inline-block; }
    .metric-direction {
      display: inline-block;
      font-size: 0.62em;
      font-weight: 900;
      line-height: 1;
      margin-right: 0.10em;
      vertical-align: baseline;
      letter-spacing: 0;
    }
  `;
}

function fmtComparator(raw) {
  const m = { ">":">","<":"<",">=":"≥","<=":"≤","~":"~","≈":"≈","≥":"≥","≤":"≤" };
  return m[raw] || raw;
}

function decimalPlacesFromDisplay(value) {
  const text = String(value ?? "").trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) return 0;
  const match = text.match(/[.,](\d+)$/);
  return match ? match[1].length : 0;
}

export function renderMetric(descriptor, cardSelector, cardStartTime, cardEndTime, direction) {
  if (!descriptor) {
    return { html: `<span class="metric-text-static"></span>`, gsapCode: "" };
  }

  const { kind, comparator, valueFrom, displayFrom, displayTo, separator, unit } = descriptor;
  const safeId = (cardSelector || "card-x").replace(/[^a-zA-Z0-9_-]/g, "").replace(/^-+/, "");
  const at = (cardStartTime + 0.14).toFixed(3);

  const unitHTML = unit && unit.symbol
    ? `<span class="metric-unit">${escapeHtml(unit.symbol)}</span>` : "";
  const cmpHTML  = comparator
    ? `<span class="metric-comparator">${fmtComparator(comparator)}</span>` : "";

  // Direction indicator — chỉ hiện khi không có comparator trong title
  // (comparator đã cover direction rồi, tránh double indicator)
  const dirInfo = (!comparator && direction && DIRECTION_DISPLAY[direction])
    ? DIRECTION_DISPLAY[direction] : null;
  const dirHTML = dirInfo
    ? `<span class="metric-direction" style="color:${dirInfo.color}">${dirInfo.symbol}</span>`
    : "";

  // Card entrance animation — GSAP handles opacity/scale only, not text
  const entranceGSAP = `
      tl.fromTo("${cardSelector} .metric-value-wrap",
        { opacity: 0, scale: 0.7 },
        { opacity: 1, scale: 1, duration: 0.36, ease: "back.out(1.4)" },
        ${at}
      );`;

  // RANGE or TEXT — static, no count-up needed
  if (kind === "range_value" || kind === "text_metric") {
    const sep = separator ? separator.trim() : "-";
    const display = kind === "range_value"
      ? `${displayFrom}${sep}${displayTo}`
      : descriptor.raw;
    return {
      html: `<span class="metric-value-wrap">` +
            dirHTML + cmpHTML +
            `<span class="metric-text-static">${escapeHtml(display)}</span>` +
            unitHTML + `</span>`,
      gsapCode: entranceGSAP
    };
  }

  // SINGLE or COMPARISON — register into window.__countUps for renderAt()
  const decimals = Math.max(decimalPlacesFromDisplay(displayFrom), Number.isInteger(valueFrom) ? 0 : 1);
  const isFloat = decimals > 0;
  const numberId = `mn-${safeId}`;
  const magnitude = Math.log10(Math.max(Math.abs(valueFrom), 1));
  const countDur = Math.min(1.65, Math.max(1.15, 1.05 + magnitude * 0.16));
  const countEnd = cardStartTime + 0.18 + countDur;

  // Register the count-up — runs inside the generated HTML <script>
  const registerGSAP = `
      window.__countUps = window.__countUps || [];
      window.__countUps.push({
        id: "${numberId}",
        targetValue: ${valueFrom},
        startTime: ${(cardStartTime + 0.18).toFixed(3)},
        endTime: ${countEnd.toFixed(3)},
        isFloat: ${isFloat},
        decimals: ${decimals},
        locale: "vi-VN"
      });`;

  return {
    html: `<span class="metric-value-wrap">` +
          dirHTML + cmpHTML +
          `<span class="metric-number" id="${numberId}" ` +
          `data-countup-target="${valueFrom}" ` +
          `data-countup-start="${(cardStartTime + 0.18).toFixed(3)}" ` +
          `data-countup-end="${countEnd.toFixed(3)}" ` +
          `data-countup-decimals="${decimals}" ` +
          `data-countup-float="${isFloat ? "1" : "0"}">0</span>` +
          unitHTML + `</span>`,
    gsapCode: entranceGSAP + registerGSAP
  };
}

// direction: Gemini-assigned metric_direction (primary)
// fallbackText: card.detail + card.title để keyword-detect khi direction null/neutral
export function renderMetricFromTitle(titleStr, cardSelector, cardStartTime, cardEndTime, direction, fallbackText) {
  const descriptor = parseOverlayTitle(titleStr);
  const resolved = (direction && direction !== "neutral")
    ? direction
    : detectDirection(fallbackText || titleStr);
  const finalDir = (resolved === "neutral") ? null : resolved;
  return renderMetric(descriptor, cardSelector, cardStartTime, cardEndTime, finalDir);
}
