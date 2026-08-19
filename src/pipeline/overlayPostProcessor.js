/**
 * ============================================================
 * Overlay Sanitization & Post-Processing Module
 * ============================================================
 * Sanitizes speech noise from overlay card text, clears ASR fragments,
 * drops bad/malformed cards, resolves list group collisions, and enforces
 * hook safe start boundaries.
 *
 * Extracted from pipeline.js in Phase 5.
 * ============================================================
 */

// ── Card text sanitizer constants ────────────────────────────────
// Chỉ remove tiếng ồn rõ ràng — không touch từ tiếng Việt hợp lệ
export const SPEECH_NOISE = /(?<!\S)(uh|um|uhm|erm|hmm)(?!\S)/gi;
export const BAD_PHRASE   = /(bạn đang nghĩ|chắc chắn thì|thì bạn đang|thì chắc chắn|đó là$|nha$)/i;
export const BAD_ENDING   = /(thì|và của|cho để)\s*$/i;

/**
 * Strips speech noise and normalizes whitespace.
 * @param {string} text - Input text
 * @returns {string} Sanitized text
 */
export function sanitizeText(text) {
  return String(text || '')
    .replace(SPEECH_NOISE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Validates whether card title text is suitable for display.
 * @param {string} text - Card title text
 * @returns {boolean} True if valid
 */
export function isValidText(text) {
  if (!text || text.length < 4) return false;
  if (BAD_PHRASE.test(text)) return false;
  if (BAD_ENDING.test(text)) return false;
  return text.trim().split(/\s+/).filter(w => w.length > 1).length >= 2;
}

/**
 * Detects ASR fragment details — những đoạn bị cắt giữa câu từ transcript.
 * Không dựa vào Gemini follow prompt — validate bằng code.
 * @param {string} text - Card detail text
 * @returns {boolean} True if fragment
 */
export function isDetailFragment(text) {
  if (!text || text.trim().length < 8) return true;
  const t = text.trim().toLowerCase();
  // Bắt đầu bằng liên từ = phần tiếp theo của câu trước
  if (/^(và |hoặc |hay |nhưng |mà |thì |vì |bởi |nên |thậm chí |tuy nhiên |ngoài ra |bên cạnh |đó là )/.test(t)) return true;
  // Kết thúc bằng giới từ lơ lửng
  if (/\s+(đến|của|trong|về|từ|với|cho|theo|ra|vào|sau|trước|qua|tới|ở|tại|lên|xuống)\s*$/.test(t)) return true;
  // Kết thúc bằng liên từ lửng — câu bị cắt giữa chừng
  if (/\s+(hoặc|hay|và|nhưng|mà|thì|vì|nên|mà|hoặc|như)\s*$/.test(t)) return true;
  // Kết thúc bằng từ không thể kết thúc ý hoàn chỉnh
  if (/\s+(mức|điều|gấp|giấc|gì|thế|sao|nào|ấy|kia|vậy)\s*$/.test(t)) return true;
  return false;
}

/**
 * Factory creating overlay post-processor bound to external dependencies.
 * @param {{ toSeconds: Function, hookSafeStart: number, logWarning: Function }} options
 * @returns {{ sanitizeText: Function, isValidText: Function, isDetailFragment: Function, postProcessOverlays: Function }}
 */
export function createOverlayPostProcessor({ toSeconds, hookSafeStart, logWarning }) {
  function postProcessOverlays(overlays) {
    const cleaned = overlays
      .map(ov => {
        const title  = sanitizeText(ov.title);
        let   detail = sanitizeText(ov.detail);
        // Nếu detail là fragment ASR → xoá detail (giữ card), không drop card
        if (detail && isDetailFragment(detail)) {
          logWarning(`Fragment detail cleared: "${title}" / "${detail}"`);
          detail = "";
        }
        return { ...ov, title, detail };
      })
      .filter(ov => {
        const ok = isValidText(ov.title);   // Chỉ title quyết định có giữ card không
        if (!ok) logWarning(`Dropped bad card: "${ov.title}" / "${ov.detail}"`);
        return ok;
      });

    // Build list windows: [startTime, endTime] of each list_group
    const listWindows = [];
    const groups = new Map();
    for (const ov of cleaned) {
      if (!ov.list_group) continue;
      if (!groups.has(ov.list_group)) groups.set(ov.list_group, { start: Infinity, end: -Infinity });
      const g = groups.get(ov.list_group);
      g.start = Math.min(g.start, toSeconds(ov.startTime, 0));
      g.end   = Math.max(g.end,   toSeconds(ov.endTime,   0));
    }
    for (const g of groups.values()) listWindows.push(g);

    // Remove non-list overlays that overlap with any list window
    const filtered = cleaned.filter(ov => {
      if (ov.list_group) return true;
      const start = toSeconds(ov.startTime, 0);
      const end   = toSeconds(ov.endTime,   0);
      const clash = listWindows.some(w => start < w.end && end > w.start);
      if (clash) logWarning(`Dropped overlap with list: "${ov.title}"`);
      return !clash;
    });

    // Đẩy card xuất hiện trong vùng opening hook ra sau khi hook kết thúc
    // List items (list_group) không bị shift — chúng được Gemini định thời cụ thể
    return filtered.map(ov => {
      if (ov.list_group) return ov;
      const start = toSeconds(ov.startTime, 0);
      if (start < hookSafeStart) {
        const shift = hookSafeStart - start;
        logWarning(`Hook overlap fix: "${ov.title}" shifted +${shift.toFixed(1)}s`);
        return { ...ov, startTime: hookSafeStart, endTime: toSeconds(ov.endTime, 0) + shift };
      }
      return ov;
    });
  }

  return {
    sanitizeText,
    isValidText,
    isDetailFragment,
    postProcessOverlays
  };
}
