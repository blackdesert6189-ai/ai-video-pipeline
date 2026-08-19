/**
 * ============================================================
 * Runtime Visual Patches Module
 * ============================================================
 * Applies runtime CSS and DOM fixes via Puppeteer page
 * before font loading and frame capture.
 *
 * Extracted from pipeline.js in Phase 3.
 * ============================================================
 */

/**
 * Apply runtime visual CSS patches and DOM tweaks on loaded Puppeteer page.
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {object} layout - Layout configuration object containing card positioning
 */
export async function applyRuntimeVisualPatches(page, layout = {}) {
  const cardLayout = layout.card || {};
  const statLeft = cardLayout.statLeft !== undefined ? cardLayout.statLeft : 70;
  const infoLeft = cardLayout.infoLeft !== undefined ? cardLayout.infoLeft : 70;

  await page.addStyleTag({
    content: `
      #root .global-neon-rail {
        position: absolute !important;
        left: 70px !important;
        top: 980px !important;
        width: 3px !important;
        height: 520px !important;
        background: linear-gradient(
          180deg,
          rgba(166, 255, 61, 0) 0%,
          rgba(166, 255, 61, 0.5) 8%,
          rgba(166, 255, 61, 0.5) 92%,
          rgba(166, 255, 61, 0) 100%
        ) !important;
        opacity: 1 !important;
        pointer-events: none !important;
        z-index: 10 !important;
      }
      #root .semantic-layer {
        position: absolute !important;
        inset: 0 !important;
        pointer-events: none !important;
        z-index: 2 !important;
      }
      #root .card-container {
        z-index: 3 !important;
      }
      #root .card-stat {
        overflow: visible !important;
        z-index: 4 !important;
        left: ${statLeft}px !important;
        border-radius: 0 !important;
        padding-left: 20px !important;
      }
      #root .card-stat .stat-neon-bar {
        left: 0 !important;
        width: 5px !important;
        border-radius: 0 !important;
        box-shadow: 0 0 10px #a6ff3d, 0 0 28px rgba(166, 255, 61, 0.9), 0 0 60px rgba(166, 255, 61, 0.5) !important;
        z-index: 4 !important;
      }
      #root .card {
        left: ${infoLeft}px !important;
      }
      #root .stat-value,
      #root .stat-number {
        display: block !important;
        height: auto !important;
        line-height: 1 !important;
        overflow: visible !important;
        white-space: nowrap !important;
        letter-spacing: 0 !important;
      }
      #root .sentence {
        gap: 12px !important;
        word-spacing: 0 !important;
      }
      #root .word {
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        transform-origin: center center !important;
      }
      /* anchor: word gap — 116px cần spacing rõ hơn để từ không dính nhau */
      #root .peak-chunk-anchor .word {
        margin-right: 0.09em !important;
      }
      /* script_climax: restore word gap — specificity #root .peak-chunk-script-climax .word = 120 > 110 */
      #root .peak-chunk-script-climax .word,
      #root .peak-chunk-script-climax .word-peak-key {
        margin-right: 0.15em !important;
      }
      /* Đảm bảo gap hoạt động đúng — CHỈ áp cho peak, không ảnh hưởng normal sentence wrap */
      #root .subtitle-container .sentence-peak {
        display: flex !important;
        flex-wrap: nowrap !important;
        flex-direction: column !important;
      }
    `
  });

  await page.evaluate(() => {
    const root = document.getElementById("root");
    if (root && !root.querySelector(".global-neon-rail")) {
      const rail = document.createElement("div");
      rail.className = "global-neon-rail";
      root.insertBefore(rail, root.firstChild);
    }

    // ── Tetris horizontal positioning for script_climax ──────────────────────
    // Đo chiều rộng thực tế của các chunk phía trên script_climax,
    // sau đó dịch ngang script_climax để lấp khoảng trống — giống TYB.
    // Logic: script_climax.paddingLeft = max right-edge của chunk trước nó
    //        (clamped để không overflow sentence width)
    document.querySelectorAll('.sentence-peak').forEach(sentEl => {
      const climaxEl = sentEl.querySelector('.peak-chunk-script-climax');
      if (!climaxEl) return;

      const chunks = Array.from(sentEl.querySelectorAll('.peak-chunk'));
      const climaxIdx = chunks.indexOf(climaxEl);
      if (climaxIdx <= 0) return; // đã ở đầu → không cần dịch

      const sentRect = sentEl.getBoundingClientRect();

      // Tìm right-edge xa nhất trong các chunk PHÍA TRÊN script_climax
      let maxRight = 0;
      for (let i = 0; i < climaxIdx; i++) {
        const r = chunks[i].getBoundingClientRect();
        const rightRel = r.right - sentRect.left;
        if (rightRel > maxRight) maxRight = rightRel;
      }

      // Lấy chiều rộng hiện tại của script_climax (trước khi dịch)
      let climaxRect = climaxEl.getBoundingClientRect();
      let climaxWidth = climaxRect.width;

      // ── Auto-scale sc font-size nếu text quá rộng để fit container ───────────
      // Scalable: đo actual rendered width, scale xuống tỷ lệ — không hardcode ngưỡng.
      // Áp dụng trước khi tính indent để maxAllowedLeft dùng climaxWidth đúng.
      const sentWidth = sentRect.width;
      const _scMargin = 16; // px safety margin trái+phải
      if (climaxWidth > sentWidth - _scMargin) {
        const _scaleFactor = (sentWidth - _scMargin) / climaxWidth;
        climaxEl.querySelectorAll('.word, .word-peak-key').forEach(w => {
          const _cur = parseFloat(window.getComputedStyle(w).fontSize);
          w.style.setProperty('font-size', Math.floor(_cur * _scaleFactor) + 'px', 'important');
        });
        // Re-measure sau khi scale để indent calc dùng đúng width
        climaxRect = climaxEl.getBoundingClientRect();
        climaxWidth = climaxRect.width;
      }
      // ─────────────────────────────────────────────────────────────────────────

      // Clamp: không được vượt quá sentence width trừ chiều rộng chunk
      const maxAllowedLeft = Math.max(0, sentWidth - climaxWidth - 8);
      const targetLeft = Math.min(maxRight, maxAllowedLeft);

      // Chỉ áp nếu targetLeft > cascade indent hiện tại (không thu hẹp)
      const existingPL = parseFloat(climaxEl.style.paddingLeft) || 0;
      if (targetLeft > existingPL) {
        climaxEl.style.paddingLeft = targetLeft + 'px';
      }
    });
    // ─────────────────────────────────────────────────────────────────────────
  });
}
