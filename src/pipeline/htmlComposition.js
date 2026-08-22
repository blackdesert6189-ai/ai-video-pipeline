/**
 * src/pipeline/htmlComposition.js
 * Extracted HTML Document Composition Service.
 * Generates the complete TikTok video HTML composition document,
 * including DOM markup, GSAP timeline, inline Lottie data, and client runtime.
 */
import fs from 'fs';

export function createHtmlComposition(options = {}) {
  const {
    layout,
    peakFunctionWords,
    getAssetMap = () => new Map(),
    buildImageStyleImpl,
    generateStylesImpl,
    renderMetricFromTitleImpl,
    getLottieIconFilterImpl,
    getPeakSmartIndentsImpl,
    postProcessOverlaysImpl,
    splitLongSentencesImpl,
    normalizeSentenceImpl,
    normalizeOverlayImpl,
    toSecondsImpl,
    foldTextImpl,
    readFileSyncImpl = fs.readFileSync
  } = options;

  if (!layout) throw new Error('createHtmlComposition: layout is required');
  if (!peakFunctionWords) throw new Error('createHtmlComposition: peakFunctionWords is required');
  if (typeof generateStylesImpl !== 'function') throw new Error('createHtmlComposition: generateStylesImpl is required');

  function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

  function buildOpeningHook(sentences, overlays, geminiHook) {
  if (geminiHook && geminiHook.kicker && geminiHook.title && geminiHook.punch) {
    return {
      kicker: String(geminiHook.kicker).toUpperCase(),
      title:  String(geminiHook.title).toUpperCase(),
      punch:  String(geminiHook.punch).toUpperCase()
    };
  }
  return {
    kicker: "SỨC KHỎE",
    title:  "MỘT THÓI QUEN NHỎ",
    punch:  "CÓ THỂ ĐỔI KẾT QUẢ"
  };
}

  function generatePremiumHTML(sentences, overlays, totalDuration, geminiHook = null, imageGapSegments = []) {
  const renderSentences = splitLongSentencesImpl((sentences || []).map(normalizeSentenceImpl));

  // Suppress overlay cards that overlap with peak sentences — TYB peak IS the card
  // Showing both card + peak for same content is redundant and visually noisy
  const peakWindows = renderSentences
    .filter(s => s.style === "peak")
    .map(s => ({ start: s.startTime, end: s.endTime }));

  const rawOverlays = postProcessOverlaysImpl((overlays || []).map(normalizeOverlayImpl));
  const renderOverlays = rawOverlays.filter(card => {
    const cStart = toSecondsImpl(card.startTime, 0);
    const cEnd   = toSecondsImpl(card.endTime,   cStart + 1);
    // Keep card only if it does NOT overlap any peak window
    return !peakWindows.some(p => cStart < p.end && cEnd > p.start);
  });
  const fmt = (value) => Number(toSecondsImpl(value, 0)).toFixed(3);

  // Build inline Lottie data map — keyed by cardId ("card-0", "card-1", ...)
  // Each entry is the parsed JSON or null if no lottie_path
  const lottieDataMap = {};
  for (let i = 0; i < renderOverlays.length; i++) {
    const lp = renderOverlays[i].lottie_path;
    if (lp) {
      try {
        lottieDataMap[`card-${i}`] = JSON.parse(readFileSyncImpl(lp, 'utf8'));
      } catch (e) {
        lottieDataMap[`card-${i}`] = null;
      }
    } else {
      lottieDataMap[`card-${i}`] = null;
    }
  }

  const openingHook = buildOpeningHook(renderSentences, renderOverlays, geminiHook);
  const hookDimHtml = `<div class="hook-dim" id="hook-dim" aria-hidden="true"></div>`;
  const hookHtml = `
      <div class="opening-hook" id="opening-hook" aria-hidden="true">
        <div class="hook-kicker">${escapeHtml(openingHook.kicker)}</div>
        <div class="hook-title">${escapeHtml(openingHook.title)}</div>
        <div class="hook-punch">${escapeHtml(openingHook.punch)}</div>
      </div>`;

  let cardsHtml = "";
  let visualRowsHtml = "";
  // metricRenderMap: keyed by cardId, stores generated GSAP code per STAT card
  const metricRenderMap = {};
  // cardHasLottie[i] = true if overlay[i] has a lottie_path — used in GSAP loop
  const cardHasLottie = [];

  for (let i = 0; i < renderOverlays.length; i++) {
    const card = renderOverlays[i];
    const cardId = `card-${i}`;
    const vrId = `vr-${i}`;
    const vrTypeClass = card.type === "STAT" ? " vr-stat" : card.type === "WARNING" ? " vr-warning" : card.list_group ? " vr-list" : "";

    // Animation nằm trong card (card-lottie) — không dùng visual-row nữa
    const hasLottie = !!card.lottie_path;
    cardHasLottie.push(hasLottie);

    if (card.type === "STAT") {
      // Universal Metric Renderer — handles single, range, comparison, text_metric
      // automatically from the card title. No hard-coding of specific values.
      const cardStartSec = toSecondsImpl(card.startTime, 0);
      const cardEndSec   = toSecondsImpl(card.endTime, cardStartSec + 3.5);
      // Enrich direction fallback with transcript sentences overlapping this card's window
      // (e.g. "gấp 4 lần" may be in the spoken sentence but not in card.detail/title)
      const overlapText = renderSentences
        .filter(s => s.endTime > cardStartSec - 0.5 && s.startTime < cardEndSec + 0.5)
        .map(s => s.text || (s.words || []).join(" "))
        .join(" ");
      const directionFallback = `${card.detail || ""} ${card.title || ""} ${overlapText}`.trim();
      const metricResult = renderMetricFromTitleImpl(
        card.title || "",
        `#${cardId}`,
        cardStartSec,
        cardEndSec,
        card.metric_direction || null,
        directionFallback
      );
      metricRenderMap[cardId] = metricResult.gsapCode;

      const rawTitle = card.title || "";
      const compactLength = rawTitle.replace(/\s+/g, "").length;
      const sizeClass = compactLength >= 9 ? "stat-compact"
                      : compactLength >= 6 ? "stat-medium"
                      : "stat-large";

      cardsHtml += `
        <div class="card-stat ${sizeClass}" id="${cardId}">
          <div class="stat-neon-bar"></div>
          <div class="stat-content">
            <div class="stat-value ${sizeClass}">${metricResult.html}</div>
            <div class="stat-divider"><span class="stat-divider-fill"></span></div>
            <div class="stat-label">${escapeHtml(card.detail)}</div>
          </div>
        </div>`;
    } else if (card.list_style === 'progressive' || card.list_style === 'steps_overview') {
      const idxNum  = card.list_index || 1;
      const total   = card.list_total || '';
      const progress = total ? `<span class="list-progress">${idxNum}/${total}</span>` : '';
      const numCircle = `<div class="list-num">${idxNum}</div>`;
      const warningCls = card.type === 'WARNING' ? ' card-warning' : '';
      cardsHtml += `
        <div class="card card-list-progressive${warningCls}" id="${cardId}" data-list-group="${escapeHtml(card.list_group||'')}" data-list-index="${idxNum}">
          ${numCircle}
          <div class="list-content">
            <div class="list-header">
              <span class="list-title">${escapeHtml(card.title)}</span>
              ${progress}
            </div>
            <div class="list-detail">${escapeHtml(card.detail)}</div>
          </div>
        </div>`;

    } else if (card.list_style === 'number_slam') {
      const idxNum = card.list_index || 1;
      const total  = card.list_total || '';
      const supText = total ? `/${total}` : '';
      cardsHtml += `
        <div class="card card-list-slam" id="${cardId}">
          <div class="slam-num">${idxNum}<sup class="slam-sup">${supText}</sup></div>
          <div class="slam-title">${escapeHtml(card.title)}</div>
          <div class="slam-detail">${escapeHtml(card.detail)}</div>
        </div>`;

    } else if (card.list_style === 'checklist') {
      const warningCls = card.type === 'WARNING' ? ' card-warning' : '';
      const checkIcon  = card.type === 'WARNING' ? '✕' : '✓';
      const checkCls   = card.type === 'WARNING' ? 'check-icon check-no' : 'check-icon check-yes';
      cardsHtml += `
        <div class="card card-list-check${warningCls}" id="${cardId}">
          <div class="${checkCls}">${checkIcon}</div>
          <div class="list-content">
            <div class="list-title">${escapeHtml(card.title)}</div>
            <div class="list-detail">${escapeHtml(card.detail)}</div>
          </div>
        </div>`;

    } else {
      const badgeHtml = card.type === "WARNING"
        ? `<span class="badge warning-badge">CẢNH BÁO</span>`
        : "";
      const cardTypeClass = card.type === "WARNING" ? " card-warning"
                          : card.type === "ACTION"  ? " card-action"
                          : "";
      // Lottie float icon — INSIDE card (last child), tràn ra ngoài qua overflow:visible
      // CSS right/top định vị tại góc trên-phải — không cần JS getBoundingClientRect
      // filter baked inline server-side: brightness rule + glow, không cần class override
      const iconClass = card.type === "WARNING" ? " icon-warn"
                      : card.type === "ACTION"  ? " icon-action"
                      : "";
      const _isWarnIcon = card.type === "WARNING";
      const _iconFilter = getLottieIconFilterImpl(lottieDataMap[cardId] || null, _isWarnIcon);
      const floatIconHtml = hasLottie
        ? `<div class="card-icon-float${iconClass}" id="lottie-${cardId}" style="filter:${_iconFilter}"></div>`
        : "";
      const hasIconClass = hasLottie ? " card-has-icon" : "";
      cardsHtml += `
        <div class="card card-info${cardTypeClass}${hasIconClass}" id="${cardId}">
          <div class="card-text">
            ${badgeHtml ? `<div class="card-header">${badgeHtml}</div>` : ""}
            <div class="card-title">${escapeHtml(card.title)}</div>
            <div class="card-body">${escapeHtml(card.detail)}</div>
          </div>
          ${floatIconHtml}
        </div>`;
    }
  }

  let subtitlesHtml = "";
  for (let sIdx = 0; sIdx < renderSentences.length; sIdx++) {
    const sentence = renderSentences[sIdx];
    const sId = `sentence-${sIdx}`;
    let sStyle = sentence.style || "normal"; // fallback safety

    // ── Auto-downgrade peak: 2 guard rules ────────────────────────
    // 1. Quá ngắn (< 4 từ): extendShortPeaks đã cố mượn thêm từ;
    //    nếu vẫn < 4 từ sau extend → downgrade (không đủ visual)
    //    4-5 từ: peakKeyCount=1 → 4 regular → 3-line fallback
    //    6+ từ: peakKeyCount=2 → full 3-line TYB (wave lớn→nhỏ→lớn)
    if (sStyle === "peak" && sentence.words.length < 4) sStyle = "normal";
    // Force-normal cho câu hỏi — question sentences never peak (kills hook tension)
    // Detect: kết thúc "?", hoặc có cấu trúc "có ... không/chưa"
    if (sStyle === "peak" && /[?？]/.test(sentence.text)) sStyle = "normal";
    // hook.safeStart chỉ áp dụng cho CARD, không áp cho subtitle
    // → peak subtitle ĐƯỢC PHÉP xuất hiện từ giây đầu tiên (đó là hook moment)
    // ──────────────────────────────────────────────────────────────

    // Style class: sentence-peak only; normal has no extra class
    const styleClass = sStyle !== "normal" ? ` sentence-${sStyle}` : "";
    let wordsHtml = "";
    // IDs của các peak chunk thực sự được render — dùng cho GSAP per-chunk animation
    // Khai báo ở đây (loop scope) để cả HTML gen block lẫn GSAP block đều truy cập được
    let renderedChunkIds = [];

    if (sStyle === "peak") {
      // ── PEAK: TYB chunk-based render ─────────────────────────────
      // peakLines = [{text, type}] từ Gemini — mỗi chunk 1 dòng riêng
      // type: connector | regular | anchor | script | script_climax
      // Cascade indent: lineIdx × peakIndentStep px từ trái

      const chunks = (() => {
        const raw = sentence.peakLines || (() => {
          // Fallback khi Gemini không trả peak_lines hợp lệ
          const n = sentence.words.length;
          const keyCount = Math.min(3, Math.max(1, n - 4));
          const keyStart = n - keyCount;
          const reg = sentence.words.slice(0, keyStart);
          const mid = Math.ceil(reg.length / 2);
          return [
            { text: reg.slice(0, mid).join(" "),               type: "regular" },
            { text: reg.slice(mid).join(" "),                  type: "regular" },
            { text: sentence.words.slice(keyStart).join(" "),  type: "script"  },
          ].filter(c => c.text);
        })();

        // ── Render-time sanity guards (chạy mọi lúc, kể cả skip-gemini) ────
        let sanitized = raw.map(chunk => {
          if (chunk.type === 'anchor') {
            // anchor >3 từ → tràn màn hình
            const wc = chunk.text.trim().split(/\s+/).filter(Boolean).length;
            if (wc > 3) return { ...chunk, type: 'regular' };
            // anchor kết thúc giới từ → không phải semantic unit
            if (layout.peak.anchorEndBlockPattern && layout.peak.anchorEndBlockPattern.test(chunk.text)) {
              return { ...chunk, type: 'regular' };
            }
          }
          // script_climax bắt đầu bằng giới từ → demote script
          if (chunk.type === 'script_climax') {
            const lower = chunk.text.trim().toLowerCase();
            if (layout.peak.climaxBlockRules && layout.peak.climaxBlockRules.some(rx => rx.test(lower))) {
              return { ...chunk, type: 'script' };
            }
          }
          return chunk;
        });

        // ── [PRE-OPT] Fix compound nouns bị split tại chunk boundary ───────────────
        // Scan mọi biên chunk[i]→chunk[i+1]: nếu lastWord(i) + firstWord(i+1) = từ ghép
        // → move firstWord(i+1) sang cuối chunk[i].
        // Scalable: dictionary mở rộng được, không hardcode logic.
        {
          const _COMPOUNDS = new Set([
            // Giải phẫu / sinh lý
            'tế bào','cơ thể','não bộ','thụ thể','trí não','cảm giác','thần kinh','tiêu hóa','miễn dịch',
            // Sinh hóa / cơ chế
            'hiệu ứng','tác dụng','cơ chế','quá trình','phản ứng','oxy hóa',
            'axit béo','chất béo','chất xơ','đường huyết','trao đổi',
            // Y khoa
            'giả dược','tiểu đường','béo phì','viêm nhiễm','huyết áp','nhịp tim','kháng thể',
            // Thể chất / sức khỏe
            'năng lượng','lợi ích','tác hại','sức khỏe','cân nặng','hành trình','tín hiệu',
            // Retorical / motivational
            'bí kíp','bí quyết','bí mật','mấu chốt',
          ]);
          let _cpChanged = true;
          while (_cpChanged) {
            _cpChanged = false;
            for (let _ci = 0; _ci < sanitized.length - 1; _ci++) {
              const _wA = sanitized[_ci].text.trim().split(/\s+/);
              const _wB = sanitized[_ci + 1].text.trim().split(/\s+/);
              const _lastW  = _wA[_wA.length - 1].toLowerCase().replace(/[.,!?;:]/g, '');
              const _firstW = _wB[0].toLowerCase().replace(/[.,!?;:]/g, '');
              if (_COMPOUNDS.has(_lastW + ' ' + _firstW)) {
                // ── Anchor rebalance: left chunk là anchor + cuối anchor = nửa đầu từ ghép
                // KHÔNG absorb vào anchor (tránh tạo anchor >3 từ tràn màn hình)
                // Thay vào đó: dịch lastWord anchor sang đầu next chunk → từ ghép nguyên vẹn ở next
                // Vd: anchor("hiệu ứng giả") + sc("dược")
                //   → anchor("hiệu ứng") + sc("giả dược")  ✓
                if (sanitized[_ci].type === 'anchor' && _wA.length > 1) {
                  const _newAnchorText = _wA.slice(0, -1).join(' ');
                  const _newNextText   = _wA[_wA.length - 1] + ' ' + sanitized[_ci + 1].text.trim();
                  sanitized = [
                    ...sanitized.slice(0, _ci),
                    { text: _newAnchorText, type: 'anchor' },
                    { text: _newNextText,   type: sanitized[_ci + 1].type },
                    ...sanitized.slice(_ci + 2),
                  ];
                  _cpChanged = true; break;
                }
                // Normal: absorb firstWord của next vào left chunk (left không phải anchor)
                const _newAText = sanitized[_ci].text.trimEnd() + ' ' + _wB[0];
                const _remB = _wB.slice(1);
                if (_remB.length === 0) {
                  // chunk[i+1] hết từ → absorb hoàn toàn, giữ type của chunk[i]
                  sanitized = [
                    ...sanitized.slice(0, _ci),
                    { text: _newAText, type: sanitized[_ci].type },
                    ...sanitized.slice(_ci + 2),
                  ];
                } else {
                  sanitized = [
                    ...sanitized.slice(0, _ci),
                    { text: _newAText,         type: sanitized[_ci].type },
                    { text: _remB.join(' '),   type: sanitized[_ci + 1].type },
                    ...sanitized.slice(_ci + 2),
                  ];
                }
                _cpChanged = true; break;
              }
            }
          }
        }

        // ── [OPT-0] Hấp thụ script_climax ≤2 từ vào chunk ngay trước ────────────────
        // Vd: regular("hiệu ứng giả") + script_climax("dược") → script_climax("hiệu ứng giả dược")
        // Case đặc biệt: anchor(1 từ) + script_climax(1 từ) = compound noun bị split ("giả|dược")
        //   → merge thành anchor("giả dược") để giữ concept nguyên vẹn
        // Guard: tổng ≤6 từ (6 tiếng Việt ≈ 420px < 1000px container, an toàn)
        { let _o0Changed = true;
          while (_o0Changed) {
            _o0Changed = false;
            for (let _o0 = 1; _o0 < sanitized.length; _o0++) {
              if (sanitized[_o0].type === 'script_climax') {
                const _wc0 = sanitized[_o0].text.trim().split(/\s+/).filter(Boolean).length;
                const _prev = sanitized[_o0 - 1];
                // Case A: prev là regular/connector/script → merge thành script_climax
                if (_wc0 <= 2 && ['regular','connector','script'].includes(_prev.type)) {
                  const _mt0 = _prev.text + ' ' + sanitized[_o0].text;
                  if (_mt0.trim().split(/\s+/).filter(Boolean).length <= 6) {
                    sanitized = [...sanitized.slice(0, _o0 - 1),
                                 { text: _mt0, type: 'script_climax' },
                                 ...sanitized.slice(_o0 + 1)];
                    _o0Changed = true; break;
                  }
                }
                // Case B: anchor(1 từ) + script_climax(1 từ) = compound bị split → merge thành anchor
                if (_wc0 === 1 && _prev.type === 'anchor' &&
                    _prev.text.trim().split(/\s+/).filter(Boolean).length === 1) {
                  sanitized = [...sanitized.slice(0, _o0 - 1),
                               { text: _prev.text + ' ' + sanitized[_o0].text, type: 'anchor' },
                               ...sanitized.slice(_o0 + 1)];
                  _o0Changed = true; break;
                }
              }
            }
          }
        }

        // ── [OPT-1] Merge ALL adjacent lime lines → 1 dòng script_climax dominant ─────
        // Handle mọi combo Gemini hay trả:
        //   script + script_climax       → merge
        //   script_climax + script_climax → merge
        //   script_climax + script       → merge  ← case mới (trước bị miss)
        //   script + script              → merge
        // While loop để handle 3+ lime liên tiếp (mỗi pass merge 1 cặp)
        { let _opt1Changed = true;
          while (_opt1Changed) {
            _opt1Changed = false;
            for (let _oi = 0; _oi < sanitized.length - 1; _oi++) {
              if (['script', 'script_climax'].includes(sanitized[_oi].type) &&
                  ['script', 'script_climax'].includes(sanitized[_oi + 1].type)) {
                const _om = { text: sanitized[_oi].text + ' ' + sanitized[_oi + 1].text, type: 'script_climax' };
                sanitized = [...sanitized.slice(0, _oi), _om, ...sanitized.slice(_oi + 2)];
                _opt1Changed = true;
                break;
              }
            }
          }
        }

        // ── [OPT-2] Promote regular → anchor nếu thiếu focal point trắng ──────────
        // Gemini đôi khi không assign anchor → peak mất dòng trắng đậm dominant
        // Rule: nếu không có anchor nhưng có script_climax → promote regular đủ tiêu chí
        // Tiêu chí: ≤3 từ + không kết thúc giới từ (giống anchor guard ban đầu)
        if (!sanitized.some(c => c.type === 'anchor') && sanitized.some(c => c.type === 'script_climax')) {
          const _oai = sanitized.findIndex(c => {
            if (c.type !== 'regular') return false;
            const _owc = c.text.trim().split(/\s+/).filter(Boolean).length;
            if (_owc > 3) return false;
            if (layout.peak.anchorEndBlockPattern && layout.peak.anchorEndBlockPattern.test(c.text)) return false;
            // Không promote nếu bắt đầu bằng liên từ/đại từ — anchor phải là concept độc lập
            if (/^(và|nhưng|mà|thì|nó|họ|ta|chúng|đó|đây|khi|nếu|vì|do|bởi|để)\s/i.test(c.text.trim())) return false;
            return true;
          });
          if (_oai !== -1) sanitized = sanitized.map((c, i) => i === _oai ? { ...c, type: 'anchor' } : c);
        }

        // ── [OPT-3] Merge connector/regular kẹp giữa anchor và script_climax ─────────
        // Pattern: anchor → connector("nó sẽ") → script_climax → connector thừa, làm loãng
        // Guard: chỉ merge nếu tổng từ ≤ 5 (tránh tràn dòng) + không vi phạm climaxBlockRules
        {
          const _oa3 = sanitized.findIndex(c => c.type === 'anchor');
          let _oc3 = -1; sanitized.forEach((c, i) => { if (c.type === 'script_climax') _oc3 = i; });
          if (_oa3 !== -1 && _oc3 !== -1 && _oc3 > _oa3 + 1) {
            const _ob3 = [];
            for (let _i3 = _oa3 + 1; _i3 < _oc3; _i3++) {
              if (['connector', 'regular'].includes(sanitized[_i3].type)) _ob3.push(_i3);
            }
            if (_ob3.length > 0) {
              const _bt3  = _ob3.map(i => sanitized[i].text).join(' ');
              const _nt3  = _bt3 + ' ' + sanitized[_oc3].text;
              const _wc3  = _nt3.trim().split(/\s+/).filter(Boolean).length;
              const _lo3  = _nt3.trim().toLowerCase();
              const _blk3 = layout.peak.climaxBlockRules && layout.peak.climaxBlockRules.some(rx => rx.test(_lo3));
              if (_wc3 <= 5 && !_blk3) {
                const _keep3 = new Set([..._ob3, _oc3]);
                let _tmp3 = sanitized.filter((_, i) => !_keep3.has(i));
                _tmp3.splice(_oa3 + 1, 0, { text: _nt3, type: 'script_climax' });
                sanitized = _tmp3;
              }
            }
          }
        }

        // ── [OPT-R] Rescue — đảm bảo LUÔN có script_climax ─────────────────────────
        // climaxBlockRules đôi khi over-conservative (block "mà", "là", "thì" → kill lime)
        // → nếu sau tất cả OPTs vẫn không có script_climax, promote chunk cuối cùng
        //   là regular/script lên script_climax (không dùng lại climaxBlockRules ở đây)
        // Case điển hình: "mà dựa trên lời bạn nói" bị demote → regular/script
        //   → không còn lime line → peak trắng đều → OPT-R tự cứu
        if (!sanitized.some(c => c.type === 'script_climax')) {
          let _ri = -1;
          for (let _r = sanitized.length - 1; _r >= 0; _r--) {
            if (['regular', 'script'].includes(sanitized[_r].type)) { _ri = _r; break; }
          }
          if (_ri !== -1) {
            sanitized = sanitized.map((c, i) => i === _ri ? { ...c, type: 'script_climax' } : c);
          }
        }

        // Max chunks cap tại render time
        const _maxC = layout.peak.maxChunks || 4;
        while (sanitized.length > _maxC) {
          let mi = -1;
          for (let i = 0; i < sanitized.length - 1; i++) {
            const a = sanitized[i].type, b = sanitized[i+1].type;
            if (['connector','regular'].includes(a) && ['connector','regular'].includes(b)) { mi = i; break; }
          }
          if (mi === -1) mi = 0;
          const m = { text: sanitized[mi].text + ' ' + sanitized[mi+1].text,
                      type: sanitized[mi].type === 'regular' ? 'regular' : sanitized[mi+1].type };
          sanitized = [...sanitized.slice(0, mi), m, ...sanitized.slice(mi + 2)];
        }
        return sanitized;
        // ─────────────────────────────────────────────────────────────────────
      })();

      let wGlobal = 0;
      let chunksHtml = "";
      const goldSet = new Set(); // wGlobal indices of gold (script/script_climax) words
      const renderedChunkIds = [];

      // sentence.words là canonical token source (đã fix Case C trong normalizeSentenceImpl)
      // chunk.text chỉ dùng để: (1) đếm số từ chunk chiếm, (2) xác định type
      // → HTML span count = sentence.words.length = GSAP loop count, luôn luôn đúng
      const canonWords = sentence.words;
      let wPtr = 0; // con trỏ vào canonWords

      // Smart indent: tự canh lề line 2 sau ký tự đầu anchor, line 3 sau cuối line 2
      const smartResult  = getPeakSmartIndentsImpl(chunks);  // null | {indents, climaxExtraTopPull}
      const smartIndents = smartResult ? smartResult.indents : null;

      // renderedChunkIds được khai báo ở loop scope (phía trên if block này)
      // → sẽ được populate trong chunks.forEach bên dưới

      // ── TYB Adaptive sizing: detect anchor presence ONCE cho toàn cascade ──────
      // Rule: có anchor → anchor=hero(124px), climax=accent(82px), regular=support(52px)
      //       ko anchor → climax=hero(100px), regular=label(28px) — climax dominates
      const _cascadeHasAnchor = chunks.some(c => c.type === 'anchor');
      const _LP = layout.peak;
      const _LS = layout.subtitle;

      chunks.forEach((chunk, lineIdx) => {
        // ── Indent: smart indent nếu có anchor → staircase tự động
        //   No-anchor: climax lấy max(peakNoAnchorClimaxIndent, lineIdx×step) để đủ rõ ràng
        const indent = smartIndents
          ? smartIndents[lineIdx]
          : (!_cascadeHasAnchor && chunk.type === 'script_climax')
            ? Math.max(_LP.peakNoAnchorClimaxIndent, lineIdx * _LS.peakIndentStep)
            : lineIdx * _LS.peakIndentStep;
        const isGold = chunk.type === "script_climax";

        // ── Adaptive chunk font size (TYB rule 2) ─────────────────────────────
        const _chunkFontSize = (() => {
          switch (chunk.type) {
            case 'anchor':        return _LS.peakAnchorSize;
            case 'connector':     return _LS.peakConnectorSize;
            case 'script':        return _LS.peakScriptSize;
            case 'regular':       return _cascadeHasAnchor ? _LS.peakRegularSize : _LP.peakRegularSizeFaded;
            case 'script_climax': return _cascadeHasAnchor ? _LS.peakScriptClimaxSize : _LP.peakClimaxSizeHero;
            default:              return _LS.peakRegularSize;
          }
        })();

        // Đếm từ của chunk qua foldText alignment với canonWords
        // Ưu tiên foldText match; fallback về chunk.text word count
        const chunkFolded = foldTextImpl(chunk.text.replace(/\s+/g, ""));
        let cf = "";
        let endPtr = wPtr;
        while (endPtr < canonWords.length && cf.length < chunkFolded.length) {
          cf += foldTextImpl(canonWords[endPtr]);
          endPtr++;
          if (cf === chunkFolded) break;
        }
        // Fallback: nếu foldText alignment thất bại (vd: nội dung khác hoàn toàn)
        if (endPtr === wPtr || cf !== chunkFolded) {
          const fallbackCount = chunk.text.split(/\s+/).filter(Boolean).length;
          endPtr = Math.min(wPtr + fallbackCount, canonWords.length);
        }
        if (endPtr > canonWords.length) endPtr = canonWords.length;
        if (endPtr <= wPtr) endPtr = Math.min(wPtr + 1, canonWords.length); // ít nhất 1 từ

        // ── TYB rule 1: Per-word function word reduction trong anchor chunk ────
        // Anchor chunk mà có MIX từ hư + từ nội dung → từ hư xuống _LP.peakFunctionWordScale × size
        // Ví dụ: "sẽ đốt cơ" → "sẽ"(35px) + "đốt cơ"(124px) — giống TYB "lại GIẢM"
        const _chunkWds = canonWords.slice(wPtr, endPtr);
        const _hasContentWd = chunk.type === 'anchor'
          && _chunkWds.some(w => !peakFunctionWords.has(foldTextImpl(w)));

        // Tạo spans từ canonWords (đúng token) — không phải từ chunk.text
        const spans = canonWords.slice(wPtr, endPtr).map(w => {
          const wId = `s${sIdx}-w${wGlobal}`;
          if (isGold) goldSet.add(wGlobal);
          wGlobal++;
          const cls = isGold ? "word word-peak-key" : "word";
          // Function word trong anchor → thu nhỏ; mọi word đều lấy adaptive _chunkFontSize
          const _isFuncWd = _hasContentWd && peakFunctionWords.has(foldTextImpl(w));
          const _wordSz   = _isFuncWd
            ? Math.max(_LP.peakFunctionWordMinSize, Math.round(_chunkFontSize * _LP.peakFunctionWordScale))
            : _chunkFontSize;
          return `<span class="${cls}" id="${wId}" style="font-size:${_wordSz}px !important">${escapeHtml(w)}</span>`;
        });
        wPtr = endPtr;

        if (!spans.length) return; // skip chunk rỗng
        const typeClass = `peak-chunk peak-chunk-${chunk.type.replace("_", "-")}`;
        // ── script_climax: luôn áp dụng dead-space correction của DVN Grandy (không chỉ khi có smartResult)
        // Dead-space ≈ 12% font-size ở trên glyph của DVN Grandy → margin-top âm để bù
        // Nếu có smartResult: cộng thêm climaxExtraTopPull (kéo sát line trên hơn nữa)
        // Dynamic: dùng _chunkFontSize (82px accent hoặc 100px hero) thay vì hằng số tĩnh
        const smartTopStyle = (chunk.type === 'script_climax')
          ? `margin-top:${-Math.round(_chunkFontSize * 0.12) - (smartResult ? smartResult.climaxExtraTopPull : 0)}px;`
          : '';
        const chunkId = `${sId}-c${lineIdx}`;
        renderedChunkIds.push(chunkId);
        chunksHtml += `<div id="${chunkId}" class="${typeClass}" style="padding-left:${indent}px;${smartTopStyle}">${spans.join("")}</div>`;
      });

      // Safety: còn từ thừa sau khi duyệt hết chunks → gắn vào chunk cuối
      if (wPtr < canonWords.length) {
        const lastType = chunks.length > 0 ? chunks[chunks.length - 1].type : "regular";
        const isGold = lastType === "script_climax";
        const overflow = canonWords.slice(wPtr).map(w => {
          const wId = `s${sIdx}-w${wGlobal}`;
          if (isGold) goldSet.add(wGlobal);
          wGlobal++;
          const cls = isGold ? "word word-peak-key" : "word";
          return `<span class="${cls}" id="${wId}">${escapeHtml(w)}</span>`;
        });
        const typeClass = `peak-chunk peak-chunk-${lastType.replace("_", "-")}`;
        chunksHtml += `<div class="${typeClass}">${overflow.join("")}</div>`;
        wPtr = canonWords.length;
      }

      // Lưu goldSet vào sentence để GSAP dùng
      sentence.__goldSet = goldSet;
      sentence.__renderedChunkIds = renderedChunkIds;

      subtitlesHtml += `
        <div class="sentence sentence-peak" id="${sId}" data-start="${fmt(sentence.startTime)}" data-end="${fmt(sentence.endTime)}" data-style="peak">
          ${chunksHtml}
        </div>`;
    } else {
      // ── NORMAL / EMPHASIS: flat word list ────────────────────────
      for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
        const wId = `s${sIdx}-w${wIdx}`;
        wordsHtml += `<span class="word" id="${wId}">${escapeHtml(sentence.words[wIdx])}</span>`;
      }
      subtitlesHtml += `
        <div class="sentence${styleClass}" id="${sId}" data-start="${fmt(sentence.startTime)}" data-end="${fmt(sentence.endTime)}" data-style="${sStyle}">${wordsHtml}
        </div>`;
    }
  }

  let gsapCode = `
      window.__timelines = window.__timelines || {};
      window.__countUps = window.__countUps || [];

      /* ── Lottie init — load each animation from inline data ────── */
      // Màu gốc của icon được giữ nguyên — brightness & glow đã baked vào inline style
      // server-side bởi getLottieIconFilter() (Node.js), không cần xử lý lại ở browser
      window.__lottieAnims = {};
      (function initLottie() {
        var data = window.__lottieData || {};
        Object.keys(data).forEach(function(cardId) {
          var animData = data[cardId];
          if (!animData) return;
          var container = document.getElementById('lottie-' + cardId);
          if (!container) return;
          try {
            window.__lottieAnims[cardId] = lottie.loadAnimation({
              container: container,
              animationData: animData,
              renderer: 'svg',
              loop: true,
              autoplay: false
            });
          } catch(e) { /* skip broken animations */ }
        });
      })();

      const tl = gsap.timeline({ paused: true, smoothChildTiming: true });

      // fromToIfPresent: safe GSAP helper — skips if element not found
      function fromToIfPresent(selector, fromVars, toVars, at) {
        const targets = Array.from(document.querySelectorAll(selector));
        if (targets.length) tl.fromTo(targets, fromVars, toVars, at);
      }

      tl.set("#hook-dim", { opacity: 0 }, 0);
      tl.to("#hook-dim", { opacity: 1, duration: 0.18, ease: "power1.out" }, 0);
      tl.to("#hook-dim", { opacity: 0, duration: 0.42, ease: "power2.inOut" }, 3.220);
      tl.set("#opening-hook", { opacity: 0, y: 34, scale: 0.9 }, 0);
      tl.set("#opening-hook .hook-title", { filter: "brightness(1.25)", textShadow: "0 10px 24px rgba(0,0,0,0.92), 0 0 34px rgba(166,255,61,0.38)" }, 0);
      tl.to("#opening-hook", { opacity: 1, y: 0, scale: 1, duration: 0.46, ease: "back.out(1.55)" }, 0.160);
      tl.to("#opening-hook .hook-title", { scale: 1.035, duration: 0.36, yoyo: true, repeat: 1, ease: "sine.inOut" }, 0.620);
      tl.to("#opening-hook .hook-title", { filter: "brightness(1)", textShadow: "0 10px 24px rgba(0,0,0,0.92), 0 0 16px rgba(255,255,255,0.25), 0 0 26px rgba(166,255,61,0.18)", duration: 0.32, ease: "power2.out" }, 1.180);
      tl.to("#opening-hook", { opacity: 0, y: -24, duration: 0.36, ease: "power2.in" }, 4.200);`;

  // Tính top cho từng card — đẩy xuống nếu có card khác đang hiển thị cùng lúc
  const cardTops = renderOverlays.map((card, i) => {
    const start   = toSecondsImpl(card.startTime, 0);
    const end     = toSecondsImpl(card.endTime,   0);
    const baseTop = card.type === "STAT" ? layout.card.statTop : layout.card.defaultTop;
    const stackCount = renderOverlays.slice(0, i).filter(prev => {
      return toSecondsImpl(prev.startTime, 0) < end && toSecondsImpl(prev.endTime, 0) > start;
    }).length;
    return baseTop + stackCount * layout.card.stackOffset;
  });

  for (let i = 0; i < renderOverlays.length; i++) {
    const card = renderOverlays[i];
    const cardId = `card-${i}`;
    const slideInTime = toSecondsImpl(card.startTime, 0);
    const hasLottie = cardHasLottie[i];

    // Clip endTime: tìm card khác (khác list_group) bắt đầu SỚM NHẤT sau card này.
    // Scan toàn bộ array vì renderOverlays không đảm bảo sorted theo thời gian.
    let nextBoundaryStart = Infinity;
    for (let j = 0; j < renderOverlays.length; j++) {
      if (j === i) continue;
      const nxt = renderOverlays[j];
      const sameGroup = card.list_group && card.list_group === nxt.list_group;
      if (sameGroup) continue;
      const nxtStart = toSecondsImpl(nxt.startTime, Infinity);
      if (nxtStart > slideInTime && nxtStart < nextBoundaryStart) nextBoundaryStart = nxtStart;
    }
    const rawEnd = toSecondsImpl(card.endTime, slideInTime + 3.5);
    const clippedEnd = nextBoundaryStart < rawEnd ? nextBoundaryStart - 0.05 : rawEnd;
    const fadeOutTime = Math.max(slideInTime + 0.65, clippedEnd - 0.45);
    // Hard kill phải xảy ra trước nextBoundaryStart bất kể fadeOutTime tính ra sao
    const killTime = nextBoundaryStart < Infinity
      ? Math.min(fadeOutTime + 0.43, nextBoundaryStart - 0.02)
      : fadeOutTime + 0.43;
    const vrKillTime = nextBoundaryStart < Infinity
      ? Math.min(fadeOutTime + 0.40, nextBoundaryStart - 0.02)
      : fadeOutTime + 0.40;

    const left    = card.type === "STAT" ? layout.card.statLeft : layout.card.infoLeft;
    const cardTop = cardTops[i];
    gsapCode += `

      /* Float-up entrance — luxury feel, không slide cứng từ trái */
      tl.set("#${cardId}", { top: ${cardTop}, left: ${left}, x: 0, y: 22, scale: 0.96, opacity: 0 }, 0);
      tl.to("#${cardId}", { y: 0, scale: 1, opacity: 1, duration: 0.58, ease: "power3.out" }, ${fmt(slideInTime)});
      tl.to("#${cardId}", { y: -10, scale: 0.97, opacity: 0, duration: 0.38, ease: "power2.in" }, ${fmt(fadeOutTime)});
      tl.set("#${cardId}", { visibility: "hidden" }, ${fmt(killTime)});`;

    if (card.type === "STAT") {
      // Universal entrance animations (neon bar, value fade-up, divider, label)
      gsapCode += `
      fromToIfPresent("#${cardId} .stat-value", { y: 14, opacity: 0, filter: "blur(5px)" }, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.42, ease: "power3.out" }, ${fmt(slideInTime + 0.12)});
      fromToIfPresent("#${cardId} .stat-neon-bar", { scaleY: 0, transformOrigin: "bottom center" }, { scaleY: 1, duration: 0.46, ease: "power4.out" }, ${fmt(slideInTime + 0.04)});
      fromToIfPresent("#${cardId} .stat-divider-fill", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: 0.9, ease: "power3.out" }, ${fmt(slideInTime + 0.22)});
      fromToIfPresent("#${cardId} .stat-label", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.42, ease: "power3.out" }, ${fmt(slideInTime + 0.34)});`;
      // Metric counter animation — generated by MetricRenderer for this card's type
      if (metricRenderMap[cardId]) {
        gsapCode += metricRenderMap[cardId];
      }
    } else {
      gsapCode += `
      fromToIfPresent("#${cardId} .badge",       { y: 8, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: "back.out(1.8)" }, ${fmt(slideInTime + 0.1)});
      fromToIfPresent("#${cardId} .card-title",  { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: "power3.out" }, ${fmt(slideInTime + 0.18)});
      fromToIfPresent("#${cardId} .card-body",   { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.34, ease: "power3.out" }, ${fmt(slideInTime + 0.26)});
      ${hasLottie ? `/* Float icon: TYB style — góc trên-phải card, CSS right/top định vị */
      tl.set('#lottie-${cardId}', { opacity: 0, visibility: 'visible', scale: 0 }, 0);
      fromToIfPresent("#lottie-${cardId}", { scale: 0, rotation: -20, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.52, ease: "back.out(2.2)" }, ${fmt(slideInTime + 0.28)});
      tl.add(function() { var a = window.__lottieAnims['${cardId}']; if (a) a.goToAndPlay(0, true); }, ${fmt(slideInTime + 0.28)});
      tl.to("#lottie-${cardId}", { scale: 0.9, opacity: 0, duration: 0.28, ease: "power2.in" }, ${fmt(fadeOutTime)});
      tl.add(function() { var a = window.__lottieAnims['${cardId}']; if (a) a.stop(); }, ${fmt(killTime)});
      tl.set("#lottie-${cardId}", { visibility: "hidden" }, ${fmt(killTime)});` : ""}`; 
    }
  }

  gsapCode += `

      /* ── NORMAL subtitle word styles ─────────────────────────── */
      const activeStyle = {
        color: "#a6ff3d",
        opacity: 1,
        scale: 1.08,
        textShadow: "0 0 18px rgba(166, 255, 61, 0.78), 0 6px 12px rgba(0, 0, 0, 0.9)",
        duration: 0.12,
        ease: "back.out(1.65)"
      };
      const inactiveStyle = {
        color: "#ffffff",
        opacity: 0.38,
        scale: 1.0,
        textShadow: "0 6px 12px rgba(0, 0, 0, 0.9), 0 0 10px rgba(0, 0, 0, 0.6)",
        duration: 0.12,
        ease: "power2.out"
      };



      /* ── PEAK subtitle word styles ────────────────────────────── */
      /* Regular peak words: subtle highlight only — key words provide the visual anchor */
      const peakActiveStyle = {
        color: "#ffffff",
        opacity: 1,
        scale: 1.05,     /* was 1.28 → reduced: at 38px, 1.28x = 48px which overlaps neighbors */
        textShadow: "0 0 18px rgba(255,255,255,0.55), 0 4px 14px rgba(0, 0, 0, 0.95)",
        duration: 0.14,
        ease: "power2.out"
      };
      const peakInactiveStyle = {
        color: "rgba(255,255,255,0.70)",
        opacity: 1,
        scale: 1.0,
        textShadow: "0 4px 14px rgba(0, 0, 0, 0.95), 0 8px 30px rgba(0, 0, 0, 0.80)",
        duration: 0.14,
        ease: "power2.out"
      };`;

  for (let sIdx = 0; sIdx < renderSentences.length; sIdx++) {
    const sentence = renderSentences[sIdx];
    const sId = `sentence-${sIdx}`;
    const sStyle = sentence.style || "normal";
    const sDuration = sentence.endTime - sentence.startTime;
    const wordCount = Math.max(1, sentence.words.length);
    const wordDuration = sDuration / wordCount;

    // ── Sentence entrance animation — varies by style ──────────
    // peakOffset baked in as literal via Node.js template evaluation
    if (sStyle === "peak") {
      // ── Peak: per-chunk stagger animation — các hàng xuất hiện từ dưới lên ──
      // Container chỉ xử lý position; opacity được delegate xuống từng chunk
      const PA = layout.peakAnim;
      const renderedChunkIds = sentence.__renderedChunkIds || [];
      const numRC = renderedChunkIds.length;

      // Container: đặt vị trí ở time 0, ẩn đến tận lúc startTime
      gsapCode += `\n      tl.set("#${sId}", { top: ${layout.subtitle.peakTop - layout.subtitle.top}, xPercent: -50, x: 0, opacity: 0 }, 0);`;
      gsapCode += `\n      tl.set("#${sId}", { opacity: 1 }, ${fmt(sentence.startTime)});`;

      // Mỗi chunk: set ẩn tại time 0, enter từ dưới lên (bottom-first), exit từ trên xuống
      for (let ci = 0; ci < numRC; ci++) {
        const cId          = renderedChunkIds[ci];
        const enterDelay   = fmt(sentence.startTime + (numRC - 1 - ci) * PA.enterStagger);
        const exitDelay    = fmt(sentence.endTime   + ci              * PA.exitStagger);
        gsapCode += `\n      tl.set("#${cId}", { opacity: 0, y: ${PA.enterY}, x: ${PA.enterX} }, 0);`;
        gsapCode += `\n      tl.to("#${cId}", { opacity: 1, y: 0, x: 0, duration: ${PA.enterDuration}, ease: "${PA.enterEase}" }, ${enterDelay});`;
        gsapCode += `\n      tl.to("#${cId}", { opacity: 0, y: ${PA.exitY}, duration: ${PA.exitDuration}, ease: "${PA.exitEase}" }, ${exitDelay});`;
      }

      // Ẩn container sau khi chunk cuối exit xong
      const containerHide = fmt(sentence.endTime + (numRC > 0 ? (numRC - 1) * PA.exitStagger : 0) + PA.exitDuration + 0.01);
      gsapCode += `\n      tl.set("#${sId}", { opacity: 0 }, ${containerHide});`;
    } else {
      gsapCode += `
      tl.to("#${sId}", { opacity: 1, duration: 0.1 }, ${fmt(sentence.startTime)});
      tl.to("#${sId}", { opacity: 0, duration: 0.15 }, ${fmt(sentence.endTime)});`;
    }

    // ── Word karaoke — pick style set based on sentence style ──
    const activeVar   = sStyle === "peak" ? "peakActiveStyle"   : "activeStyle";
    const inactiveVar = sStyle === "peak" ? "peakInactiveStyle" : "inactiveStyle";

    // For peak: goldSet = word indices of script/script_climax chunks (from HTML gen step)
    const goldSet = sStyle === "peak" ? (sentence.__goldSet || new Set()) : new Set();

    for (let wIdx = 0; wIdx < sentence.words.length; wIdx++) {
      const wId = `s${sIdx}-w${wIdx}`;
      const wStart = sentence.startTime + wIdx * wordDuration;
      const wEnd = sentence.startTime + (wIdx + 1) * wordDuration;

      if (sStyle === "peak" && goldSet.has(wIdx)) {
        // Gold word (script/script_climax): scale-pulse only — no color karaoke
        gsapCode += `
      tl.to("#${wId}", { scale: 1.12, duration: 0.14, ease: "back.out(1.8)" }, ${fmt(wStart)});
      tl.to("#${wId}", { scale: 1.0,  duration: 0.14 }, ${fmt(wEnd)});`;
      } else {
        gsapCode += `
      tl.to("#${wId}", ${activeVar}, ${fmt(wStart)});
      tl.to("#${wId}", ${inactiveVar}, ${fmt(wEnd)});`;
      }
    }
  }

  // Gap image GSAP
  imageGapSegments.forEach((seg, i) => {
    const st  = toSecondsImpl(seg.startTime, 0);
    const end = toSecondsImpl(seg.endTime, 0);
    const outro = Math.max(st + 0.5, end - 0.4);
    gsapCode += `
      tl.set("#gap-img-${i}", { opacity: 0 }, 0);
      tl.to("#gap-img-${i}", { opacity: 1, duration: 0.5, ease: "power2.out" }, ${st.toFixed(3)});
      fromToIfPresent("#gap-img-${i} img", { scale: 0.88, filter: "blur(12px)" }, { scale: 1.0, filter: "blur(0px)", duration: 0.5, ease: "power2.out" }, ${st.toFixed(3)});
      tl.to("#gap-img-${i}", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${outro.toFixed(3)});`;
  });

  // Progressive list: dim previous cards when next item appears
  for (let ci = 0; ci < renderOverlays.length; ci++) {
    const card = renderOverlays[ci];
    if ((card.list_style === 'progressive' || card.list_style === 'steps_overview') && card.list_index > 1) {
      const prevCards = renderOverlays.filter((c, pi) =>
        pi < ci && c.list_group && c.list_group === card.list_group
      );
      for (const prev of prevCards) {
        const prevIdx = renderOverlays.indexOf(prev);
        gsapCode += `
      tl.to("#card-${prevIdx}", { opacity: 0.28, duration: 0.25, ease: "power2.out" }, ${fmt(card.startTime)});`;
      }
    }
  }

  gsapCode += `

      window.__timelines["elegant-maxwell"] = tl;

      // Count-up registry: filled by renderMetric for each STAT card
      // Format: { id, targetValue, startTime, endTime, isFloat }
      window.__countUps = window.__countUps || [];

      function formatMetricNumber(cu, value) {
        const decimals = Number.isFinite(cu.decimals) ? Math.max(0, cu.decimals) : (cu.isFloat ? 1 : 0);
        return new Intl.NumberFormat(cu.locale || "vi-VN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        }).format(value);
      }

      function hydrateCountUpsFromDom() {
        window.__countUps = window.__countUps || [];
        const existing = new Set(window.__countUps.map(function(cu) { return cu.id; }));
        document.querySelectorAll(".metric-number[data-countup-target]").forEach(function(el) {
          if (!el.id || existing.has(el.id)) return;
          const targetValue = Number(el.dataset.countupTarget);
          const startTime = Number(el.dataset.countupStart);
          const endTime = Number(el.dataset.countupEnd);
          if (!Number.isFinite(targetValue) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
          window.__countUps.push({
            id: el.id,
            targetValue,
            startTime,
            endTime,
            isFloat: el.dataset.countupFloat === "1",
            decimals: Number(el.dataset.countupDecimals || 0),
            locale: "vi-VN"
          });
          existing.add(el.id);
        });
      }

      function syncActiveSentence(time) {
        const sentences = Array.from(document.querySelectorAll(".sentence"));
        let active = null;
        let activeStart = -Infinity;

        sentences.forEach(function(sentence) {
          const start = Number(sentence.dataset.start);
          const end = Number(sentence.dataset.end);
          if (!Number.isFinite(start) || !Number.isFinite(end)) return;
          if (time >= start && time < end && start >= activeStart) {
            active = sentence;
            activeStart = start;
          }
        });

        sentences.forEach(function(sentence) {
          const isActive = sentence === active;
          sentence.style.opacity = isActive ? "1" : "0";
          sentence.style.visibility = isActive ? "visible" : "hidden";
          sentence.style.pointerEvents = "none";
        });
      }

      window.renderAt = function(t) {
        const time = Math.max(0, Number(t) || 0);

        // Update all count-up metrics directly — GSAP seek cannot do this
        hydrateCountUpsFromDom();

        tl.pause();
        tl.seek(time, false);
        syncActiveSentence(time);

        window.__countUps.forEach(function(cu) {
          const el = document.getElementById(cu.id);
          if (!el) return;
          if (time < cu.startTime) {
            el.textContent = formatMetricNumber(cu, 0);
            return;
          }
          if (time >= cu.endTime) {
            el.textContent = formatMetricNumber(cu, cu.targetValue);
            return;
          }
          // ease-out progress
          const raw = (time - cu.startTime) / (cu.endTime - cu.startTime);
          const p = Math.max(0, Math.min(raw, 1));
          const eased = 1 - Math.pow(1 - p, 3);
          const val = cu.targetValue * eased;
          el.textContent = formatMetricNumber(cu, cu.isFloat ? val : Math.round(val));
        });

        // Advance Lottie animations — goToAndStop(frame) at current time
        var anims = window.__lottieAnims || {};
        Object.keys(anims).forEach(function(cardId) {
          var anim = anims[cardId];
          if (!anim || !anim.totalFrames) return;
          var totalF = anim.totalFrames;
          var fps    = anim.frameRate || 30;
          // Fallback: nếu getDuration() không khả dụng → tính từ totalFrames/fps
          var dur = (anim.getDuration && anim.getDuration(false)) || (totalF / fps);
          if (!dur) return;
          var frame = (time % dur) / dur * totalF;
          anim.goToAndStop(Math.floor(frame), true);
        });

        return time;
      };
  `;

  const stylesHtml = generateStylesImpl(layout);

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>CNFI Premium TikTok Composition</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800;900&display=block" rel="stylesheet">

${stylesHtml}
  </head>
  <body>
    <!-- Preload DVN Grandy: force browser to fetch hero font before first frame -->
    <div style="position:absolute;opacity:0;pointer-events:none;font-family:'${layout.subtitle.peakScriptClimaxFont}';font-size:90px;top:-9999px;left:-9999px;" aria-hidden="true">preload</div>
        <div
      id="root"
      data-composition-id="elegant-maxwell"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="1080"
      data-height="1920"
    >
      <div class="global-neon-rail"></div>
      <div class="vignette" aria-hidden="true"></div>
      ${hookDimHtml}
      ${hookHtml}

      <!-- Overlay clip zone: static clip-path giữ tất cả cards/vr không vượt qua neon bar -->
      <div id="overlay-clip" style="position:absolute;inset:0;pointer-events:none;z-index:3;clip-path:inset(0px 0px 0px ${layout.card.introX < 0 ? layout.card.neonBarLeft : 0}px);">

      ${visualRowsHtml}

      ${imageGapSegments.map((seg, i) => {
        const currentAssetMap = typeof getAssetMap === 'function' ? getAssetMap() : (getAssetMap || new Map());
        const entry = currentAssetMap.get(seg.image_key);
        if (!entry) return '';
        const src = entry.path.replace(/\\/g, '/');
        return `<div class="gap-img-wrap" id="gap-img-${i}" aria-hidden="true"><div class="gap-img-bg"></div><img src="${src}" style="${buildImageStyleImpl(entry, 'border-radius:16px;')}" alt=""></div>`;
      }).join('')}

      <div class="card-container">
        ${cardsHtml}
      </div>

      </div><!-- /overlay-clip -->

      <!-- Brand watermark — top-center, ngoài overlay-clip để không bị clip-path cắt -->
      <div style="
        position:absolute;top:44px;left:50%;transform:translateX(-50%);z-index:99;pointer-events:none;
        display:flex;flex-direction:column;align-items:center;gap:0;
        background:rgba(0,0,0,0.32);padding:7px 14px 9px 14px;
        border-radius:6px;backdrop-filter:blur(2px);
      ">
        <div style="
          font-family:'Be Vietnam Pro',sans-serif;font-size:10px;font-weight:700;
          letter-spacing:0.16em;color:#9AC33B;white-space:nowrap;line-height:1;margin-bottom:2px;
        ">CONDITIONING &amp; NUTRITION FATLOSS</div>
        <div style="
          font-family:'Be Vietnam Pro',sans-serif;font-size:38px;font-weight:900;
          color:#ffffff;letter-spacing:-0.02em;line-height:0.88;
          text-shadow:0 2px 8px rgba(0,0,0,0.5);
        ">CNFI</div>
        <div style="width:100%;height:2px;background:#9AC33B;margin-top:5px;border-radius:1px;"></div>
      </div>

      <div class="subtitle-container">
        ${subtitlesHtml}
      </div>
    </div>

    <script>
      /* Inline Lottie animation data — keyed by cardId ("card-0", "card-1", ...) */
      window.__lottieData = ${JSON.stringify(lottieDataMap)};
    </script>
    <script>
      ${gsapCode}
    </script>
  </body>
</html>`;
}

  return {
    generatePremiumHTML
  };
}
