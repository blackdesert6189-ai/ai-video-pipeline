/**
 * semanticReport.js — CNFI Semantic Architecture Dry-Run Reporter
 *
 * Prints a diagnostic snapshot of the semantic overlay system's current state.
 * No render output is produced. No files are written. Pipeline exits early.
 *
 * How to trigger:
 *   node pipeline.js --srt <path> --report
 *
 * Report sections:
 *   1. Total overlay count
 *   2. Visual types in use (with frequency)
 *   3. Archetype + pattern resolved for each visual type
 *   4. Unmapped visual types (not yet in archetypeRegistry.js)
 *   5. Topic-specific visual types still present (Step 4 migration targets)
 *   6. Legacy renderer status  (semanticSceneHtml / semanticLayerGSAP)
 *   7. New pattern renderer status (active vs skeleton)
 *   8. Per-overlay detail table
 */

import { resolveArchetype } from "./archetypeRegistry.js";
import { renderFlow } from "./visualPatternRenderer.js";

// ─────────────────────────────────────────────────────────────
// Topic-specific visual types: named after a health concept
// rather than a universal archetype. These are Step 4 migration targets.
// ─────────────────────────────────────────────────────────────
const TOPIC_SPECIFIC_VISUAL_TYPES = new Set([
  "fiber_gel_visual",          // chia / soluble fiber mechanism
  "satiety_signal_visual",     // hunger / fullness signal
  "glucose_transport_visual",  // GLUT4 / glucose metabolism
  "carbohydrate_visual",       // carbohydrate context
  "metabolic_benefit_visual",  // metabolic benefit (glucose / insulin variants)
  "heart_rate_zone_visual",    // Zone 2 / cardio training zones
]);

// ─────────────────────────────────────────────────────────────
// Runtime check: is the new pattern renderer producing real DOM output?
// Returns false while visualPatternRenderer.js is in skeleton mode.
// Automatically returns true after Step 4 implements renderFlow.
// ─────────────────────────────────────────────────────────────
function isPatternRendererActive() {
  try {
    const result = renderFlow({}, "__probe__", 0, 1);
    return typeof result.html === "string" && result.html.length > 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────
const CLR_RESET  = "\x1b[0m";
const CLR_GREEN  = "\x1b[32m";
const CLR_YELLOW = "\x1b[33m";
const CLR_CYAN   = "\x1b[36m";
const CLR_RED    = "\x1b[31m";

function col(value, width) {
  return String(value ?? "").padEnd(width);
}

function pass(msg) { console.log(`${CLR_GREEN}✓  ${msg}${CLR_RESET}`); }
function warn(msg) { console.log(`${CLR_YELLOW}⚠  ${msg}${CLR_RESET}`); }
function fail(msg) { console.log(`${CLR_RED}✗  ${msg}${CLR_RESET}`); }
function head(msg) { console.log(`\n${CLR_CYAN}${msg}${CLR_RESET}`); }

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────
export function reportSemanticArchitecture(overlays) {
  const LINE  = "─".repeat(72);
  const DLINE = "═".repeat(72);

  console.log(`\n${DLINE}`);
  console.log(`  SEMANTIC ARCHITECTURE DRY-RUN REPORT`);
  console.log(DLINE);

  // ── 1. Total overlays ──────────────────────────────────────
  console.log(`\nTotal semantic overlays: ${overlays.length}`);

  // ── 2. Visual types in use ────────────────────────────────
  head("Visual types in use:");
  const typeCounts = {};
  for (const o of overlays) {
    const vt = o.semantic_visual_type || "unknown";
    typeCounts[vt] = (typeCounts[vt] || 0) + 1;
  }
  const uniqueTypes = Object.keys(typeCounts).sort();
  for (const vt of uniqueTypes) {
    console.log(`  ${String(typeCounts[vt]).padStart(2)}x  ${vt}`);
  }
  if (uniqueTypes.length === 0) {
    console.log("  (none)");
  }

  // ── 3. Archetype + pattern per visual type ─────────────────
  head("Archetype + pattern mapping:");
  for (const vt of uniqueTypes) {
    const resolved = resolveArchetype(vt);
    if (resolved) {
      console.log(`  ${col(vt, 34)} → ${col(resolved.archetype, 14)} / ${resolved.pattern}`);
    } else {
      console.log(`${CLR_RED}  ${col(vt, 34)} → [NOT MAPPED]${CLR_RESET}`);
    }
  }

  // ── 4. Unmapped visual types ──────────────────────────────
  const unmapped = uniqueTypes.filter(vt => !resolveArchetype(vt));
  console.log("");
  if (unmapped.length) {
    warn(`Unmapped visual types (${unmapped.length}) — add to archetypeRegistry.js:`);
    unmapped.forEach(vt => console.log(`     ${vt}`));
  } else {
    pass("All visual types mapped in archetypeRegistry.js");
  }

  // ── 5. Topic-specific vs generic visual types ─────────────
  const topicSpecific = uniqueTypes.filter(vt => TOPIC_SPECIFIC_VISUAL_TYPES.has(vt));
  const generic       = uniqueTypes.filter(vt => !TOPIC_SPECIFIC_VISUAL_TYPES.has(vt));

  if (topicSpecific.length) {
    warn(`Topic-specific visual types still present (${topicSpecific.length}) — Step 4 migration targets:`);
    for (const vt of topicSpecific) {
      const resolved = resolveArchetype(vt);
      const migrateTo = resolved
        ? `render${resolved.pattern.charAt(0) + resolved.pattern.slice(1).toLowerCase()}`
        : "no migration target yet";
      console.log(`     ${col(vt, 34)} → Step 4: ${migrateTo}`);
    }
  } else {
    pass("No topic-specific visual types present — all are generic archetypes");
  }

  if (generic.length) {
    console.log(`\n  Generic (topic-agnostic) visual types in use (${generic.length}):`);
    generic.forEach(vt => console.log(`     ${vt}`));
  }

  // ── 6. Legacy renderer status ─────────────────────────────
  head("Legacy renderer — pipeline.js (semanticSceneHtml / semanticLayerGSAP):");
  warn("Status: ACTIVE — if/else visual type chain handles all overlays");
  console.log("  File:      pipeline.js");
  console.log("  Functions: semanticSceneHtml(), semanticLayerGSAP()");
  console.log("  Reads:     semantic_visual_type string directly (no archetype lookup)");
  console.log("  Migration: Step 4 not yet done — legacy path unchanged");

  // ── 7. New pattern renderer status ────────────────────────
  head("New pattern renderer — visualPatternRenderer.js:");
  const rendererActive = isPatternRendererActive();
  if (rendererActive) {
    pass("Status: ACTIVE — renderPattern wired and producing DOM output");
  } else {
    warn("Status: INACTIVE — skeleton only, not wired to pipeline.js");
    console.log("  All renderXxx() functions return { html: '', gsapCode: '', cssBlocks: [] }");
    console.log("  Patterns declared: FLOW, FILL, PULSE, PROGRESS, ALERT, COMPARE");
    console.log("  Production renders: still routed through legacy if/else chain");
    console.log("  Activation: Step 4 migrates renderers one pattern at a time");
  }

  // ── 8. Per-overlay detail table ───────────────────────────
  head("Per-overlay detail:");
  const H_NUM   = col("#",       4);
  const H_TYPE  = col("TYPE",    9);
  const H_ARCH  = col("ARCHETYPE", 16);
  const H_PAT   = col("PATTERN", 11);
  const H_VT    = col("VISUAL_TYPE", 32);
  console.log(`  ${H_NUM}${H_TYPE}${H_ARCH}${H_PAT}${H_VT}TITLE`);
  console.log(`  ${LINE}`);

  if (overlays.length === 0) {
    console.log("  (no overlays)");
  } else {
    overlays.forEach((o, i) => {
      const vt       = o.semantic_visual_type || "unknown";
      const resolved = resolveArchetype(vt);
      const arch     = o.archetype || (resolved ? resolved.archetype : "—");
      const pat      = o.pattern   || (resolved ? resolved.pattern   : "—");
      const title    = (o.title || "").slice(0, 28);
      const row = `  ${col(i + 1, 4)}${col(o.type, 9)}${col(arch, 16)}${col(pat, 11)}${col(vt, 32)}${title}`;

      // Highlight topic-specific rows
      if (TOPIC_SPECIFIC_VISUAL_TYPES.has(vt)) {
        console.log(`${CLR_YELLOW}${row}${CLR_RESET}`);
      } else {
        console.log(row);
      }
    });
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`\n${DLINE}`);
  console.log(`  SUMMARY`);
  console.log(LINE);
  console.log(`  Overlays total:          ${overlays.length}`);
  console.log(`  Unique visual types:     ${uniqueTypes.length}`);
  console.log(`  Unmapped types:          ${unmapped.length}`);
  console.log(`  Topic-specific types:    ${topicSpecific.length}  ← Step 4 migration targets`);
  console.log(`  Generic types:           ${generic.length}  ← already topic-agnostic`);
  console.log(`  Legacy renderer:         ACTIVE`);
  console.log(`  Pattern renderer:        ${rendererActive ? "ACTIVE" : "INACTIVE (skeleton)"}`);
  console.log(`${DLINE}\n`);
}
