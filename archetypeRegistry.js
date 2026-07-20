/**
 * archetypeRegistry.js — CNFI Semantic Overlay Architecture v3
 *
 * Universal archetype + visual pattern definitions.
 * Topic-agnostic: does not reference any specific health concept.
 * All topic knowledge stays in semanticOverlayEngine.js.
 *
 * ARCHETYPES      — what kind of information the overlay conveys (10 types)
 * PATTERNS        — how the overlay is animated on screen (17 types)
 * VISUAL_TYPE_MAP — bridges legacy topic-named visual types to universal archetypes
 */

// ─────────────────────────────────────────────────────────────────
// ARCHETYPES — 10 universal semantic categories
// ─────────────────────────────────────────────────────────────────
export const ARCHETYPES = Object.freeze({
  INGREDIENT:     "INGREDIENT",     // a substance, nutrient, or compound
  MECHANISM:      "MECHANISM",      // how something works: transport, reaction, process
  BENEFIT:        "BENEFIT",        // a positive outcome or measurable effect
  ACTION:         "ACTION",         // something the viewer should do or avoid
  WARNING:        "WARNING",        // a risk, contraindication, or common mistake
  PROCESS:        "PROCESS",        // an ongoing or step-by-step activity
  TIMELINE:       "TIMELINE",       // a duration, timing window, or progression
  METRIC:         "METRIC",         // a measurable numeric health value
  COMPARISON:     "COMPARISON",     // before/after or option A vs option B
  TRANSFORMATION: "TRANSFORMATION", // a state change from one condition to another
});

// ─────────────────────────────────────────────────────────────────
// PATTERNS — 17 universal visual animation patterns
// ─────────────────────────────────────────────────────────────────
export const PATTERNS = Object.freeze({
  FLOW:        "FLOW",        // particles travel from a source to a destination
  FILL:        "FILL",        // a container fills progressively toward a target level
  PULSE:       "PULSE",       // an object expands and contracts rhythmically
  PROGRESS:    "PROGRESS",    // a rail advances with a sliding marker and nodes
  ALERT:       "ALERT",       // a warning ring pulses with orbiting dots
  WAVE:        "WAVE",        // vertical bars animate as a sine wave
  GAUGE:       "GAUGE",       // arc gauge fills to a target level with a needle
  STACK:       "STACK",       // rows build up sequentially from top
  NETWORK:     "NETWORK",     // nodes appear then connect with lines
  CLOCK_ARC:   "CLOCK_ARC",   // a hand sweeps around a ring to mark elapsed time
  STEPS:       "STEPS",       // numbered nodes appear in sequence with links
  BARRIER:     "BARRIER",     // two halves part to let particles through
  SCALE:       "SCALE",       // a balance beam tilts toward the heavier side
  ARROW:       "ARROW",       // a directional arrow extends toward a target
  STREAM:      "STREAM",      // dense continuous particle stream
  PULSE_SPIKE: "PULSE_SPIKE", // flat baseline with a sharp vertical spike
  COMPARE:     "COMPARE",     // split-screen before/after: left = bad/dim, right = good/lit
});

// ─────────────────────────────────────────────────────────────────
// ARCHETYPE_PATTERNS — valid pattern(s) for each archetype.
// Index 0 is the primary (default) pattern for that archetype.
// ─────────────────────────────────────────────────────────────────
export const ARCHETYPE_PATTERNS = Object.freeze({
  [ARCHETYPES.INGREDIENT]:     [PATTERNS.FLOW,     PATTERNS.STREAM,  PATTERNS.FILL],
  [ARCHETYPES.MECHANISM]:      [PATTERNS.FLOW,     PATTERNS.BARRIER, PATTERNS.PULSE, PATTERNS.NETWORK],
  [ARCHETYPES.BENEFIT]:        [PATTERNS.FILL,     PATTERNS.PULSE,   PATTERNS.GAUGE, PATTERNS.WAVE],
  [ARCHETYPES.ACTION]:         [PATTERNS.STEPS,    PATTERNS.FILL,    PATTERNS.ARROW, PATTERNS.PROGRESS],
  [ARCHETYPES.WARNING]:        [PATTERNS.ALERT,    PATTERNS.PULSE_SPIKE],
  [ARCHETYPES.PROCESS]:        [PATTERNS.PROGRESS, PATTERNS.STEPS,   PATTERNS.FLOW,  PATTERNS.STREAM],
  [ARCHETYPES.TIMELINE]:       [PATTERNS.PROGRESS, PATTERNS.CLOCK_ARC, PATTERNS.STEPS],
  [ARCHETYPES.METRIC]:         [PATTERNS.FILL,     PATTERNS.GAUGE,   PATTERNS.PULSE],
  [ARCHETYPES.COMPARISON]:     [PATTERNS.SCALE,    PATTERNS.COMPARE],
  [ARCHETYPES.TRANSFORMATION]: [PATTERNS.FLOW,     PATTERNS.WAVE,    PATTERNS.COMPARE, PATTERNS.BARRIER],
});

// ─────────────────────────────────────────────────────────────────
// VISUAL_TYPE_MAP — legacy bridge
//
// Maps every current topic-named visual type to its universal archetype + pattern.
// Obsolete topic-specific visual types (fiber_gel_visual, glucose_transport_visual,
// satiety_signal_visual, metabolic_benefit_visual, carbohydrate_visual,
// heart_rate_zone_visual, warning_card) have been removed.
// Those archetypes now route directly through ARCHETYPE_PATTERNS.
// ─────────────────────────────────────────────────────────────────
export const VISUAL_TYPE_MAP = Object.freeze({
  // Timeline / Progress visuals — duration or step along a track
  timeline_progression:    { archetype: ARCHETYPES.TIMELINE,  pattern: PATTERNS.PROGRESS  },
  movement_guidance:       { archetype: ARCHETYPES.PROCESS,   pattern: PATTERNS.PROGRESS  },

  // Metric visuals — a numeric value, animated or static
  animated_metric_counter: { archetype: ARCHETYPES.METRIC,    pattern: PATTERNS.FILL      },
  static_metric_range:     { archetype: ARCHETYPES.METRIC,    pattern: PATTERNS.PROGRESS  },

  // Alert card — used by warning overlays without a Gemini-provided archetype
  alert_card:              { archetype: ARCHETYPES.WARNING,   pattern: PATTERNS.ALERT     },

  // Generic action card — fallback for ACTION overlays with no specific visual
  action_card:             { archetype: ARCHETYPES.ACTION,    pattern: PATTERNS.FILL      },
});

// ─────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve a legacy visual type string to its { archetype, pattern } entry.
 * Returns null when the visual type is unknown or not yet mapped.
 *
 * @param {string} visualType
 * @returns {{ archetype: string, pattern: string } | null}
 */
export function resolveArchetype(visualType) {
  if (!visualType || typeof visualType !== "string") return null;
  return VISUAL_TYPE_MAP[visualType] ?? null;
}

/**
 * Return true when the given pattern is valid for the given archetype.
 *
 * @param {string} archetype
 * @param {string} pattern
 * @returns {boolean}
 */
export function validateArchetypePattern(archetype, pattern) {
  const valid = ARCHETYPE_PATTERNS[archetype];
  if (!Array.isArray(valid)) return false;
  return valid.includes(pattern);
}

/**
 * Return the default (primary) pattern for an archetype.
 * Returns null when the archetype is unknown.
 *
 * @param {string} archetype
 * @returns {string | null}
 */
export function defaultPatternFor(archetype) {
  const valid = ARCHETYPE_PATTERNS[archetype];
  return Array.isArray(valid) && valid.length > 0 ? valid[0] : null;
}
