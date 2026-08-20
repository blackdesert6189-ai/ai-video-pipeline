/**
 * src/pipeline/normalization.js
 * Extracted normalization service for text folding, time conversion,
 * sentence normalization & peak chunk validation, and overlay normalization.
 */

export function createNormalization({
  layoutPeak = {},
  getPeakFunctionWords = () => new Set(),
  classifyOverlayType = (t) => t
} = {}) {
  function foldText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();
  }
  
  function toSeconds(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }
  
  function fromMs(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric / 1000 : fallback;
  }
  
  function normalizeWord(word) {
    if (typeof word === "string") return word;
    if (word && typeof word === "object") {
      return String(word.w ?? word.text ?? word.word ?? "");
    }
    return "";
  }
  
  function normalizeSentence(sentence, index) {
    const PEAK_FUNCTION_WORDS = typeof getPeakFunctionWords === "function" ? getPeakFunctionWords() : (getPeakFunctionWords || new Set());
    const startTime = sentence.startTime ?? fromMs(sentence.start_ms, 0);
    const endTime = sentence.endTime ?? fromMs(sentence.end_ms, startTime + 0.8);
    const text = String(sentence.text ?? "");
    // Các từ trong sentence.text (dùng làm nguồn tách Case C)
    const textWords = text ? text.split(/\s+/).filter(Boolean) : [];
  
    let words = Array.isArray(sentence.words)
      ? sentence.words.map(normalizeWord).filter(Boolean)
          // Case B: Gemini trả token có space bên trong → split thành từng từ
          .flatMap(w => w.split(/\s+/).filter(Boolean))
          // Case C: token không có space nhưng là nhiều từ ghép → đối chiếu sentence.text
          // Root-cause bug cũ: dùng toLowerCase() → sai khi NFC vs NFD khác nhau
          //   và concat.length > w.length break sớm khi combining chars khác nhau
          // Fix: dùng foldText() — strip diacritics + normalize → so sánh base Latin
          // Ví dụ: "chấtxơ" → foldText="chatxo", textWords=["chất","xơ"]
          //   foldText("chất")+foldText("xơ")="chatxo" === "chatxo" → tách đúng
          .flatMap(w => {
            if (/\s/.test(w)) return [w];  // Case B đã xử lý
            if (!textWords.length) return [w];
            const wf = foldText(w);
            for (let start = 0; start < textWords.length; start++) {
              let cf = "";  // folded concat
              for (let end = start; end < textWords.length; end++) {
                cf += foldText(textWords[end]);
                if (cf === wf) {
                  if (end > start) return textWords.slice(start, end + 1); // ≥2 từ → tách
                  break; // 1 từ khớp đúng → giữ nguyên
                }
                if (cf.length > wf.length) break; // vượt → thử start tiếp theo
              }
            }
            return [w];
          })
      : [];
  
    if (!words.length && text) {
      words = text.split(/\s+/).filter(Boolean);
    }
  
    // ── Final safety: nếu số words < số textWords nhưng content khớp → dùng textWords
    // Catch-all cho mọi trường hợp join còn sót: "chấtxơ"+"hòa"+"tan" vs "chất"+"xơ"+"hòa"+"tan"
    if (words.length < textWords.length && textWords.length > 0) {
      const wordsFolded = words.map(foldText).join("");
      const textFolded  = textWords.map(foldText).join("");
      if (wordsFolded === textFolded) {
        // Content khớp hoàn toàn — Gemini join sai, dùng text-based split cho đúng
        words = [...textWords];
      }
    }
  
    // ── Mid-sentence capitalization fix ─────────────────────────────────────────
    // SRT đôi khi viết hoa giữa câu (vd: "Ra", "Cho", "Mà") — không phải danh từ riêng
    // → lowercase tất cả từ trừ từ đầu tiên của câu
    if (words.length > 1) {
      words = words.map((w, i) => {
        if (i === 0) return w; // giữ hoa đầu câu
        // Chỉ lowercase nếu chữ cái đầu là hoa VÀ phần còn lại là thường (pattern: "Ra", "Cho")
        // Không đụng đến ALL-CAPS (viết tắt) hoặc tên riêng nhiều chữ hoa
        if (/^[A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ][a-záàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ]+$/.test(w)) {
          return w.charAt(0).toLowerCase() + w.slice(1);
        }
        return w;
      });
    }
    // ─────────────────────────────────────────────────────────────────────────────
  
    // Validate style — default "normal" if missing or unrecognised
    const VALID_STYLES = ["normal", "peak"];
    const style = VALID_STYLES.includes(sentence.style) ? sentence.style : "normal";
  
    // peak_lines: Gemini-provided [{text, type}] — semantic chunks with visual type labels
    // types: "connector" | "regular" | "anchor" | "script" | "script_climax"
    const VALID_CHUNK_TYPES = new Set(["connector","regular","anchor","script","script_climax"]);
    let peakLines = null;
    if (style === "peak" && Array.isArray(sentence.peak_lines) && sentence.peak_lines.length >= 2) {
      const parsed = sentence.peak_lines
        .filter(item => item && typeof item === "object" && item.text)
        .map(item => ({
          text: String(item.text).trim(),
          type: VALID_CHUNK_TYPES.has(item.type) ? item.type : "regular"
        }))
        .filter(item => item.text);
      if (parsed.length >= 2) peakLines = parsed;
    }
  
    // ── FALLBACK: peak_lines thiếu (Gemini bỏ qua field) → auto-chunk từ textWords ────
    // Root cause: peak_lines không nằm trong `required` của JSON schema
    //   → Gemini 3.5 Flash omit field → peakLines = null → toàn bộ post-processing bỏ qua
    //   → cascade render bằng fallback path (flat layout, không có anchor)
    // Fix: nếu style='peak' nhưng peakLines vẫn null → tự sinh chunks từ textWords
    // Algorithm (scalable, không hardcode):
    //   - 2 words: [regular, sc]
    //   - 3 words: [connector, regular, sc]
    //   - 4+ words: last 2 = sc (bảo toàn compound ở cuối câu), còn lại chia đôi = connector + regular
    // Anchor guarantee ở bên dưới sẽ tự promote regular tốt nhất → anchor
    if (style === "peak" && !peakLines && textWords.length >= 2) {
      const n = textWords.length;
      if (n === 2) {
        peakLines = [
          { text: textWords[0], type: 'regular' },
          { text: textWords[1], type: 'script_climax' }
        ];
      } else if (n === 3) {
        peakLines = [
          { text: textWords[0], type: 'connector' },
          { text: textWords[1], type: 'regular' },
          { text: textWords[2], type: 'script_climax' }
        ];
      } else {
        // n >= 4: last 2 → sc, remaining → split at midpoint
        const sc = textWords.slice(n - 2).join(' ');
        const rem = textWords.slice(0, n - 2);
        if (rem.length <= 2) {
          peakLines = [
            { text: rem.join(' '), type: 'regular' },
            { text: sc, type: 'script_climax' }
          ];
        } else {
          const mid = Math.ceil(rem.length / 2);
          peakLines = [
            { text: rem.slice(0, mid).join(' '), type: 'connector' },
            { text: rem.slice(mid).join(' '), type: 'regular' },
            { text: sc, type: 'script_climax' }
          ];
        }
      }
      console.warn(`[peak-fallback] ⚠ peak_lines missing → auto-chunked (${n} words): [${peakLines.map(c => `"${c.text}"(${c.type})`).join(' | ')}]`);
    }
    // ─────────────────────────────────────────────────────────────────────────────
  
    // Fix Case C trong chunk text của peakLines — cùng logic foldText như sentence.words
    // "chấtxơ" trong chunk.text → "chất xơ" qua đối chiếu textWords
    // Đảm bảo: sum(chunk word count) === sentence.words.length → HTML spans = GSAP loop count
    if (peakLines && textWords.length > 0) {
      peakLines = peakLines.map(chunk => ({
        ...chunk,
        text: chunk.text.split(/\s+/).filter(Boolean)
          .flatMap(token => {
            const tf = foldText(token);
            for (let s = 0; s < textWords.length; s++) {
              let cf = "";
              for (let e = s; e < textWords.length; e++) {
                cf += foldText(textWords[e]);
                if (cf === tf) {
                  if (e > s) return textWords.slice(s, e + 1); // joined → split
                  break;
                }
                if (cf.length > tf.length) break;
              }
            }
            return [token]; // không khớp → giữ nguyên
          })
          .join(" ")
      }));
  
      // Merge chunks bị ngắt giữa chừng: regular/script chunk chỉ có 1 từ → merge vào chunk kế
      // VD: "thụ" (regular,1 word) + "thể vận" (regular) → "thụ thể vận" (regular)
      // Giữ nguyên: anchor (1 từ keyword OK), connector (1 từ glue word OK)
      const ALLOW_SINGLE = new Set(["anchor", "connector"]);
      const merged = [];
      for (let i = 0; i < peakLines.length; i++) {
        const chunk = peakLines[i];
        const wordCount = chunk.text.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount < 2 && !ALLOW_SINGLE.has(chunk.type) && merged.length > 0) {
          // Merge vào chunk trước
          const prev = merged[merged.length - 1];
          prev.text = (prev.text + " " + chunk.text).trim();
          // Giữ type của chunk có priority cao hơn (script_climax > script > anchor > regular > connector)
          const priority = { script_climax: 5, script: 4, anchor: 3, regular: 2, connector: 1 };
          if ((priority[chunk.type] || 0) > (priority[prev.type] || 0)) prev.type = chunk.type;
        } else {
          merged.push({ ...chunk });
        }
      }
      if (merged.length >= 2) peakLines = merged;
    }
  
    // ── POST-PROCESS: script_climax validator — reads rules from layoutPeak ────
    // Gemini là LLM, không đảm bảo tuân rules 100%.
    // Logic validator ở đây; rules cụ thể nằm trong layoutPeak (configurable, không hardcode).
    if (peakLines) {
      // ── Step 0: Cross-chunk compound noun repair ─────────────────────────────
      // Phát hiện từ ghép bị cắt ngang ranh giới chunk (vd: "hiệu" | "ứng giả dược")
      // Pattern: nếu từ CUỐI chunk[i] là nửa đầu từ ghép → merge từ ĐẦU chunk[i+1] vào chunk[i]
      const { compoundPrefixPattern } = layoutPeak;
      if (compoundPrefixPattern) {
        let i = 0;
        while (i < peakLines.length - 1) {
          const curr = peakLines[i];
          const next = peakLines[i + 1];
          const currWords = curr.text.trim().split(/\s+/).filter(Boolean);
          const nextWords = next.text.trim().split(/\s+/).filter(Boolean);
          const lastWord = currWords[currWords.length - 1];
          const firstWord = nextWords[0];
          // Guard: chỉ fix single-word chunk (=== 1) hoặc chunk 2-từ có lastWord là compound prefix (<= 2)
          // KHÔNG bỏ guard → cascade vô tận: "và mang" → merge "lại" → merge "hiệu" → merge "quả" → ...
          // foldText(lastWord): bắt buộc để tránh Unicode NFC/NFD mismatch — Gemini API có thể trả NFD
          // nhưng regex pattern trong source code là NFC → test raw sẽ không match!
          // Thêm guard: chỉ merge nếu next chunk còn >1 từ SAU khi bị lấy mất 1 từ,
          // OR nếu next chunk không phải script_climax — tránh làm trống script_climax
          const nextHasSurplus = nextWords.length > 1 || next.type !== 'script_climax';
          if (lastWord && firstWord && currWords.length <= 2 && nextHasSurplus && compoundPrefixPattern.test(foldText(lastWord))) {
            console.warn(`[peak-compound] ⚠ compound split: "${lastWord}|${firstWord}" → merging`);
            // Absorb firstWord of next into curr
            peakLines[i] = { ...curr, text: [...currWords, firstWord].join(' ') };
            if (nextWords.length > 1) {
              peakLines[i + 1] = { ...next, text: nextWords.slice(1).join(' ') };
            } else {
              // next chunk becomes empty → remove
              peakLines.splice(i + 1, 1);
            }
            // Don't advance i — re-check this chunk (cascading fix)
          } else {
            i++;
          }
        }
        // Remove any chunks that ended up empty
        peakLines = peakLines.filter(c => c.text.trim().length > 0);
      }
      // ─────────────────────────────────────────────────────────────────────────
  
      const { climaxBlockRules, maxClimaxPerSentence } = layoutPeak;
  
      // ── Anchor word-count guard ───────────────────────────────────────────────
      // anchor = key concept word(s) — 1-3 từ. Nếu Gemini assign anchor cho phrase dài
      // → 116px × nhiều từ tràn màn hình. Demote về regular.
      peakLines = peakLines.map(chunk => {
        if (chunk.type !== 'anchor') return chunk;
        const wc = chunk.text.trim().split(/\s+/).filter(Boolean).length;
        if (wc > layoutPeak.anchorMaxWords) {
          console.warn(`[peak-sanitize] ⚠ anchor → regular (${wc} words > anchorMaxWords=${layoutPeak.anchorMaxWords}): "${chunk.text}"`);
          return { ...chunk, type: 'regular' };
        }
        // Anchor kết thúc bằng giới từ → không phải semantic unit độc lập
        if (layoutPeak.anchorEndBlockPattern && layoutPeak.anchorEndBlockPattern.test(chunk.text)) {
          console.warn(`[peak-sanitize] ⚠ anchor → regular (trailing preposition): "${chunk.text}"`);
          return { ...chunk, type: 'regular' };
        }
        // Anchor kết thúc bằng classifier/article ("các", "cái", "những"...) → demote về regular
        if (layoutPeak.anchorTrailingClassifierPattern && layoutPeak.anchorTrailingClassifierPattern.test(chunk.text)) {
          console.warn(`[peak-sanitize] ⚠ anchor → regular (trailing classifier): "${chunk.text}"`);
          return { ...chunk, type: 'regular' };
        }
        return chunk;
      });
  
      // ── Anchor verb-head split ────────────────────────────────────────────────
      // "giảm các triệu chứng" → anchor/regular sai vì bắt đầu bằng động từ
      // → split: verb đầu → connector mới, phần còn lại → regular (anchor guarantee quyết định sau)
      // Chạy trên CẢ anchor VÀ regular để bắt case demoted từ trailing-classifier
      if (layoutPeak.anchorVerbHeadPattern) {
        const newLines = [];
        for (const chunk of peakLines) {
          if (chunk.type === 'anchor' || chunk.type === 'regular') {
            const words = chunk.text.trim().split(/\s+/).filter(Boolean);
            const match = chunk.text.match(layoutPeak.anchorVerbHeadPattern);
            if (match && words.length >= 2) {
              const verbWord = match[0].trim();
              const rest = chunk.text.slice(match[0].length).trim();
              if (rest.length > 0) {
                console.warn(`[peak-sanitize] ⚡ verb-head split (${chunk.type}): "${verbWord}" → connector + "${rest}" → regular`);
                newLines.push({ text: verbWord, type: 'connector' });
                newLines.push({ text: rest, type: 'regular' }); // regular → anchor guarantee quyết định
                continue;
              }
            }
          }
          newLines.push(chunk);
        }
        peakLines = newLines;
      }
      // ─────────────────────────────────────────────────────────────────────────
  
      // ── Max chunks cap (TYB = 3-4 dòng) ─────────────────────────────────────
      // Nếu Gemini trả quá nhiều chunk → merge các connector/regular liền kề nhỏ nhất
      const maxChunks = layoutPeak.maxChunks || 4;
      if (peakLines.length > maxChunks) {
        // Merge strategy: tìm cặp adjacent chunk cùng type (regular/connector) và merge
        while (peakLines.length > maxChunks) {
          let mergeIdx = -1;
          // Ưu tiên merge 2 connector hoặc 2 regular liền nhau
          for (let i = 0; i < peakLines.length - 1; i++) {
            const a = peakLines[i].type, b = peakLines[i + 1].type;
            if ((a === 'connector' && b === 'connector') ||
                (a === 'regular'   && b === 'regular')   ||
                (a === 'connector' && b === 'regular')    ||
                (a === 'regular'   && b === 'connector')) {
              mergeIdx = i; break;
            }
          }
          if (mergeIdx === -1) mergeIdx = 0; // fallback: merge first 2
          const merged = {
            text: peakLines[mergeIdx].text + ' ' + peakLines[mergeIdx + 1].text,
            type: peakLines[mergeIdx].type === 'regular' ? 'regular' : peakLines[mergeIdx + 1].type,
          };
          console.warn(`[peak-sanitize] ⚠ merge chunks (maxChunks): "${peakLines[mergeIdx].text}" + "${peakLines[mergeIdx+1].text}"`);
          peakLines = [...peakLines.slice(0, mergeIdx), merged, ...peakLines.slice(mergeIdx + 2)];
        }
      }
      // ─────────────────────────────────────────────────────────────────────────
  
      let climaxCount = 0;
      peakLines = peakLines.map(chunk => {
        if (chunk.type !== 'script_climax') return chunk;
  
        const lower = chunk.text.trim().toLowerCase();
  
        // Kiểm tra từng rule từ layoutPeak.climaxBlockRules
        if (climaxBlockRules.some(rx => rx.test(lower))) {
          console.warn(`[peak-sanitize] ⚠ script_climax → regular: "${chunk.text}"`);
          return { ...chunk, type: 'regular' };
        }
  
        // Enforce max climax per sentence (từ layoutPeak.maxClimaxPerSentence)
        climaxCount++;
        if (climaxCount > maxClimaxPerSentence) {
          console.warn(`[peak-sanitize] ⚠ script_climax → script (max exceeded): "${chunk.text}"`);
          return { ...chunk, type: 'script' };
        }
  
        return chunk;
      });
  
      // Nếu không còn script_climax → promote chunk "script" đầu tiên
      if (!peakLines.some(c => c.type === 'script_climax')) {
        const idx = peakLines.findIndex(c => c.type === 'script');
        if (idx !== -1) {
          console.warn(`[peak-sanitize] ↑ promote script → script_climax: "${peakLines[idx].text}"`);
          peakLines = peakLines.map((c, i) => i === idx ? { ...c, type: 'script_climax' } : c);
        }
      }
  
      // ── POST-OPT: Anchor guarantee ─────────────────────────────────────────────
      // TYB rule: mỗi cascade PHẢI có anchor (focal white bold). Nếu Gemini ko assign
      // → tự promote regular candidate tốt nhất → anchor.
      if (layoutPeak.anchorPromoteEnabled && !peakLines.some(c => c.type === 'anchor')) {
        // Tập candidates: regular chunks, ≤ anchorMaxWords, có ít nhất 1 content word
        const candidates = peakLines
          .map((chunk, idx) => ({ chunk, idx }))
          .filter(({ chunk }) => chunk.type === 'regular')
          .filter(({ chunk }) => {
            const words = chunk.text.trim().split(/\s+/).filter(Boolean);
            if (words.length > layoutPeak.anchorMaxWords) return false;
            // Phải có ít nhất 1 content word (không phải function word toàn bộ)
            return words.some(w => !PEAK_FUNCTION_WORDS.has(foldText(w)));
          })
          .sort((a, b) => {
            // Ưu tiên 1: từ ĐẦU chunk là content word (không phải function word)
            // "sức mạnh" (sức=content) > "của cơ bắp" (của=function) → anchor đúng nghĩa hơn
            const aFirstFold = foldText(a.chunk.text.trim().split(/\s+/).filter(Boolean)[0] || '');
            const bFirstFold = foldText(b.chunk.text.trim().split(/\s+/).filter(Boolean)[0] || '');
            const aFirstContent = !PEAK_FUNCTION_WORDS.has(aFirstFold);
            const bFirstContent = !PEAK_FUNCTION_WORDS.has(bFirstFold);
            if (aFirstContent !== bFirstContent) return aFirstContent ? -1 : 1;
            // Ưu tiên 2: chunk ở giữa (không phải đầu/cuối) → visual anchor at center
            const aMiddle = a.idx > 0 && a.idx < peakLines.length - 1;
            const bMiddle = b.idx > 0 && b.idx < peakLines.length - 1;
            if (aMiddle !== bMiddle) return aMiddle ? -1 : 1;
            // Ưu tiên 3: ít từ hơn → impact mạnh hơn ở kích thước 124px
            const aWc = a.chunk.text.trim().split(/\s+/).filter(Boolean).length;
            const bWc = b.chunk.text.trim().split(/\s+/).filter(Boolean).length;
            return aWc - bWc;
          });
        if (candidates.length > 0) {
          const { idx: bestIdx, chunk: bestChunk } = candidates[0];
          console.warn(`[peak-sanitize] ↑ promote regular → anchor (TYB guarantee): "${bestChunk.text}"`);
          peakLines = peakLines.map((c, i) => i === bestIdx ? { ...c, type: 'anchor' } : c);
        } else {
          // Không có regular candidate phù hợp (quá dài hoặc toàn function word)
          // → dùng script → anchor nếu có (TYB dứt khoát phải có anchor)
          const scriptIdx = peakLines.findIndex(c => c.type === 'script');
          if (scriptIdx !== -1) {
            const wc = peakLines[scriptIdx].text.trim().split(/\s+/).filter(Boolean).length;
            if (wc <= layoutPeak.anchorMaxWords) {
              console.warn(`[peak-sanitize] ↑ promote script → anchor (TYB fallback): "${peakLines[scriptIdx].text}"`);
              peakLines = peakLines.map((c, i) => i === scriptIdx ? { ...c, type: 'anchor' } : c);
            }
          } else {
            // Last resort: split đầu script_climax → tách 1-2 từ đầu thành anchor
            // Case: cascade chỉ có connector + script_climax (không có regular/script)
            // Ví dụ: "và" + "mang lại hiệu quả cao nhất" → anchor="hiệu quả", sc="cao nhất"
            const scIdx = peakLines.findIndex(c => c.type === 'script_climax');
            if (scIdx !== -1) {
              const scWords = peakLines[scIdx].text.trim().split(/\s+/).filter(Boolean);
              // Tìm anchor words từ đầu script_climax (bỏ qua function words đầu)
              let anchorEnd = 0;
              for (let wi = 0; wi < Math.min(3, scWords.length - 1); wi++) {
                if (!PEAK_FUNCTION_WORDS.has(foldText(scWords[wi]))) {
                  anchorEnd = wi + 1;
                  // Lấy tối đa 2 từ content (đủ anchor, không overflow)
                  if (anchorEnd >= 2) break;
                }
              }
              if (anchorEnd >= 1 && anchorEnd < scWords.length) {
                const anchorText = scWords.slice(0, anchorEnd).join(' ');
                const remainText = scWords.slice(anchorEnd).join(' ');
                const hasContent = anchorText.split(/\s+/).some(w => !PEAK_FUNCTION_WORDS.has(foldText(w)));
                if (hasContent && remainText.length > 0) {
                  console.warn(`[peak-sanitize] ⚡ split script_climax head → anchor: "${anchorText}" | sc: "${remainText}"`);
                  const anchorChunk = { text: anchorText, type: 'anchor' };
                  const newSc = { ...peakLines[scIdx], text: remainText };
                  peakLines = [
                    ...peakLines.slice(0, scIdx),
                    anchorChunk,
                    newSc,
                    ...peakLines.slice(scIdx + 1),
                  ];
                }
              }
            }
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────────
  
      // ── Demote over-long regular chunks starting with function word → connector ──
      // Pattern: regular("của bạn mà nó còn dành cho") = 7 từ bắt đầu FW → cạnh tranh visual với anchor
      // FIX: đổi thành connector (28px dim) — không cạnh tranh, words vẫn covered (tránh safety-fallback)
      {
        peakLines = peakLines.map(chunk => {
          if (chunk.type !== 'regular') return chunk;
          const _rw = chunk.text.trim().split(/\s+/).filter(Boolean);
          if (_rw.length > 4 && PEAK_FUNCTION_WORDS.has(foldText(_rw[0]))) {
            console.warn(`[peak-sanitize] ↓ long FW-regular → connector: "${chunk.text}"`);
            return { ...chunk, type: 'connector' };
          }
          return chunk;
        });
      }
      // ─────────────────────────────────────────────────────────────────────────
  
      // ── Demote trailing possessive chunk → connector ───────────────────────────
      // Pattern: chunk CUỐI là regular chỉ gồm "của/cho + đại từ" → line thừa lơ lửng
      // FIX: đổi type thành connector (28px dim) thay vì DROP — giữ words trong peakLines
      //      để tránh HTML safety-fallback tạo ra orphan script-climax("của bạn").
      // Root cause of bug: nếu DROP → sentence.words vẫn có đủ từ → wPtr < canonWords.length
      //   → HTML gen tạo extra div với type = lastChunk.type = "script_climax" → bug!
      // Vd: anchor("cơ bắp") | connector("...") | sc("trí não") | regular("của bạn") → connector
      {
        const _tp = peakLines[peakLines.length - 1];
        if (_tp && _tp.type === 'regular') {
          const _tpw = _tp.text.trim();
          if (/^(của|cho)\s+(bạn|mình|tôi|tớ|họ|nó|ta|chúng\s+ta|mọi\s+người)\s*$/i.test(_tpw)
              && peakLines.length > 2) {
            console.warn(`[peak-sanitize] ↓ trailing possessive → connector (prevent orphan sc): "${_tpw}"`);
            peakLines = peakLines.map((c, i) => i === peakLines.length - 1 ? { ...c, type: 'connector' } : c);
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────────
  
      // ── Paranoid cap sau tất cả transforms — đảm bảo không bao giờ > maxChunks ─
      // climaxBlockRules có thể thay đổi type nhưng không tăng count
      // Cap chạy lại ở đây để chắc chắn (render-time cũng có cap riêng)
      while (peakLines.length > maxChunks) {
        let _pmi = peakLines.findIndex((_, i) =>
          i < peakLines.length - 1 &&
          ['connector','regular'].includes(peakLines[i].type) &&
          ['connector','regular'].includes(peakLines[i + 1].type)
        );
        if (_pmi === -1) _pmi = peakLines.findIndex((_, i) =>
          i < peakLines.length - 1 &&
          (peakLines[i].type === 'connector' || peakLines[i + 1].type === 'connector')
        );
        if (_pmi === -1) _pmi = 0;
        const _pm = { text: peakLines[_pmi].text + ' ' + peakLines[_pmi + 1].text,
                      type: peakLines[_pmi].type === 'regular' ? 'regular' : peakLines[_pmi + 1].type };
        peakLines = [...peakLines.slice(0, _pmi), _pm, ...peakLines.slice(_pmi + 2)];
      }
    }
    // ─────────────────────────────────────────────────────────────────────────────
  
    return {
      index: sentence.index ?? index,
      text,
      startTime: toSeconds(startTime, 0),
      endTime: Math.max(toSeconds(endTime, startTime + 0.8), toSeconds(startTime, 0) + 0.1),
      words,
      style,
      peakLines  // null for normal; [line1, line2, punchline] for peak
    };
  }
  
  function normalizeOverlayType(type, title, detail = "") {
    return classifyOverlayType(type, title, detail);
  }
  
  function normalizeOverlay(overlay, index) {
    const title = String(overlay.title ?? overlay.metric ?? "");
    const detail = String(overlay.detail ?? overlay.desc ?? overlay.description ?? "");
    const startTime = overlay.startTime ?? fromMs(overlay.start_ms, 0);
    const endTime = overlay.endTime ?? (
      overlay.duration_ms != null
        ? toSeconds(startTime, 0) + fromMs(overlay.duration_ms, 3.5)
        : toSeconds(startTime, 0) + 3.8
    );
  
    return {
      index,
      type: normalizeOverlayType(overlay.type ?? overlay.visual_type, title, detail),
      title,
      detail,
      startTime: toSeconds(startTime, 0),
      endTime: Math.max(toSeconds(endTime, 0), toSeconds(startTime, 0) + 0.8),
      visual_value:        Number(overlay.visual_value ?? 0),
      archetype:           overlay.archetype           || null,
      badgeLabel:          overlay.badgeLabel          || overlay.badge_label || null,
      semantic_intent:     overlay.semantic_intent     || null,
      semantic_visual_type:overlay.semantic_visual_type|| null,
      semantic_variant:    overlay.semantic_variant    || overlay.semanticVariant || null,
      metric_kind:         overlay.metric_kind         || null,
      metric_direction:    overlay.metric_direction    || null,
      lottie_query_en:     overlay.lottie_query_en     || null,
      lottie_path:         overlay.lottie_path         || null,
      list_group:          overlay.list_group           || null,
      list_index:          overlay.list_index           || null,
      list_total:          overlay.list_total           || null,
      list_style:          overlay.list_style           || null
    };
  }

  return {
    foldText,
    toSeconds,
    normalizeSentence,
    normalizeOverlay
  };
}
