/**
 * ============================================================
 * Subtitle Sentence Splitting Module
 * ============================================================
 * Handles semantic splitting of over-long subtitle sentences and
 * peak sentence lead-in extraction with synthetic connector alignment.
 *
 * Extracted from pipeline.js in Phase 6.
 * ============================================================
 */

export const VIET_PHRASE_STARTERS = new Set([
  'và','hoặc','hay','nhưng','mà','nên','vì','nếu','khi','sau','trước',
  'trong','với','từ','cho','tại','qua','đến','về','theo','bằng','giữa',
  'giúp','làm','có','là','được','tạo','giảm','tăng','cải','hỗ','thúc',
  'omega','vitamin','protein','glucose','glut','cortisol','insulin'
]);

export function findSemanticSplitPoint(words, maxWords) {
  const n = words.length;
  const mid = Math.ceil(n / 2);
  // Tìm điểm tách tốt nhất trong khoảng [2, n-2]
  // Ưu tiên: đứng trước từ đầu cụm + gần giữa câu
  let best = mid;
  let bestScore = -Infinity;
  for (let i = 2; i <= n - 2; i++) {
    const leftOk  = i <= maxWords;
    const rightOk = (n - i) <= maxWords;
    if (!leftOk || !rightOk) continue;
    const isPhraseBoundary = VIET_PHRASE_STARTERS.has(words[i].toLowerCase()) ? 20 : 0;
    const nearMid = -Math.abs(i - mid) * 2;
    const score = isPhraseBoundary + nearMid;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export function createSubtitleSplitter({
  normalizeSentence,
  foldText,
  maxWordsDefault,
  warn
}) {
  function _splitLongSentencesOnce(sentences, maxWords) {
    const out = [];
    for (const s of sentences) {
      if (s.style === 'peak') {
        // ── Peak split: leading regular/connector trước anchor → normal, anchor+rest → peak ──
        // Vd: "người được thông báo | ngủ sâu | đạt điểm cao hơn đáng kể"
        //   → normal("người được thông báo") + peak(anchor+script_climax)
        const pl = s.peakLines;
        const anchorIdx = pl ? pl.findIndex(c => c.type === 'anchor') : -1;
        if (anchorIdx > 0) {
          // Đếm từ trong các chunk trước anchor
          const leadWords = pl.slice(0, anchorIdx)
            .reduce((n, c) => n + c.text.trim().split(/\s+/).filter(Boolean).length, 0);
          const remWords  = s.words.length - leadWords;
          // Chỉ split khi lead ≥ 2 từ, phần peak còn lại ≥ 3 từ, câu đủ dài (>6 từ)
          if (leadWords >= 2 && remWords >= 3 && s.words.length > 6) {
            const dur       = s.endTime - s.startTime;
            const splitTime = s.startTime + (leadWords / s.words.length) * dur;
            // Phần normal (lead-in): chạy trước
            out.push({
              ...s,
              words:     s.words.slice(0, leadWords),
              text:      s.words.slice(0, leadWords).join(' '),
              endTime:   splitTime,
              style:     'normal',
              peakLines: null,
            });
            // Phần peak (anchor + rest): re-run normalizeSentence với words thực tế
            // Vấn đề: pl.slice(anchorIdx) chứa chunk texts từ câu GỐC, nhưng phần split
            // có thể có thêm leading words không nằm trong chunk nào (orphaned words)
            // → HTML alignment vỡ (lỗi "một cái / lượng lợi / ích khổng lồ")
            //
            // Fix: synthetic peak_lines = connector(orphaned) + Gemini chunks
            //   Ví dụ: split portion = ["một","cái","lượng","lợi","ích","khổng","lồ","cho","sức","khỏe"]
            //          Gemini chunks = anchor("lợi ích") + sc("khổng lồ") + regular("cho sức khỏe") = 7 words
            //          orphanCount = 10 - 7 = 3 → prepend connector("một cái lượng")
            //          → connector("một cái lượng") | anchor("lợi ích") | sc("khổng lồ") | regular("cho sức khỏe")
            //          → 10 words = words.length ✓, Gemini semantics preserved ✓
            {
              const splitWords = s.words.slice(leadWords);
              const geminiChunks = pl.slice(anchorIdx);
  
              // ── Smart alignment: tìm vị trí ĐÚNG của từng chunk trong splitWords ──────────
              // Bug cũ: giả định orphan luôn ở ĐẦU → prepend connector("orphan words")
              // Nhưng orphan có thể ở GIỮA (vd: "sức mạnh | của | trí não" — "của" ở giữa)
              // Fix: scan foldText từ trái sang phải, tìm vị trí match của từng gemini chunk
              // Sau đó fill gap giữa các chunk bằng connector
              const _sw = splitWords;
              const _sf = _sw.map(w => foldText(w));
              let _sFrom = 0;
              const _cpos = [];
              for (const _gc of geminiChunks) {
                const _tok = _gc.text.trim().split(/\s+/).filter(Boolean);
                const _tf  = _tok.map(w => foldText(w));
                let _found = false;
                for (let _i = _sFrom; _i <= _sw.length - _tok.length; _i++) {
                  let _ok = true;
                  for (let _j = 0; _j < _tok.length; _j++) {
                    if (_sf[_i + _j] !== _tf[_j]) { _ok = false; break; }
                  }
                  if (_ok) {
                    _cpos.push({ chunk: _gc, start: _i, end: _i + _tok.length });
                    _sFrom = _i + _tok.length;
                    _found = true;
                    break;
                  }
                }
                if (!_found) {
                  // Chunk không khớp foldText (Gemini dùng từ khác) → sequential fallback
                  const _end = Math.min(_sFrom + _tok.length, _sw.length);
                  _cpos.push({ chunk: _gc, start: _sFrom, end: _end });
                  _sFrom = _end;
                }
              }
  
              // Build syntheticPeakLines: chèn connector cho mọi gap (đầu, giữa, cuối)
              const syntheticPeakLines = [];
              let _pos = 0;
              for (const { chunk: _gc, start: _cs, end: _ce } of _cpos) {
                if (_cs > _pos) {
                  syntheticPeakLines.push({ text: _sw.slice(_pos, _cs).join(' '), type: 'connector' });
                }
                syntheticPeakLines.push({ text: _sw.slice(_cs, _ce).join(' '), type: _gc.type });
                _pos = _ce;
              }
              if (_pos < _sw.length) {
                syntheticPeakLines.push({ text: _sw.slice(_pos).join(' '), type: 'connector' });
              }
  
              warn(`[split-align] s${s.index}→ ${syntheticPeakLines.map(c=>`${c.type}("${c.text}")`).join(' | ')}`);
  
              out.push(normalizeSentence({
                ...s,
                index:     s.index + 0.5,
                words:     splitWords,
                text:      splitWords.join(' '),
                startTime: splitTime,
                style:     'peak',
                peak_lines: syntheticPeakLines.map(c => ({ text: c.text, type: c.type })),
              }));
            }
            continue;
          }
        }
        out.push(s); continue;
      }
      if (s.words.length <= maxWords) { out.push(s); continue; }
      const split = findSemanticSplitPoint(s.words, maxWords);
      const dur = s.endTime - s.startTime;
      const splitTime = s.startTime + (split / s.words.length) * dur;
      out.push({ ...s, words: s.words.slice(0, split), text: s.words.slice(0, split).join(' '), endTime: splitTime });
      out.push({ ...s, index: s.index + 0.5, words: s.words.slice(split), text: s.words.slice(split).join(' '), startTime: splitTime });
    }
    return out;
  }

  function splitLongSentences(sentences, maxWords = maxWordsDefault) {
    // While loop: lặp đến khi không còn normal sentence nào > maxWords
    // Cần thiết khi câu dài > 2×maxWords — split 1 lần vẫn còn dư
    let changed = true;
    let current = sentences;
    while (changed) {
      changed = false;
      const out = _splitLongSentencesOnce(current, maxWords);
      if (out.length !== current.length ||
          out.some((s, i) => s !== current[i])) changed = true;
      current = out;
    }
    return current;
  }

  return {
    splitLongSentences
  };
}
