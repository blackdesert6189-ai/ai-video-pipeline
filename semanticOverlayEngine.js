import {
  extractMetricsFromText,
  formatMetricTitle,
  hasRenderableMetric,
  metricIdentity,
  parseOverlayTitle
} from "./metricParser.js";

import { resolveArchetype, defaultPatternFor } from "./archetypeRegistry.js";

const DEFAULT_OPTIONS = {
  maxAutoMetricOverlays: 10,
  metricDuration: 3.8,
  minOverlayGap: 0.75,
  contextWindow: 3.2,
  semanticDedupeWindow: 14,
  upgradeExistingOverlays: true
};

const SEMANTIC_INTENTS = {
  animatedMetric:     "animated_metric",
  rangeMetric:        "range_metric",
  timelineProgression:"timeline_progression",
  movement:           "movement_guidance",
  warning:            "warning",
  action:             "action"
};

const HEALTH_TERM_CORRECTIONS = [
  { pattern: /\bglucose\s*4\b/giu, replacement: "GLUT4" },
  { pattern: /\bgluco\s*4\b/giu,   replacement: "GLUT4" },
  { pattern: /\bgluco\b/giu,        replacement: "glucose" },
  { pattern: /\bdivert\b/giu,       replacement: "dồn" },
  { pattern: /\bcapone\s+harris\b/giu, replacement: "carbohydrate" },
  { pattern: /\bcarbon\s+harris\b/giu, replacement: "carbohydrate" },
  { pattern: /\bcarb(?:one|on)?\s+harris\b/giu, replacement: "carbohydrate" }
];

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

function foldText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function applyHealthTermCorrections(value) {
  let text = normalizeText(value);
  for (const correction of HEALTH_TERM_CORRECTIONS) {
    text = text.replace(correction.pattern, correction.replacement);
  }
  return text;
}

function splitWords(text) {
  return normalizeText(text)
    .replace(/[.,;:!?()[\]{}"']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function clampWords(text, maxWords = 8) {
  return splitWords(text).slice(0, maxWords).join(" ");
}

function stripMetricFromText(text, descriptor) {
  if (!descriptor || !descriptor.raw) return normalizeText(text);
  return normalizeText(text).replace(descriptor.raw, " ").replace(/\s+/g, " ").trim();
}

function uppercaseText(text) {
  return normalizeText(text).toUpperCase();
}

function stripOverlayLabelPrefix(text) {
  return normalizeText(text).replace(/^(cảnh báo|canh bao|hành động|hanh dong|lợi ích|loi ich|cơ chế|co che)\s*[:\-–]?\s*/iu, "");
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

function sourceTimes(source) {
  const startTime = toSeconds(source.startTime ?? fromMs(source.start_ms, 0), 0);
  const endTime = toSeconds(source.endTime ?? fromMs(source.end_ms, startTime + 1.0), startTime + 1.0);
  return { startTime, endTime: Math.max(endTime, startTime + 0.2) };
}

function contextForTime(sources, startTime, endTime, windowSec) {
  const pieces = [];
  for (const source of sources) {
    const times = sourceTimes(source);
    if (times.endTime >= startTime - windowSec && times.startTime <= endTime + windowSec) {
      pieces.push(applyHealthTermCorrections(source.text));
    }
  }
  return normalizeText(pieces.join(" "));
}

function metricIsVisualCandidate(descriptor) {
  if (!hasRenderableMetric(descriptor)) return false;
  if (descriptor.kind === "text_metric") return false;
  return !!(descriptor.unit && descriptor.unit.symbol) ||
    descriptor.kind === "range_value" ||
    descriptor.kind === "comparison_value";
}

function isCountUpMetric(descriptor) {
  return !!descriptor && (
    descriptor.kind === "single_value" ||
    descriptor.kind === "comparison_value"
  );
}

function isTimeRangeMetric(descriptor) {
  return !!descriptor &&
    descriptor.kind === "range_value" &&
    descriptor.unit &&
    descriptor.unit.type === "time";
}

function shouldPromoteContextTimeMetric(context, descriptor) {
  if (!isTimeRangeMetric(descriptor)) return false;
  const flags = detectContextFlags(context);
  return flags.hasAfterMeal ||
    flags.hasMovement ||
    flags.hasMinimumTime ||
    flags.hasOptimalTime;
}

function metricScore(descriptor) {
  if (!descriptor) return 0;
  let score = 0;
  if (descriptor.kind === "single_value")    score += 40;
  if (descriptor.kind === "range_value")     score += 38;
  if (descriptor.kind === "comparison_value") score += 36;
  if (descriptor.unit && descriptor.unit.symbol) score += 20;
  if (descriptor.unit && descriptor.unit.type !== "count") score += 10;
  if (descriptor.kind === "text_metric") score -= 100;
  return score;
}

function selectMetricDescriptor(text) {
  const direct = parseOverlayTitle(text);
  if (metricIsVisualCandidate(direct)) return direct;

  const metrics = extractMetricsFromText(text)
    .filter(metricIsVisualCandidate)
    .sort((a, b) => metricScore(b) - metricScore(a));
  return metrics[0] || null;
}

function detectContextFlags(context) {
  const folded = foldText(context);
  return {
    hasMovement:    /\b(di bo|van dong|co bap|co bop|di nhe|chay bo|cardio|cuong do|toc do)\b/.test(folded),
    hasAfterMeal:   /\b(sau an|sau bua an|sau khi an|bua an|thuc an)\b/.test(folded),
    hasDigestion:   /\b(da day|tieu hoa|duong tieu hoa|kho tieu|day hoi|bua an|thuc an)\b/.test(folded),
    hasMinimumTime: /\b(toi thieu|it nhat|chi can|du roi|muc toi thieu|thoi gian toi thieu)\b/.test(folded),
    hasOptimalTime: /\b(toi uu|tot nhat|ly tuong|hieu qua nhat|khuyen nghi|nen duy tri|thoi gian vang)\b/.test(folded),
    hasBenefit:     /\b(loi ich|giup|cai thien|tot hon|on dinh|kiem soat|ho tro|toi uu|giam|hieu qua)\b/.test(folded),
    hasRisk:        /\b(qua manh|qua nhanh|kho tieu|chuot rut|nguy co|sai lam|khong nen|gay kho|dau bung|mat nuoc|tranh\s+(?:van dong|tap|di bo|chay|cuong do))\b/.test(folded),
    hasWarning:     /\b(qua manh|qua nhanh|kho tieu|chuot rut|nguy co|sai lam|khong nen|gay kho|dau bung|mat nuoc|tranh\s+(?:van dong|tap|di bo|chay|cuong do))\b/.test(folded)
  };
}

function timelineVariantFor(text, descriptor) {
  const flags = detectContextFlags(text);
  const startValue = descriptor && Number.isFinite(Number(descriptor.valueFrom))
    ? Number(descriptor.valueFrom) : null;
  const endValue = descriptor && Number.isFinite(Number(descriptor.valueTo))
    ? Number(descriptor.valueTo) : null;

  if (flags.hasMinimumTime) return "minimum_time";
  if (flags.hasOptimalTime) return "optimal_time";

  if ((flags.hasMovement || flags.hasAfterMeal) && startValue != null) {
    if (flags.hasAfterMeal && endValue != null && endValue >= 30) return "optimal_time";
    if (startValue <= 10 || (endValue != null && endValue <= 15)) return "minimum_time";
    if (startValue >= 15) return "optimal_time";
  }

  const folded = foldText(text);
  if (/\b(sau an|sau bua an|sau khi an)\b/.test(folded) && /\b(du|chi can)\b/.test(folded)) {
    return "minimum_time";
  }

  return "range_time";
}

// Maps Gemini archetype → semantic intent + overlay metadata
function resolveArchetypeToVisual(archetype, descriptor, text) {
  switch (normalizeText(archetype).toUpperCase()) {
    case "MECHANISM":
      return {
        intent: SEMANTIC_INTENTS.action,
        visualType: "action_card",
        overlayType: "ACTION",
        badgeLabel: "CƠ CHẾ",
        semanticVariant: null
      };
    case "BENEFIT":
      return {
        intent: SEMANTIC_INTENTS.action,
        visualType: "action_card",
        overlayType: "ACTION",
        badgeLabel: "LỢI ÍCH",
        semanticVariant: null
      };
    case "WARNING":
      return {
        intent: SEMANTIC_INTENTS.warning,
        visualType: "alert_card",
        overlayType: "WARNING",
        badgeLabel: "CẢNH BÁO",
        semanticVariant: null
      };
    case "TIMELINE":
      return {
        intent: SEMANTIC_INTENTS.timelineProgression,
        visualType: "timeline_progression",
        overlayType: "STAT",
        badgeLabel: null,
        semanticVariant: descriptor ? timelineVariantFor(text || "", descriptor) : null
      };
    case "METRIC":
      if (descriptor && isTimeRangeMetric(descriptor)) {
        return {
          intent: SEMANTIC_INTENTS.rangeMetric,
          visualType: "static_metric_range",
          overlayType: "STAT",
          badgeLabel: null,
          semanticVariant: null
        };
      }
      return {
        intent: SEMANTIC_INTENTS.animatedMetric,
        visualType: "animated_metric_counter",
        overlayType: "STAT",
        badgeLabel: null,
        semanticVariant: null
      };
    case "ACTION":
      return {
        intent: SEMANTIC_INTENTS.action,
        visualType: "action_card",
        overlayType: "ACTION",
        badgeLabel: "HÀNH ĐỘNG",
        semanticVariant: null
      };
    case "INGREDIENT":
      return {
        intent: SEMANTIC_INTENTS.action,
        visualType: "action_card",
        overlayType: "ACTION",
        badgeLabel: "THÀNH PHẦN",
        semanticVariant: null
      };
    case "PROCESS":
      return {
        intent: SEMANTIC_INTENTS.movement,
        visualType: "movement_guidance",
        overlayType: "ACTION",
        badgeLabel: "QUÁ TRÌNH",
        semanticVariant: null
      };
    case "COMPARISON":
      return {
        intent: SEMANTIC_INTENTS.action,
        visualType: "action_card",
        overlayType: "ACTION",
        badgeLabel: "SO SÁNH",
        semanticVariant: null
      };
    case "TRANSFORMATION":
      return {
        intent: SEMANTIC_INTENTS.action,
        visualType: "action_card",
        overlayType: "ACTION",
        badgeLabel: "THAY ĐỔI",
        semanticVariant: null
      };
    default:
      return null;
  }
}

function classifySemanticIntent({ type, title, detail, context, descriptor, archetype }) {
  const rawType = normalizeText(type).toUpperCase();
  const text = `${title} ${detail} ${context}`;
  const flags = detectContextFlags(text);

  if (archetype) {
    const resolved = resolveArchetypeToVisual(archetype, descriptor, text);
    if (resolved) return resolved;
  }

  const benefitNegatesRisk = /\b(giam|bot|cai thien|ho tro|tranh|han che|it bi|giup)\b.{0,56}\b(kho tieu|day hoi|buon ngu|tieu hoa kem|viem|nguy co|mo thua)\b/.test(foldText(text));
  const shouldWarn = flags.hasRisk && !benefitNegatesRisk;

  if (shouldWarn) {
    return {
      intent: SEMANTIC_INTENTS.warning,
      visualType: "alert_card",
      overlayType: "WARNING",
      badgeLabel: "CẢNH BÁO",
      semanticVariant: null
    };
  }

  if (descriptor && isTimeRangeMetric(descriptor) && (flags.hasMovement || flags.hasAfterMeal || flags.hasMinimumTime || flags.hasOptimalTime)) {
    return {
      intent: SEMANTIC_INTENTS.timelineProgression,
      visualType: "timeline_progression",
      overlayType: "STAT",
      badgeLabel: null,
      semanticVariant: timelineVariantFor(text, descriptor)
    };
  }

  if (descriptor && isCountUpMetric(descriptor)) {
    return {
      intent: SEMANTIC_INTENTS.animatedMetric,
      visualType: "animated_metric_counter",
      overlayType: "STAT",
      badgeLabel: null,
      semanticVariant: null
    };
  }

  if (flags.hasMovement) {
    return {
      intent: SEMANTIC_INTENTS.movement,
      visualType: "movement_guidance",
      overlayType: "ACTION",
      badgeLabel: "VẬN ĐỘNG",
      semanticVariant: null
    };
  }

  if (descriptor) {
    if (descriptor.kind === "range_value") {
      const isTimeRange = descriptor.unit && descriptor.unit.type === "time";
      return {
        intent: isTimeRange ? SEMANTIC_INTENTS.timelineProgression : SEMANTIC_INTENTS.rangeMetric,
        visualType: isTimeRange ? "timeline_progression" : "static_metric_range",
        overlayType: "STAT",
        badgeLabel: null,
        semanticVariant: isTimeRange ? timelineVariantFor(text, descriptor) : null
      };
    }
    return {
      intent: SEMANTIC_INTENTS.animatedMetric,
      visualType: "animated_metric_counter",
      overlayType: "STAT",
      badgeLabel: null,
      semanticVariant: null
    };
  }

  return {
    intent: SEMANTIC_INTENTS.action,
    visualType: "action_card",
    overlayType: rawType === "STAT" ? "STAT" : "ACTION",
    badgeLabel: rawType === "ACTION" ? "HÀNH ĐỘNG" : null,
    semanticVariant: null
  };
}

function buildTitle({ title, context, descriptor, semantic, archetype }) {
  const correctedTitle = stripOverlayLabelPrefix(applyHealthTermCorrections(title));

  // Gemini-provided archetype: use Gemini's title directly, only format STAT
  if (archetype && correctedTitle) {
    if (descriptor && semantic.overlayType === "STAT") {
      return formatMetricTitle(descriptor);
    }
    return correctedTitle;
  }

  // Auto-detected overlays: apply semantic title logic
  if (descriptor && semantic.overlayType === "STAT") {
    return formatMetricTitle(descriptor);
  }

  if (semantic.visualType === "timeline_progression") {
    const folded = foldText(`${correctedTitle} ${context}`);
    if (folded.includes("sau an") || folded.includes("sau bua an") || folded.includes("sau khi an")) {
      return "ĐI BỘ SAU ĂN";
    }
    return correctedTitle || "THỜI GIAN";
  }

  if (semantic.intent === SEMANTIC_INTENTS.movement) {
    const folded = foldText(`${correctedTitle} ${context}`);
    if (folded.includes("sau an") || folded.includes("sau bua an") || folded.includes("sau khi an")) {
      return "ĐI BỘ SAU ĂN";
    }
    if (folded.includes("qua manh") || folded.includes("qua nhanh")) {
      return "VẬN ĐỘNG QUÁ MẠNH";
    }
    return correctedTitle || "VẬN ĐỘNG NHẸ";
  }

  return correctedTitle;
}

function buildDetail({ detail, context, descriptor, semantic, archetype }) {
  const correctedDetail = applyHealthTermCorrections(detail);
  const contextText = applyHealthTermCorrections(context);
  const flags = detectContextFlags(`${correctedDetail} ${contextText}`);

  // Gemini-provided archetype: use Gemini's detail directly, only format STAT
  if (archetype && correctedDetail) {
    if (descriptor && semantic.overlayType === "STAT") {
      const stripped = stripMetricFromText(contextText || correctedDetail, descriptor);
      return uppercaseText(clampWords(stripped, 8) || "CHỈ SỐ SỨC KHỎE");
    }
    return correctedDetail;
  }

  if (descriptor && semantic.overlayType === "STAT") {
    const stripped = stripMetricFromText(contextText || correctedDetail, descriptor);
    return uppercaseText(clampWords(stripped, 8) || "CHỈ SỐ SỨC KHỎE");
  }

  if (semantic.visualType === "timeline_progression") {
    const folded = foldText(contextText);
    const variant = semantic.semanticVariant || timelineVariantFor(`${correctedDetail} ${contextText}`, descriptor);
    if (flags.hasAfterMeal || folded.includes("sau an") || folded.includes("sau bua an") || folded.includes("sau khi an")) {
      if (variant === "minimum_time") return "THỜI GIAN TỐI THIỂU SAU ĂN";
      if (variant === "optimal_time") return "SAU KHI ĂN XONG";
      return "ĐI BỘ NHẸ SAU KHI ĂN";
    }
    if (variant === "minimum_time") return "THỜI GIAN TỐI THIỂU";
    return "THỜI GIAN TỐI ƯU";
  }

  if (semantic.intent === SEMANTIC_INTENTS.warning && flags.hasMovement && flags.hasDigestion) {
    return "MÁU DỒN RA CƠ BẮP, DẠ DÀY TIÊU HÓA KÉM";
  }

  if (semantic.intent === SEMANTIC_INTENTS.movement) {
    const stripped = descriptor ? stripMetricFromText(contextText, descriptor) : contextText;
    return uppercaseText(clampWords(stripped || correctedDetail, 8));
  }

  return correctedDetail;
}

function normalizeSentenceTerms(sentence, index) {
  const text = applyHealthTermCorrections(sentence.text);
  return { ...sentence, index: sentence.index ?? index, text, words: splitWords(text) };
}

function semanticOverlayFromExisting(overlay, index, sources, options) {
  const correctedTitle  = applyHealthTermCorrections(overlay.title ?? overlay.metric ?? "");
  const correctedDetail = applyHealthTermCorrections(overlay.detail ?? overlay.desc ?? overlay.description ?? "");
  const times           = overlayTimes(overlay);
  const context         = contextForTime(sources, times.startTime, times.endTime, options.contextWindow);
  const rawType         = normalizeText(overlay.type ?? overlay.visual_type).toUpperCase();
  const geminiArchetype = normalizeText(overlay.archetype || "").toUpperCase() || null;
  const directDescriptor  = selectMetricDescriptor(`${correctedTitle} ${correctedDetail}`);
  const contextDescriptor = selectMetricDescriptor(context);
  const descriptor = directDescriptor ||
    (shouldPromoteContextTimeMetric(context, contextDescriptor)
      ? contextDescriptor
      : rawType === "STAT" ? contextDescriptor : null);

  const semantic = classifySemanticIntent({
    type: overlay.type ?? overlay.visual_type,
    title: correctedTitle,
    detail: correctedDetail,
    context,
    descriptor,
    archetype: geminiArchetype
  });

  // Archetype and pattern: Gemini-provided archetype takes priority over visual_type lookup
  const resolvedArchetype = geminiArchetype
    || resolveArchetype(semantic.visualType)?.archetype
    || null;
  const resolvedPattern = geminiArchetype
    ? (semantic.overlayType === "WARNING" ? "ALERT" : defaultPatternFor(geminiArchetype))
    : (resolveArchetype(semantic.visualType)?.pattern ?? null);

  return {
    ...overlay,
    index:               overlay.index ?? index,
    type:                semantic.overlayType,
    title:               buildTitle({ title: correctedTitle, detail: correctedDetail, context, descriptor, semantic, archetype: geminiArchetype }),
    detail:              buildDetail({ title: correctedTitle, detail: correctedDetail, context, descriptor, semantic, archetype: geminiArchetype }),
    startTime:           times.startTime,
    endTime:             times.endTime,
    visual_value:        Number(overlay.visual_value ?? metricScore(descriptor)),
    metric_kind:         descriptor ? descriptor.kind : overlay.metric_kind,
    metric_key:          descriptor ? metricIdentity(descriptor) : overlay.metric_key,
    semantic_intent:     semantic.intent,
    semantic_visual_type: semantic.visualType,
    semantic_variant:    semantic.semanticVariant || overlay.semantic_variant || null,
    badgeLabel:          semantic.badgeLabel,
    archetype:           resolvedArchetype,
    pattern:             resolvedPattern
  };
}

export function detectMetricCandidatesFromTranscript(cuesOrSentences = []) {
  const candidates = [];
  for (let index = 0; index < cuesOrSentences.length; index++) {
    const cue = cuesOrSentences[index] || {};
    const sourceText = applyHealthTermCorrections(cue.text);
    if (!sourceText) continue;
    const times = sourceTimes(cue);
    const descriptors = extractMetricsFromText(sourceText)
      .filter(metricIsVisualCandidate)
      .sort((a, b) => metricScore(b) - metricScore(a));

    for (const descriptor of descriptors) {
      const semantic = classifySemanticIntent({
        title: formatMetricTitle(descriptor),
        detail: sourceText,
        context: sourceText,
        descriptor
      });
      candidates.push({
        descriptor,
        semantic,
        key: metricIdentity(descriptor),
        sourceText,
        sourceIndex: cue.index ?? index,
        startTime: times.startTime,
        endTime: Math.max(times.endTime, times.startTime + 0.8),
        score: metricScore(descriptor)
      });
    }
  }

  const seen = new Set();
  return candidates.filter(candidate => {
    const key = `${candidate.key}|${Math.floor(candidate.startTime / 2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function overlaps(aStart, aEnd, overlay, gap) {
  const { startTime, endTime } = overlayTimes(overlay);
  return aStart < endTime + gap && aEnd + gap > startTime;
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

function buildAutoMetricOverlay(candidate, slot, index) {
  const legacyResolved = resolveArchetype(candidate.semantic.visualType);
  return {
    index,
    type:                candidate.semantic.overlayType,
    title:               buildTitle({ title: formatMetricTitle(candidate.descriptor), context: candidate.sourceText, descriptor: candidate.descriptor, semantic: candidate.semantic }),
    detail:              buildDetail({ detail: "", context: candidate.sourceText, descriptor: candidate.descriptor, semantic: candidate.semantic }),
    startTime:           slot.startTime,
    endTime:             slot.endTime,
    visual_value:        candidate.score,
    metric_kind:         candidate.descriptor.kind,
    metric_key:          candidate.key,
    semantic_intent:     candidate.semantic.intent,
    semantic_visual_type: candidate.semantic.visualType,
    semantic_variant:    candidate.semantic.semanticVariant || null,
    badgeLabel:          candidate.semantic.badgeLabel,
    metric_source:       "semantic_overlay_engine",
    archetype:           legacyResolved?.archetype ?? null,
    pattern:             legacyResolved?.pattern ?? null
  };
}

function semanticClusterKey(overlay) {
  const visualType = normalizeText(overlay.semantic_visual_type || "");
  if (!visualType || visualType === "action_card") return null;

  const variant   = normalizeText(overlay.semantic_variant || "");
  const metricKey = normalizeText(overlay.metric_key || "");

  if (visualType === "timeline_progression") {
    return `timeline|${variant || "range"}|${metricKey || foldText(overlay.title)}`;
  }
  if (visualType === "alert_card") {
    return `alert|${variant || foldText(overlay.title)}`;
  }
  return `${visualType}|${variant || foldText(overlay.title)}`;
}

function overlaySemanticPriority(overlay) {
  let score = Number(overlay.visual_value || 0);
  const visualType = normalizeText(overlay.semantic_visual_type || "");
  const variant    = normalizeText(overlay.semantic_variant || "");

  if (visualType === "timeline_progression")    score += 80;
  if (visualType === "animated_metric_counter") score += 75;
  if (visualType === "static_metric_range")     score += 68;
  if (variant === "optimal_time")               score += 12;
  if (overlay.metric_source === "semantic_overlay_engine") score += 4;
  return score;
}

function dedupeSemanticOverlays(overlays, options) {
  const dedupeWindow = Number(options.semanticDedupeWindow || DEFAULT_OPTIONS.semanticDedupeWindow);
  const kept = [];

  for (const overlay of overlays) {
    const key   = semanticClusterKey(overlay);
    const times = overlayTimes(overlay);
    if (!key) {
      kept.push(overlay);
      continue;
    }

    const duplicateIndex = kept.findIndex((candidate) => {
      const candidateKey = semanticClusterKey(candidate);
      if (candidateKey !== key) return false;
      const candidateTimes = overlayTimes(candidate);
      const distance = Math.abs(times.startTime - candidateTimes.startTime);
      return distance <= dedupeWindow || overlaps(times.startTime, times.endTime, candidate, dedupeWindow * 0.25);
    });

    if (duplicateIndex === -1) {
      kept.push(overlay);
      continue;
    }

    const existing = kept[duplicateIndex];
    if (overlaySemanticPriority(overlay) > overlaySemanticPriority(existing)) {
      kept[duplicateIndex] = overlay;
    }
  }

  return kept.sort((a, b) => overlayTimes(a).startTime - overlayTimes(b).startTime);
}

export function classifyOverlayType(type, title, detail = "") {
  const descriptor = selectMetricDescriptor(`${title} ${detail}`);
  return classifySemanticIntent({ type, title, detail, context: `${title} ${detail}`, descriptor }).overlayType;
}

export function enhanceSemanticOverlays(input, options = {}) {
  const config       = { ...DEFAULT_OPTIONS, ...options };
  const rawSentences = Array.isArray(input && input.sentences) ? input.sentences : [];
  const sentences    = rawSentences.map(normalizeSentenceTerms);
  const sourceCues   = Array.isArray(input && input.cues) && input.cues.length
    ? input.cues.map(normalizeSentenceTerms)
    : sentences;
  const existing = Array.isArray(input && input.overlays) ? input.overlays : [];

  let overlays = existing.map((overlay, index) => semanticOverlayFromExisting(overlay, index, sourceCues, config));
  const existingMetricKeys = new Set(overlays.map(overlay => overlay.metric_key).filter(Boolean));

  const candidates = detectMetricCandidatesFromTranscript(sourceCues)
    .filter(candidate => !existingMetricKeys.has(candidate.key))
    .filter(candidate => !overlays.some(overlay => overlaps(candidate.startTime, candidate.endTime, overlay, config.minOverlayGap)))
    .sort((a, b) => b.score - a.score || a.startTime - b.startTime);

  let added = 0;
  for (const candidate of candidates) {
    if (added >= config.maxAutoMetricOverlays) break;
    const slot = findSlot(candidate.startTime, config.metricDuration, overlays, config);
    if (!slot) continue;
    overlays.push(buildAutoMetricOverlay(candidate, slot, overlays.length));
    existingMetricKeys.add(candidate.key);
    added++;
  }

  overlays = dedupeSemanticOverlays(overlays, config);

  return {
    sentences,
    overlays,
    semanticSummary: {
      detectedMetrics: candidates.length,
      added,
      overlayCount: overlays.length,
      intents: overlays.reduce((acc, overlay) => {
        const key = overlay.semantic_intent || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    }
  };
}

export function enhanceMetricOverlays(input, options = {}) {
  return enhanceSemanticOverlays(input, options);
}

export function analyzeSemanticText(text) {
  const corrected  = applyHealthTermCorrections(text);
  const descriptor = selectMetricDescriptor(corrected);
  const semantic   = classifySemanticIntent({
    title: corrected, detail: "", context: corrected, descriptor
  });
  return {
    text:                corrected,
    descriptor,
    semantic_intent:     semantic.intent,
    semantic_visual_type: semantic.visualType,
    semantic_variant:    semantic.semanticVariant || null,
    overlayType:         semantic.overlayType,
    badgeLabel:          semantic.badgeLabel
  };
}
