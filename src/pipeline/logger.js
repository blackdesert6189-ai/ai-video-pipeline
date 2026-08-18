/**
 * src/pipeline/logger.js
 * Logging utilities and ANSI color formatting for CNFI Video Pipeline.
 */

export const COLOR_RESET = "\x1b[0m";
export const COLOR_GREEN = "\x1b[32m";
export const COLOR_RED = "\x1b[31m";
export const COLOR_YELLOW = "\x1b[33m";
export const COLOR_CYAN = "\x1b[36m";
export const COLOR_MAGENTA = "\x1b[35m";

export function logStep(msg) {
  console.log(`\n${COLOR_CYAN}◆  ${msg}${COLOR_RESET}`);
}

export function logSuccess(msg) {
  console.log(`${COLOR_GREEN}✓  ${msg}${COLOR_RESET}`);
}

export function logWarning(msg) {
  console.log(`${COLOR_YELLOW}⚠  ${msg}${COLOR_RESET}`);
}

export function logError(msg) {
  console.log(`${COLOR_RED}✗  ${msg}${COLOR_RESET}`);
}
