/**
 * metricParser.js — CNFI Semantic Overlay Library
 * Universal Metric Parser: detects and classifies numeric/metric expressions
 * from any Vietnamese health/fitness transcript or overlay text.
 *
 * Metric types:
 *   single_value   — "21%", "150 kcal", "8000 bước", "120 bpm"
 *   range_value    — "5-10kg", "10-15 phút", "120-140 bpm"
 *   comparison_value — ">10.000 bước", "<20g đường", "~30 phút"
 *   text_metric    — labels/scales that contain digits but should not animate
 *                    e.g. "Zone 2", "15-30" (already text in title context)
 */

// ─────────────────────────────────────────────────────────────
// UNIT REGISTRY — add new units here as needed
// ─────────────────────────────────────────────────────────────
const UNIT_PATTERNS = [
  // Percentage
  { symbol: "%",          type: "percent",   regex: /(%)/        },
  // Energy / nutrition
  { symbol: "kcal",       type: "energy",    regex: /(kcal)/i    },
  { symbol: "calo",       type: "energy",    regex: /(calo)/i    },
  { symbol: "cal",        type: "energy",    regex: /(cal)(?!o)/i },
  { symbol: "kJ",         type: "energy",    regex: /(kJ)/       },
  { symbol: "ml",         type: "volume",    regex: /\b(ml)\b/i   },
  { symbol: "lít",        type: "volume",    regex: /\b(lít|lit|liter|litre)\b/i },
  { symbol: "g",          type: "weight_sm", regex: /(g)(?!r|kg|mg)/  },
  { symbol: "mg",         type: "weight_sm", regex: /(mg)/       },
  { symbol: "mcg",        type: "weight_sm", regex: /(mcg|µg)/   },
  // Body / scale
  { symbol: "kg",         type: "weight",    regex: /(kg)/i      },
  { symbol: "lbs",        type: "weight",    regex: /(lbs?)/i    },
  { symbol: "cm",         type: "length",    regex: /(cm)/i      },
  // Cardio / vitals
  { symbol: "bpm",        type: "heart",     regex: /(bpm)/i     },
  { symbol: "mmHg",       type: "pressure",  regex: /(mmHg)/i    },
  // Time
  { symbol: "giờ",        type: "time",      regex: /(giờ)/i     },
  { symbol: "phút",       type: "time",      regex: /(phút)/i    },
  { symbol: "giây",       type: "time",      regex: /(giây)/i    },
  { symbol: "ngày",       type: "time",      regex: /(ngày)/i    },
  { symbol: "tuần",       type: "time",      regex: /(tuần)/i    },
  { symbol: "tháng",      type: "time",      regex: /(tháng)/i   },
  // Movement
  { symbol: "bước",       type: "steps",     regex: /(bước)/i    },
  { symbol: "km",         type: "distance",  regex: /(km)/i      },
  { symbol: "m",          type: "distance",  regex: /(\bm\b)/    },
  // Score / generic health points
  { symbol: "điểm",       type: "score",     regex: /(điểm|diem)/i },
  // Hormones / bio markers (text context — often text_metric)
  { symbol: "mmol/L",     type: "bio",       regex: /(mmol\/L)/i },
  { symbol: "mg/dL",      type: "bio",       regex: /(mg\/dL)/i  },
  { symbol: "IU",         type: "bio",       regex: /(IU)/       },
  // Dimensionless (pure number, no unit)
  { symbol: "",           type: "count",     regex: null         },
];

// ─────────────────────────────────────────────────────────────
// TEXT_METRIC GUARDS — patterns that look numeric but should
// never be animated (zone labels, model names, ratios, etc.)
// ─────────────────────────────────────────────────────────────
const TEXT_METRIC_GUARDS = [
  // Zone labels — match "zone 2", "ZONE 2", "Zone 3", etc.
  // Use case-insensitive and match whole-string or word-boundary patterns
  /^zone\s*\d/i,                  // Zone 2, ZONE 2 (as full title)
  /\bzone\s*\d/i,                 // Zone 2 inside longer text
  /\bphase\s*\d/i,                // Phase 1
  /\bstep\s*\d/i,                 // Step 1
  /\bv\d+(\.\d+)?\b/i,            // v1, v2.0
  /\b\d+:\d+(:\d+)?\b/,           // 3:1 ratio, 00:30:00 timestamp
  /^\s*\d{1,2}[\.\)]\s/,          // "1. " or "1) " list prefix
  /\b(type|loại)\s*\d/i,          // Type 2 (diabetes)
  /\bomega[-–]\d/i,               // Omega-3, Omega-6
  // Vitamin: only guard when vitamin word comes BEFORE any digit in the string
  // "Vitamin B12" → text_metric; "50 IU vitamin D" → single_value (IU is the unit)
  /^vitamin\s+[a-z]\d*/i,         // "Vitamin B12" as full string
  /\bvitamin\s+[a-z]\d+\b/i,      // "Vitamin B12" embedded (must have trailing digit)
  /\bglut\s*4\b/i,                // GLUT4 is a transporter concept, not numeric metric 4
  /\bglucose\s*4\b/i,             // ASR often mishears GLUT4 as glucose 4
  /\biso\s*\d/i,                  // ISO 9001
];

// ─────────────────────────────────────────────────────────────
// CORE REGEX PATTERNS
// Built dynamically so unit list is the single source of truth.
// ─────────────────────────────────────────────────────────────

// Number token: handles separators common in Vietnamese (10.000, 1.5, 1,5)
// Matches: integers, decimals with dot/comma, thousands with dot
const NUM = `(?:\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d+)?)`;

// Comparator prefix: >, <, >=, <=, ≥, ≤, ~, ≈
const CMP = `(?:>=|<=|[><=~≥≤≈])\\s*`;

// Unit suffix built from registry (longest match first)
const unitAlternatives = UNIT_PATTERNS
  .filter(u => u.regex !== null)
  .sort((a, b) => b.symbol.length - a.symbol.length)
  .map(u => u.regex.source.replace(/^\(/, "(?:").replace(/\)$/, ")"))
  .join("|");

// Separator between range numbers: hyphen variants, "đến", "tới", "to"
const SEP = `(?:\\s*[-–—]\\s*|\\s+(?:đến|tới|to)\\s+)`;

// Full composed regexes
const REGEX_RANGE       = new RegExp(
  `(${CMP})?` +                        // optional comparator
  `(${NUM})` +                          // first number
  `(${SEP})` +                          // separator
  `(${NUM})` +                          // second number
  `\\s*` +
  `(${unitAlternatives})?`,             // optional unit — no lookahead, greedy capture
  "iu"
);

const REGEX_SINGLE      = new RegExp(
  `(${CMP})?` +                         // optional comparator
  `(${NUM})` +                           // number
  `\\s*` +
  `(${unitAlternatives})?`,              // optional unit — no lookahead, greedy capture
  "iu"
);

// ─────────────────────────────────────────────────────────────
// HELPER: parse a Vietnamese/international number string → float
// ─────────────────────────────────────────────────────────────
function parseViNumber(str) {
  if (!str) return NaN;
  const s = str.trim();
  // "10.000" → thousands separator → 10000
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    return parseFloat(s.replace(/\./g, ""));
  }
  // "1,5" or "1.5" → decimal
  return parseFloat(s.replace(",", "."));
}

function normalizeAscii(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function splitCompactRangeDigits(digits) {
  if (!/^\d{3,4}$/.test(digits)) return null;

  const left = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
  const right = digits.length === 3 ? digits.slice(1) : digits.slice(2);
  const from = Number(left);
  const to = Number(right);

  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from <= 0 || to <= 0 || from >= to) return null;
  if (to > 90) return null;

  return { displayFrom: String(from), displayTo: String(to), valueFrom: from, valueTo: to };
}

function parseCompactRange(text) {
  const compactRangePattern = new RegExp(
    `^\\s*(${CMP})?` +
    `(\\d{3,4})` +
    `\\s*` +
    `(${unitAlternatives})` +
    `\\s*$`,
    "iu"
  );

  const match = compactRangePattern.exec(text);
  if (!match) return null;

  const [, comparator, digits, unitStr] = match;
  if (comparator) return null;

  const unit = resolveUnit(unitStr);
  const normalizedUnit = normalizeAscii(unit.symbol || unitStr);
  const isTimeRange = unit.type === "time" || /^(phut|gio|giay|ngay|tuan|thang)$/.test(normalizedUnit);
  if (!isTimeRange) return null;

  const split = splitCompactRangeDigits(digits);
  if (!split) return null;

  return {
    raw: text.trim(),
    kind: "range_value",
    comparator: null,
    valueFrom: split.valueFrom,
    valueTo: split.valueTo,
    unit,
    displayFrom: split.displayFrom,
    displayTo: split.displayTo,
    separator: "-"
  };
}

// ─────────────────────────────────────────────────────────────
// HELPER: resolve unit symbol from matched string
// ─────────────────────────────────────────────────────────────
function resolveUnit(matchedUnit) {
  if (!matchedUnit) return { symbol: "", type: "count" };
  const raw = matchedUnit.trim();
  const candidates = UNIT_PATTERNS
    .filter(u => u.regex)
    .sort((a, b) => b.symbol.length - a.symbol.length);

  for (const u of candidates) {
    u.regex.lastIndex = 0;
    const match = u.regex.exec(raw);
    if (match && match.index === 0 && match[0].length === raw.length) {
      return { symbol: u.symbol || matchedUnit.trim(), type: u.type };
    }
  }
  return { symbol: raw, type: "count" };
}

// ─────────────────────────────────────────────────────────────
// HELPER: check if a string matches a text_metric guard
// ─────────────────────────────────────────────────────────────
function isTextMetric(raw) {
  return TEXT_METRIC_GUARDS.some(pattern => pattern.test(raw));
}

// ─────────────────────────────────────────────────────────────
// PRIMARY EXPORT: parseMetric(rawText) → MetricDescriptor | null
//
// MetricDescriptor shape:
// {
//   raw:         string,          // original matched text
//   kind:        "single_value" | "range_value" | "comparison_value" | "text_metric",
//   comparator:  string | null,   // ">", "<", "~", etc.
//   valueFrom:   number,          // primary or range-start value (parsed float)
//   valueTo:     number | null,   // range-end value or null
//   unit:        { symbol, type },
//   displayFrom: string,          // original string of first number (for display fidelity)
//   displayTo:   string | null,   // original string of second number
//   separator:   string | null,   // the actual separator found ("–", " đến ", etc.)
// }
// ─────────────────────────────────────────────────────────────
export function parseMetric(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
  const text = rawText.trim();
  if (!text) return null;

  // 1. Text metric guard — check before any numeric parsing
  if (isTextMetric(text)) {
    return {
      raw: text,
      kind: "text_metric",
      comparator: null,
      valueFrom: NaN,
      valueTo: null,
      unit: { symbol: "", type: "label" },
      displayFrom: text,
      displayTo: null,
      separator: null,
    };
  }

  // 2. Fix compact spoken ranges before single-value parsing.
  // Examples: "1530 phút" -> "15-30 phút", "1015 phút" -> "10-15 phút".
  const compactRange = parseCompactRange(text);
  if (compactRange) return compactRange;

  // 3. Try range first (more specific)
  const rangeMatch = REGEX_RANGE.exec(text);
  if (rangeMatch) {
    const [fullMatch, cmp, numA, sep, numB, unitStr] = rangeMatch;
    const unit = resolveUnit(unitStr);
    const comparator = cmp ? cmp.trim() : null;
    const kind = comparator ? "comparison_value" : "range_value";

    return {
      raw: fullMatch.trim(),
      kind,
      comparator,
      valueFrom: parseViNumber(numA),
      valueTo:   parseViNumber(numB),
      unit,
      displayFrom: numA,
      displayTo:   numB,
      separator:   sep,
    };
  }

  // 4. Try single value
  const singleMatch = REGEX_SINGLE.exec(text);
  if (singleMatch) {
    const [fullMatch, cmp, num, unitStr] = singleMatch;
    const unit = resolveUnit(unitStr);
    const comparator = cmp ? cmp.trim() : null;
    const kind = comparator ? "comparison_value" : "single_value";

    return {
      raw: fullMatch.trim(),
      kind,
      comparator,
      valueFrom: parseViNumber(num),
      valueTo:   null,
      unit,
      displayFrom: num,
      displayTo:   null,
      separator:   null,
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// SECONDARY EXPORT: extractMetricsFromText(text)
// Scans a full sentence/title string and returns all metrics found.
// Returns: MetricDescriptor[]
// ─────────────────────────────────────────────────────────────
export function extractMetricsFromText(text) {
  if (!text || typeof text !== "string") return [];

  // If the whole string is a text_metric guard, return it as-is.
  // This prevents scanning "Zone 2" and extracting "2" as a number.
  if (isTextMetric(text.trim())) {
    return [{
      raw: text.trim(),
      kind: "text_metric",
      comparator: null,
      valueFrom: NaN,
      valueTo: null,
      unit: { symbol: "", type: "label" },
      displayFrom: text.trim(),
      displayTo: null,
      separator: null,
    }];
  }

  const results = [];
  // Use sticky scanning to find all non-overlapping matches
  const combinedPattern = new RegExp(
    // range first
    `(${REGEX_RANGE.source})` +
    `|` +
    // single
    `(${REGEX_SINGLE.source})`,
    "gu"
  );

  let match;
  while ((match = combinedPattern.exec(text)) !== null) {
    const fragment = match[0].trim();
    if (!fragment) continue;
    const descriptor = parseMetric(fragment);
    if (descriptor) results.push(descriptor);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// TERTIARY EXPORT: parseOverlayTitle(titleStr)
// For overlay card titles like "15-30 PHÚT", "10.000 BƯỚC", "21%"
// Parses the FULL string directly so unit is always captured.
// ─────────────────────────────────────────────────────────────
export function parseOverlayTitle(titleStr) {
  const text = (titleStr || "").trim();
  if (!text) return null;
  // Try parseMetric on full string first — captures unit correctly
  const direct = parseMetric(text);
  if (direct) return direct;
  // Fallback: scan for embedded metric
  const metrics = extractMetricsFromText(text);
  return metrics.length > 0 ? metrics[0] : null;
}

export function isCountUpMetric(descriptor) {
  return !!descriptor && (
    descriptor.kind === "single_value" ||
    descriptor.kind === "comparison_value"
  );
}

export function isStaticMetric(descriptor) {
  return !!descriptor && (
    descriptor.kind === "range_value" ||
    descriptor.kind === "text_metric"
  );
}

export function hasRenderableMetric(descriptor) {
  return !!descriptor && (
    descriptor.kind === "single_value" ||
    descriptor.kind === "comparison_value" ||
    descriptor.kind === "range_value" ||
    descriptor.kind === "text_metric"
  );
}

export function formatMetricTitle(descriptor) {
  if (!descriptor) return "";
  const unitSymbol = descriptor.unit && descriptor.unit.symbol ? descriptor.unit.symbol : "";
  const unit = unitSymbol ? (unitSymbol === "%" ? "%" : ` ${unitSymbol}`) : "";
  const comparator = descriptor.comparator ? descriptor.comparator.trim() : "";

  if (descriptor.kind === "range_value") {
    return `${descriptor.displayFrom}-${descriptor.displayTo}${unit}`.trim();
  }

  if (descriptor.kind === "single_value" || descriptor.kind === "comparison_value") {
    return `${comparator}${descriptor.displayFrom}${unit}`.trim();
  }

  return descriptor.raw || "";
}

export function metricIdentity(descriptor) {
  if (!descriptor) return "";
  const unit = descriptor.unit && descriptor.unit.symbol ? descriptor.unit.symbol : "";
  const parts = [
    descriptor.kind,
    descriptor.comparator || "",
    Number.isFinite(descriptor.valueFrom) ? descriptor.valueFrom : descriptor.displayFrom || "",
    Number.isFinite(descriptor.valueTo) ? descriptor.valueTo : descriptor.displayTo || "",
    normalizeAscii(unit)
  ];
  return parts.join("|");
}

// ─────────────────────────────────────────────────────────────
// DIRECTION DETECTION — fallback khi Gemini không assign metric_direction
// Ưu tiên từ specific → generic, tránh false positive
// ─────────────────────────────────────────────────────────────
const DIRECTION_RULES = [
  // Multiply — kiểm tra trước vì "gấp/lần" rất đặc trưng
  { dir: "multiply", re: /\bgấp\b|\bnhân\b|x\s*\d|\d\s*lần\b/ },
  // Max / upper limit
  { dir: "max",      re: /không quá|tối đa|không vượt quá|giới hạn tối đa/ },
  // Min / threshold — "hơn đi X bước", "ít nhất", "đạt X"
  { dir: "min",      re: /ít nhất|tối thiểu|không dưới|hơn đi|đạt được|đi hơn/ },
  // Cycle / repetition — "lặp lại" alone too broad (e.g. "lặp lại điều" = emphasize a point)
  // Only trigger if "lặp lại" is followed by a frequency word, or explicit frequency phrases
  { dir: "cycle",    re: /lặp lại\s*(mỗi|hàng|đều|liên)|mỗi ngày|mỗi tuần|hàng ngày|hàng tuần|liên tục|đều đặn/ },
  // Decrease
  { dir: "down",     re: /giảm|bớt đi|hạ xuống|thấp hơn|ít hơn|giảm thiểu|ngăn ngừa|phòng chống|giảm nguy/ },
  // Increase
  { dir: "up",       re: /tăng|cải thiện|cao hơn|nhiều hơn|tốt hơn|nâng cao|tăng cường/ },
  // Approximate
  { dir: "approx",   re: /khoảng|tương đương|xấp xỉ|ước tính/ },
];

export function detectDirection(text) {
  const lower = String(text || "").toLowerCase();
  for (const { dir, re } of DIRECTION_RULES) {
    if (re.test(lower)) return dir;
  }
  return "neutral";
}
