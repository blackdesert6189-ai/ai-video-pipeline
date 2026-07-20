import {
  extractMetricsFromText,
  formatMetricTitle,
  hasRenderableMetric,
  metricIdentity,
  parseOverlayTitle
} from "./metricParser.js";

const DEFAULT_OPTIONS = {
  maxAutoMetricOverlays: 2,
  metricDuration: 3.8,
  minOverlayGap: 0.75,
  upgradeExistingOverlays: true
};

function toSeconds(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function fromMs(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / 1000 : fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeWords(text) {
  return normalizeText(text)
    .replace(/[.,;:!?()[\]{}"']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function clampWords(text, maxWords = 8) {
  return normalizeWords(text).slice(0, maxWords).join(" ");
}

function fallbackDetailFor(descriptor) {
  const type = descriptor && descriptor.unit ? descriptor.unit.type : "";
  if (type === "heart") return "THEO DOI NHỊP TIM";
  if (type === "energy") return "CHI SO NANG LUONG";
  if (type === "steps") return "CHI SO VAN DONG";
  if (type === "weight" || type === "weight_sm") return "CHI SO CAN NANG";
  if (type === "time") return "KHOANG THOI GIAN";
  if (type === "pressure") return "CHI SO HUYET AP";
  if (type === "bio") return "CHI SO SINH HOC";
  if (type === "percent") return "TY LE THAY DOI";
  return "CHI SO SUC KHOE";
}

function buildMetricDetail(sourceText, descriptor) {
  const raw = descriptor && descriptor.raw ? descriptor.raw : "";
  let text = normalizeText(sourceText);
  if (raw) {
    text = text.replace(raw, " ");
  }
  const detail = clampWords(text, 8);
  return (detail || fallbackDetailFor(descriptor)).toUpperCase();
}

function metricIsAutoOverlayCandidate(descriptor) {
  if (!hasRenderableMetric(descriptor)) return false;
  if (descriptor.kind === "text_metric") return false;
  const unitSymbol = descriptor.unit && descriptor.unit.symbol ? descriptor.unit.symbol : "";
  return !!unitSymbol || descriptor.kind === "range_value" || descriptor.kind === "comparison_value";
}

function metricScore(descriptor) {
  if (!descriptor) return 0;
  let score = 0;
  if (descriptor.kind === "single_value") score += 40;
  if (descriptor.kind === "range_value") score += 38;
  if (descriptor.kind === "comparison_value") score += 36;
  if (descriptor.unit && descriptor.unit.symbol) score += 20;
  if (descriptor.unit && descriptor.unit.type !== "count") score += 10;
  if (descriptor.kind === "text_metric") score -= 100;
  return score;
}

function overlayTimes(overlay) {
  const startTime = overlay.startTime ?? fromMs(overlay.start_ms, 0);
  const endTime = overlay.endTime ?? (
    overlay.duration_ms != null
      ? toSeconds(startTime, 0) + fromMs(overlay.duration_ms, DEFAULT_OPTIONS.metricDuration)
      : toSeconds(startTime, 0) + DEFAULT_OPTIONS.metricDuration
  );
  const start = toSeconds(startTime, 0);
  return {
    startTime: start,
    endTime: Math.max(toSeconds(endTime, start + DEFAULT_OPTIONS.metricDuration), start + 0.8)
  };
}

function overlaps(aStart, aEnd, overlay, gap) {
  const { startTime, endTime } = overlayTimes(overlay);
  return aStart < endTime + gap && aEnd + gap > startTime;
}

function isWarningOverlay(overlay) {
  return normalizeText(overlay && (overlay.type ?? overlay.visual_type)).toUpperCase() === "WARNING";
}

function overlayHasMetric(overlay) {
  if (overlay && overlay.metric_key) return true;
  return metricIsAutoOverlayCandidate(selectOverlayMetricDescriptor(overlay));
}

function candidateMatchesOverlayWindow(candidate, overlay) {
  const { startTime, endTime } = overlayTimes(overlay);
  return candidate.startTime >= startTime - 0.4 && candidate.startTime <= endTime + 0.4;
}

function findUpgradeableOverlay(candidate, overlays, usedIndexes) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < overlays.length; index++) {
    if (usedIndexes.has(index)) continue;
    const overlay = overlays[index];
    if (!overlay || isWarningOverlay(overlay) || overlayHasMetric(overlay)) continue;
    if (!candidateMatchesOverlayWindow(candidate, overlay)) continue;

    const { startTime } = overlayTimes(overlay);
    const distance = Math.abs(candidate.startTime - startTime);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }

  return best;
}

function buildMetricOverlayFromCandidate(baseOverlay, candidate, index) {
  const times = overlayTimes(baseOverlay);
  return {
    ...baseOverlay,
    index: baseOverlay.index ?? index,
    type: "STAT",
    title: formatMetricTitle(candidate.descriptor),
    detail: buildMetricDetail(candidate.sourceText, candidate.descriptor),
    startTime: times.startTime,
    endTime: times.endTime,
    visual_value: Number(baseOverlay.visual_value ?? candidate.score),
    metric_kind: candidate.descriptor.kind,
    metric_key: candidate.key,
    metric_source: "semantic_metric_engine"
  };
}

function findSlot(preferredStart, duration, overlays, options) {
  const gap = options.minOverlayGap;
  let start = Math.max(0, preferredStart);
  for (let attempt = 0; attempt < 12; attempt++) {
    const end = start + duration;
    if (!overlays.some(overlay => overlaps(start, end, overlay, gap))) {
      return { startTime: start, endTime: end };
    }
    start += 0.5;
  }
  return null;
}

function selectOverlayMetricDescriptor(overlay) {
  const title = normalizeText(overlay && (overlay.title ?? overlay.metric));
  const detail = normalizeText(overlay && (overlay.detail ?? overlay.desc ?? overlay.description));
  const rawType = normalizeText(overlay && (overlay.type ?? overlay.visual_type)).toUpperCase();

  const titleMetric = parseOverlayTitle(title);
  if (hasRenderableMetric(titleMetric)) return titleMetric;

  if (rawType === "STAT" || rawType === "COUNTER" || rawType === "NUMBER") {
    const detailMetrics = extractMetricsFromText(detail)
      .filter(metricIsAutoOverlayCandidate)
      .sort((a, b) => metricScore(b) - metricScore(a));
    if (detailMetrics.length) return detailMetrics[0];
  }

  const embedded = extractMetricsFromText(`${title} ${detail}`)
    .filter(metricIsAutoOverlayCandidate)
    .sort((a, b) => metricScore(b) - metricScore(a));
  return embedded[0] || null;
}

export function classifyOverlayType(type, title, detail = "") {
  const rawType = normalizeText(type).toUpperCase();
  if (rawType === "WARNING") return "WARNING";
  if (rawType === "STAT" || rawType === "COUNTER" || rawType === "NUMBER") return "STAT";

  const descriptor = selectOverlayMetricDescriptor({ title, detail, type });
  return metricIsAutoOverlayCandidate(descriptor) ? "STAT" : "ACTION";
}

export function detectMetricCandidatesFromTranscript(cuesOrSentences = []) {
  const candidates = [];

  for (let index = 0; index < cuesOrSentences.length; index++) {
    const cue = cuesOrSentences[index] || {};
    const sourceText = normalizeText(cue.text);
    if (!sourceText) continue;

    const startTime = toSeconds(cue.startTime ?? fromMs(cue.start_ms, 0), 0);
    const endTime = toSeconds(cue.endTime ?? fromMs(cue.end_ms, startTime + 1.0), startTime + 1.0);
    const descriptors = extractMetricsFromText(sourceText)
      .filter(metricIsAutoOverlayCandidate)
      .sort((a, b) => metricScore(b) - metricScore(a));

    for (const descriptor of descriptors) {
      candidates.push({
        descriptor,
        key: metricIdentity(descriptor),
        sourceText,
        sourceIndex: cue.index ?? index,
        startTime,
        endTime: Math.max(endTime, startTime + 0.8),
        score: metricScore(descriptor)
      });
    }
  }

  const seen = new Set();
  return candidates.filter(candidate => {
    const bucket = Math.floor(candidate.startTime / 2);
    const key = `${candidate.key}|${bucket}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function enhanceMetricOverlays(input, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const sentences = Array.isArray(input && input.sentences) ? input.sentences : [];
  const sourceCues = Array.isArray(input && input.cues) && input.cues.length ? input.cues : sentences;
  const existing = Array.isArray(input && input.overlays) ? input.overlays : [];

  const overlays = existing.map((overlay, index) => {
    const descriptor = selectOverlayMetricDescriptor(overlay);
    const rawType = normalizeText(overlay && (overlay.type ?? overlay.visual_type)).toUpperCase();
    if (!metricIsAutoOverlayCandidate(descriptor)) {
      return { ...overlay };
    }

    return {
      ...overlay,
      index: overlay.index ?? index,
      type: rawType === "WARNING" ? "WARNING" : "STAT",
      title: formatMetricTitle(descriptor),
      detail: normalizeText(overlay.detail ?? overlay.desc ?? overlay.description) || buildMetricDetail("", descriptor),
      metric_kind: descriptor.kind,
      metric_key: metricIdentity(descriptor),
      visual_value: Number(overlay.visual_value ?? metricScore(descriptor))
    };
  });

  const existingMetricKeys = new Set(
    overlays
      .map(overlay => overlay.metric_key || metricIdentity(selectOverlayMetricDescriptor(overlay)))
      .filter(Boolean)
  );

  const candidates = detectMetricCandidatesFromTranscript(sourceCues)
    .filter(candidate => !existingMetricKeys.has(candidate.key))
    .sort((a, b) => b.score - a.score || a.startTime - b.startTime);

  let upgraded = 0;
  const usedOverlayIndexes = new Set();
  if (config.upgradeExistingOverlays) {
    for (const candidate of candidates.slice().sort((a, b) => a.startTime - b.startTime || b.score - a.score)) {
      if (existingMetricKeys.has(candidate.key)) continue;
      const targetIndex = findUpgradeableOverlay(candidate, overlays, usedOverlayIndexes);
      if (targetIndex == null) continue;

      overlays[targetIndex] = buildMetricOverlayFromCandidate(overlays[targetIndex], candidate, targetIndex);
      usedOverlayIndexes.add(targetIndex);
      existingMetricKeys.add(candidate.key);
      upgraded++;
    }
  }

  let added = 0;
  for (const candidate of candidates) {
    if (existingMetricKeys.has(candidate.key)) continue;
    if (added >= config.maxAutoMetricOverlays) break;
    const slot = findSlot(candidate.startTime, config.metricDuration, overlays, config);
    if (!slot) continue;

    overlays.push({
      index: overlays.length,
      type: "STAT",
      title: formatMetricTitle(candidate.descriptor),
      detail: buildMetricDetail(candidate.sourceText, candidate.descriptor),
      startTime: slot.startTime,
      endTime: slot.endTime,
      visual_value: candidate.score,
      metric_kind: candidate.descriptor.kind,
      metric_key: candidate.key,
      metric_source: "semantic_metric_engine"
    });

    existingMetricKeys.add(candidate.key);
    added++;
  }

  overlays.sort((a, b) => overlayTimes(a).startTime - overlayTimes(b).startTime);

  return {
    sentences,
    overlays,
    metricSummary: {
      detected: candidates.length,
      added,
      upgraded,
      existingMetricOverlays: existingMetricKeys.size
    }
  };
}
