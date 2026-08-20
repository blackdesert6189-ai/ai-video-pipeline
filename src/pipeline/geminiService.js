/**
 * src/pipeline/geminiService.js
 * Extracted Gemini API service for transcript analysis, structured JSON generation,
 * model fallback, retry handling, and card text rewriting.
 */

import fs from 'fs';
import path from 'path';

export function createGeminiService({
  lottieDir = path.resolve('assets/lottie'),
  getBrollIndex = () => [],
  brollIndex = null
} = {}) {
  // Lấy danh sách key từ cache Lottie (dùng để inject vào prompt)
function getLottieCacheKeys() {
  if (!fs.existsSync(lottieDir)) return [];
  return fs.readdirSync(lottieDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, '').replace(/_/g, ' '));
}

async function callGemini(cues, apiKey) {
  const lottieKeys = getLottieCacheKeys();
  const promptText = `
You are a subtitle editor and motion designer for CNFI, a Vietnamese health/fitness channel.
Analyze the transcript cues below and return structured data.

═══════════════════════════════════════════
STEP 0 — READ THE FULL TRANSCRIPT FIRST (mandatory)
═══════════════════════════════════════════
Before doing anything else, read ALL cues from start to finish as a complete piece of content.
Identify:
  (a) The video's single core topic (e.g. "walking after eating burns fat")
  (b) The 3-5 most surprising or counterintuitive claims made
  (c) The narrative arc: what problem is raised → what mechanism explains it → what action should viewer take

Only after understanding the FULL context, proceed to subtitle cleanup, sentence grouping, and overlay creation.
Every decision you make must be grounded in the complete video meaning — not isolated word matching.

═══════════════════════════════════════════
SEMANTIC ACCURACY RULES (apply to all outputs)
═══════════════════════════════════════════
- A sentence or overlay must reflect what the SPEAKER is actually saying in that moment — including the surrounding context.
- Never create an overlay from a sentence fragment. The overlay title + detail must be a complete communicable idea.
- If a cue says "tốc độ chậm" (slow speed), that alone is not an overlay. But if surrounding cues say "đi bộ sau ăn với tốc độ chậm kích hoạt đốt mỡ" → the complete concept is "đi bộ chậm sau ăn → kích hoạt đốt mỡ" → that is an ACTION overlay with a FLOW pattern.
- The pattern must represent WHAT IS PHYSICALLY OR CONCEPTUALLY HAPPENING, derived from reading title + detail together as one sentence, not from individual words.

SUBTITLE STYLE RULES:
Assign a "style" field to each sentence. This controls the visual display mode.

style "normal" (default — all sentences that are not peak):
  → Standard pill background, karaoke word highlight.
  Use for: regular narration, transitions, context setup, background info, filler.

style "peak" (use at EVERY high-impact moment — typically 4–8 times per video):
  → Cinematic multi-line display. Each line = 1 SEMANTIC CHUNK with its own visual style.
  → Split by MEANING — never by word count.

  ⚠️ MANDATORY: fill "peak_lines" as array of {text, type} objects. Each object = 1 displayed line.
  CHUNK TYPES (5 types):
    "connector"     — tiny glue word (36px, dim white): "về", "của", "như", "để", "mà" — use sparingly
    "regular"       — context phrase (44px, white): sets up who/what/when/why — reads first
    "anchor"        — key concept (90px, bold white): THE BIGGEST LINE — core subject, shocking verb, named term
    "script"        — emotional support (72px, white ExtraBold): strong supporting phrase, not the climax
    "script_climax" — THE HERO (72px, premium cursive + CNFI lime): stands out through FONT+COLOR not size.
                      This is the emotional apex — the line that makes them stop scrolling.
                      RULE: max 1 script_climax per peak sentence. Choose the most powerful phrase only.

  DESIGN RULES:
  1. Every peak sentence MUST have BOTH 1 "anchor" AND 1 "script_climax" — both are MANDATORY, never omit either.
     "anchor" = focal concept (white bold, impact by SIZE — the "what" that hits hardest visually).
     "script_climax" = emotional punchline (gold cursive, style impact — the "feel" that resonates).
     Together they create the TYB dual-focal visual hierarchy. A cascade with only one is incomplete.
  2. Script types ("script" / "script_climax") = the most emotionally charged chunk(s).
  3. "anchor" = the most conceptually impactful word/phrase (bold white, stands out by SIZE).
  4. "connector" used only for functional glue words — max 1–2 connectors per sentence.
  5. All texts concatenated = sentence "text" field. No words may be omitted or added.
  6. Minimum 3 chunks, maximum 6 chunks.
  ⛔ script_climax MUST be the MOST POWERFUL phrase — the one that stops scrolling. NEVER assign script_climax to:
     - generic filler: "cho sức khỏe", "của bạn", "rất tốt", "như vậy" — always "regular" or "connector"
     - location/scope modifiers: "hành tinh", "trên đời", "thế giới", "trong cơ thể" — these are just modifiers, NEVER script_climax
     - trailing 1-2 word tags that only describe WHERE/WHO/HOW: "của mình", "với bạn", "mỗi ngày"
     - the LAST phrase just because it's last — assign by MEANING, not position

  CORRECT EXAMPLES of script_climax assignment:
     ✅ "mà nó còn dành cho trí não của bạn"
        → [{text:"mà nó còn", type:"connector"}, {text:"dành cho", type:"connector"}, {text:"trí não", type:"script_climax"}, {text:"của bạn", type:"regular"}]
        ⛔ SAI: "dành cho trí" / "não của bạn" — cắt giữa từ ghép "trí não"
        ⛔ SAI: "não của bạn" là script_climax — đây là possessive modifier
     ✅ "mang lại hiệu quả cao nhất hành tinh"
        → [{text:"mang lại", type:"connector"}, {text:"hiệu quả", type:"anchor"}, {text:"cao nhất", type:"script_climax"}, {text:"hành tinh", type:"regular"}]
        ⛔ NEVER: [{text:"mang lại hiệu quả cao", type:"regular"}, {text:"nhất hành tinh", type:"script_climax"}] ← SAI
        ⛔ NEVER: [{text:"mang lại hiệu quả cao nhất", type:"anchor"}, {text:"hành tinh", type:"script_climax"}] ← SAI
        "nhất hành tinh" và "hành tinh" LUÔN LUÔN là regular — không có ngoại lệ.
        anchor = "hiệu quả" (focal concept), script_climax = "cao nhất" (superlative punch) — cả hai PHẢI có mặt.
     ✅ "mang lại lợi ích khổng lồ cho sức khỏe"
        → [{text:"mang lại", type:"connector"}, {text:"lợi ích", type:"anchor"}, {text:"khổng lồ", type:"script_climax"}, {text:"cho sức khỏe", type:"regular"}]
        anchor = "lợi ích" (focal noun), script_climax = "khổng lồ" (superlative modifier) — cả hai PHẢI có mặt.
     ✅ "insulin giúp glucose vào thẳng tế bào cơ"
        → [{text:"insulin", type:"script_climax"}, {text:"giúp", type:"connector"}, {text:"glucose", type:"anchor"}, {text:"vào thẳng tế bào cơ", type:"regular"}]

  ⛔ LINE BREAK RULE — MOST IMPORTANT: Each chunk = 1 COMPLETE SEMANTIC PHRASE. NEVER split mid-phrase.

  COMPOUND NOUN RULE (từ ghép) — STRUCTURAL, apply to ANY word, not just the list below:
  A compound is 2+ syllables that together form ONE inseparable concept.

  SELF-TEST at every chunk boundary (last word of chunk A, first word of chunk B):
    → Can [last word of chunk A] stand alone with the SAME meaning in this context?
      YES (has standalone meaning) = boundary is OK.
      NO  (needs next word to complete its meaning) = COMPOUND — keep both words in chunk A.

  Self-test examples:
    "trí não"   → "trí" alone ≠ brain             → compound → never split
    "thụ thể"   → "thụ" alone ≠ receptor          → compound → never split
    "giả dược"  → "giả" alone ≠ placebo            → compound → never split
    "bí kíp"    → "bí" alone ≠ secret technique    → compound → never split
    "tế bào"    → "tế" alone ≠ cell                → compound → never split
    "hiệu ứng"  → "hiệu" alone ≠ effect/phenomenon → compound → never split
    "tiểu đường"→ "tiểu" alone ≠ diabetes          → compound → never split
    "cơ chế"    → "cơ" alone ≠ mechanism           → compound → never split
    "tác dụng"  → "tác" alone ≠ effect/action      → compound → never split
    "mấu chốt"  → "mấu" alone ≠ key point          → compound → never split

  RULE: This test applies to EVERY word pair at every chunk boundary, not just known words.
  When in doubt → keep in same chunk.

  BAD: "dành cho trí" | "não của bạn"    ← "trí não" split → SAI
  GOOD: "dành cho" | "trí não" | "của bạn"  ← ĐÚNG
  BAD: "gọi là hiệu" | "ứng giả dược"   ← "hiệu ứng" split → SAI
  GOOD: "gọi là" | "hiệu ứng giả dược"  ← ĐÚNG
  BAD: "giả" | "dược"                    ← compound split + 1-word chunks → SAI
  GOOD: "giả dược"                       ← ĐÚNG
  BAD: "bí" | "kíp hack"                 ← "bí kíp" split → SAI
  GOOD: "bí kíp hack"                    ← ĐÚNG
  BAD: "giúp bạn tăng" | "cường sức mạnh" ← "tăng cường" split → SAI
  GOOD: "giúp bạn" | "tăng cường" | "sức mạnh" | "cơ bắp"  ← ĐÚNG
  BAD: "mang lại" | "kết quả"           ← "kết quả" split → SAI (kết = first syllable)
  GOOD: "mang lại" | "kết quả cao nhất"  ← ĐÚNG
  BAD: "lợi ích" | "khổng lồ"           ← "khổng lồ" split → SAI (khổng ≠ không)
  GOOD: "lợi ích" | "khổng lồ"          ← ĐÚNG (khổng lồ = enormous, KHÔNG PHẢI "không + lồ")

  ⛔ script_climax BLACKLIST — những phrase sau KHÔNG BAO GIỜ là script_climax dù ở vị trí nào:
  - Possessive endings: "của bạn", "của mình", "của t", "của họ", "của cơ thể"
  - Location/scope: "hành tinh", "thế giới", "trong cơ thể", "trên đời"
  - Beneficiary: "cho sức khỏe", "cho não", "cho bạn", "cho cơ thể"
  - Generic modifiers: "rất tốt", "như vậy", "như thế", "mà thôi"
  Test trước khi assign script_climax: phrase này có ý nghĩa độc lập không? "não của bạn" → không (cần biết "não của bạn" để làm gì). "trí não" → có (từ ghép mang nghĩa). → "trí não" = script_climax, "của bạn" = regular.

  WORD COUNT: Every chunk must have ≥ 2 words, EXCEPT "anchor" (can be 1 keyword: "GLUT4", "insulin") and "connector" (glue words: "về", "của").

  CHUNK COUNT: Tổng số chunks = 3 hoặc 4. KHÔNG BAO GIỜ 5+.
  - 3 chunks (lý tưởng): [connector/regular] + [anchor] + [script_climax]
  - 4 chunks (mạnh nhất): [connector] + [regular] + [anchor] + [script_climax]
  ⚠ anchor VÀ script_climax phải CÙNG CÓ MẶT trong mỗi cascade — không thể thiếu một trong hai.
  - 5+ chunks: SAI — phải merge các chunk nhỏ liền nhau

  ANCHOR SEMANTIC RULE: anchor = 1-3 từ CORE — phải là DANH TỪ hoặc CỤM DANH TỪ (noun/noun phrase).
  anchor là CONCEPT (khái niệm), không phải ACTION (hành động).

  ⛔ KHÔNG BAO GIỜ dùng động từ hành động làm anchor:
  BAD: anchor = "giảm các"       ← "giảm" là động từ, "các" là classifier → SAI
  BAD: anchor = "cải thiện cái"  ← "cải thiện" là động từ, "cái" là classifier → SAI
  BAD: anchor = "tăng cường"     ← động từ thuần túy → SAI
  BAD: anchor = "hỗ trợ"        ← động từ → SAI
  GOOD: connector = "giảm", anchor = "triệu chứng", script_climax = "bệnh trầm cảm"
  GOOD: connector = "cải thiện", anchor = "chức năng nhận thức"
  GOOD: connector = "tăng cường", anchor = "sức mạnh", script_climax = "cơ bắp"

  ⛔ Classifier/article KHÔNG BAO GIỜ đứng cuối anchor:
  BAD: "giảm các"       ← "các" là classifier → đừng đặt vào anchor
  BAD: "cải thiện cái"  ← "cái" là classifier/article → đừng đặt vào anchor
  BAD: "những lợi"      ← "những" là classifier → đừng đặt vào anchor
  RULE: "các", "cái", "những", "một", "mỗi" → LUÔN là connector hoặc regular, KHÔNG bao giờ cuối anchor.

  ⛔ anchor KHÔNG bao giờ kết thúc bằng giới từ:
  BAD: "lập trình cho"  ← kết thúc bằng giới từ "cho" → SAI
  BAD: "vận hành dựa"  ← kết thúc bằng "dựa" (cần "trên" → incomplete)
  GOOD: anchor = danh từ/cụm danh từ độc lập có nghĩa đầy đủ không cần từ tiếp theo

  REAL TYB EXAMPLES (copy this pattern):
  Sentence: "dễ chon những cách quen thuộc nhất"
  → [{text:"dễ chon", type:"regular"}, {text:"những cách", type:"anchor"}, {text:"quen thuộc nhất", type:"script_climax"}]

  Sentence: "cho những ai đang gặp vấn đề về mỡ"
  → [{text:"cho những ai", type:"regular"}, {text:"đang gặp", type:"regular"}, {text:"vấn đề", type:"anchor"}, {text:"về", type:"connector"}, {text:"mỡ", type:"script_climax"}]

  Sentence: "1 góc nhìn về cách cơ thể bạn phản ứng"
  → [{text:"1 góc nhìn", type:"regular"}, {text:"về cách", type:"connector"}, {text:"cơ thể", type:"anchor"}, {text:"phản ứng", type:"script_climax"}]
  ⚡ anchor = "cơ thể" (focal concept — what the sentence is ABOUT), script_climax = "phản ứng" (punchline — the REACTION). Cả hai PHẢI có mặt.

  Sentence: "họ rất dễ bị cơ thể của mình đánh bại"
  → [{text:"họ rất dễ bị", type:"regular"}, {text:"cơ thể", type:"anchor"}, {text:"của mình", type:"connector"}, {text:"đánh bại", type:"script_climax"}]
  ⚡ anchor = "cơ thể" (focal noun — the agent that defeats them), script_climax = "đánh bại" (emotional punchline — defeated by own body). Cả hai PHẢI có mặt.

  Sentence: "cảm thấy hành trình của họ nhẹ hơn rồi"
  → [{text:"cảm thấy", type:"regular"}, {text:"hành trình", type:"anchor"}, {text:"của họ", type:"script"}, {text:"nhẹ hơn rồi", type:"script_climax"}]

  Sentence: "những tín hiệu đang bị nhiễu hết cả lên rồi"
  → [{text:"những tín hiệu", type:"script_climax"}, {text:"đang bị", type:"connector"}, {text:"nhiễu", type:"anchor"}, {text:"hết cả lên rồi", type:"regular"}]

  Sentence: "insulin giúp glucose vào thẳng tế bào cơ"
  → [{text:"insulin", type:"script_climax"}, {text:"giúp", type:"connector"}, {text:"glucose", type:"anchor"}, {text:"vào thẳng tế bào cơ", type:"regular"}]

  Sentence: "người được thông báo ngủ sâu đạt điểm cao hơn đáng kể"
  → [{text:"người được thông báo", type:"regular"}, {text:"ngủ sâu", type:"anchor"}, {text:"đạt điểm cao hơn đáng kể", type:"script_climax"}]
  ⚡ Lead-in "người được thông báo" = 3 từ → CHẤP NHẬN (pipeline sẽ tự split thành normal+peak nếu cần)

  ⛔ SENTENCE-LEVEL PEAK RULES — QUAN TRỌNG:

  RULE A — Câu hỏi KHÔNG BAO GIỜ là peak:
  Bất kỳ câu nào có dấu "?" hoặc mang cấu trúc hỏi → style = "normal", không bao giờ "peak".
  BAD: "bạn có biết bí kíp hack đỉnh nhất hành tinh là gì không?" → style: "peak"  ← SAI
  GOOD: "bạn có biết bí kíp hack đỉnh nhất hành tinh là gì không?" → style: "normal"  ← ĐÚNG
  Detect: câu kết thúc "?", "không?", "chứ?", "nhỉ?", "hả?", hoặc có cấu trúc "có ... không/chưa".
  Reason: questions build suspense — assigning peak kills the hook tension by prematurely resolving it.

  RULE B — Lead-in dài trước anchor → KHÔNG dùng peak:
  Nếu phần regular/connector nằm TRƯỚC anchor đầu tiên trong peak_lines chiếm > 3 từ → gán câu đó style "normal".
  BAD: peak với [{text:"bạn có biết rằng đây là", type:"regular"}, {text:"bí kíp", type:"anchor"}, ...]
    ← "bạn có biết rằng đây là" = 5 từ lead-in → dùng "normal" thay vì "peak"
  GOOD: peak chỉ khi impact bắt đầu sớm — lead-in (regular/connector) trước anchor ≤ 3 từ.
  OK PATTERN: [{text:"người được thông báo", type:"regular"}, {text:"ngủ sâu", type:"anchor"}, ...]
    ← lead-in = 3 từ → CHẤP NHẬN
  Reason: pipeline tự split long lead-in thành normal sentence — nhưng Gemini không nên tạo ra pattern xấu ngay từ đầu.

  RULE C — Câu phức (mệnh đề quan hệ / đại từ lặp) → KHÔNG bao giờ là peak:
  Các câu SAU ĐÂY không thể tạo cascade đẹp → bắt buộc style = "normal":
  • Câu chứa "mà nó", "mà còn", "mà vẫn", "mà không" (relative clause) — cascade sẽ dài và rối
  • Câu lặp cùng cụm sở hữu 2 lần trở lên: "của bạn...của bạn", "cho bạn...cho bạn" — trailing dư thừa
  • Câu quá dài (> 10 từ) với nhiều cụm phụ (connector phrase > 4 từ bắt đầu bằng của/cho/mà/nó/nếu)
  BAD: "cơ bắp của bạn mà nó còn dành cho trí não của bạn" → style: "peak"  ← SAI (relative clause + lặp "của bạn")
  GOOD: "cơ bắp của bạn mà nó còn dành cho trí não của bạn" → style: "normal"  ← ĐÚNG
  Lưu ý: nếu câu quá phức nhưng muốn làm peak, HÃY chọn câu KHÁC trong đoạn gần đó có nội dung rõ ràng hơn.

  Use for: surprising premise reveal, shocking stat, mechanism climax, emotional hook, closing conclusion.
  RULES:
  - Peak NOT before 5s — hook owns that window.
  - Minimum 8s gap between two consecutive peak sentences — never cluster.
  - Peak must NOT overlap any card time window (cards and peaks occupy the same visual channel).
  - No hard cap on count — use as many as the content justifies.

CONTENT-TYPE MIXING GUIDE (for rhythm and flow):
  Hook / intro (first 15%): 1 peak for the hook climax (first moment that stops the scroll)
  Body (middle 70%): peak at every genuinely surprising fact, mechanism reveal, or emotional turn — roughly 1 peak per major sub-point
  Conclusion / CTA (last 15%): 1 peak for the final payoff line

STYLE EXAMPLES:
  "hạt chia chứa 10 gam chất xơ" → normal  (factual, no drama)
  "nó hút nước gấp 12 lần trọng lượng" → peak  (shocking ratio — STOP SCROLL moment)
  "bạn đang chiến đấu với não của chính mình" → peak  (emotional hook — strong mechanism)
  "đây là lý do bạn không thể giảm cân" → peak  (hook climax)
  "và đó là sự thật về tiểu đường" → peak  (final conclusion)
  "hôm nay chúng ta sẽ nói về hạt chia" → normal  (intro setup)
  "được trồng tại Mexico từ hàng nghìn năm trước" → normal  (background context)

STRICT SUBTITLE RULES:
1. Each sentence should be one readable semantic phrase, usually 4-8 words and never more than 9 words.
2. Do not split one complete idea into tiny fragments just to make subtitles shorter.
3. Do not merge unrelated cues into one long sentence.
4. Split long cues at natural phrase boundaries.
5. Preserve transcript timing. Do not invent timestamps.
6. Words array must contain only words from the transcript.
7. Remove filler words when they do not change meaning.
8. ANTI-DUPLICATE RULE: If a subtitle sentence's text is identical or nearly identical (≥80% word overlap) to a card title that appears at the same time window, REPHRASE the subtitle OR shift its timing so they do not appear simultaneously. A viewer should never see the same text in both the subtitle and the card at the same moment — it is redundant and visually noisy.

SEMANTIC OVERLAY RULES:
1. Select overlays by meaning and full sentence context, not by keyword matching alone.
2. For every overlay, assign one archetype that describes what kind of information it conveys:
   MECHANISM  — how something physically or chemically works: absorption, transport, gel formation, enzyme reaction, protein synthesis, any process inside the body
   BENEFIT    — a positive outcome or effect: satiety, energy, recovery, reduced inflammation, better sleep, weight control, improved focus, reduced bloating
   WARNING    — a risk, mistake, or contraindication: overexertion, wrong timing, dehydration, dangerous habit, side effect
   TIMELINE   — a duration or timing window expressed as a range: 15-30 minutes, 8 hours, within 30 minutes after eating
   METRIC     — a single measurable number with unit: 21%, 150 kcal, 120 bpm, 10000 steps
   ACTION     — a concrete step or habit the viewer should do: walk slowly after eating, drink water first, eat before workout
   INGREDIENT — use ONLY when naming or quantifying a substance itself: "hạt chia chứa omega-3", "5g chất xơ mỗi muỗng canh". If the overlay says what the substance DOES (giảm viêm, hỗ trợ tiêu hóa, xây dựng cơ bắp), use BENEFIT or MECHANISM instead
   PROCESS    — an ongoing or recurring bodily activity: digestion, metabolism, fat oxidation, blood circulation, hormonal regulation
3. Single-value metrics such as "21%", "150 kcal", "10000 buoc", "120 bpm" → archetype METRIC, type STAT.
4. Range/time metrics such as "15-30 phut" → archetype TIMELINE, type STAT.
5. Mechanism concepts such as "GLUT4", "enzyme", "receptor", "absorption" → archetype MECHANISM, type ACTION.
6. Zone or scale concepts such as "Zone 2" → archetype METRIC, type ACTION.
7. The archetype field is the primary signal the rendering engine uses to select the correct visual. Set it based on what the overlay is actually communicating, not on the topic of the video.
8. Do not use English labels in Vietnamese overlay copy. Use "duong", "te bao co", "tinh bot", "van dong" unless the scientific term itself is standard, such as GLUT4 or Zone 2.
9. Write title and detail based on the actual sentence content. Do not assume or add topic-specific framing.
10. Do not use a blood-sugar or glucose frame unless the transcript explicitly discusses blood sugar, glucose, insulin, or GLUT4.
11. MULTIPLIER FORMAT: When a card title expresses a multiplier or "times better" claim, write it as "Xn" (X2, X3, X4, X10) — NEVER "nX" (2X, 3X, 4X). Example: "HIỆU QUẢ X4" ✓, "HIỆU QUẢ 4X" ✗. This is the standard Vietnamese health content convention.

OVERLAY CARD RULES:
1. Create 7 to 10 overlay cards per video. ACTION is the dominant type — aim for at least 5 ACTION cards per video. WARNING and STAT are secondary.
2. Card types:
   - ACTION (dominant — use most): tip, mechanism, movement, nutrition concept, key fact, practical explanation. Use for anything the viewer should know, do, or remember.
   - WARNING (use sparingly — 1 to 2 max): risk, mistake, contraindication, dangerous habit.
   - STAT (use when a number stands alone): measurable numeric health metric or numeric timeline.
3. For STAT cards:
   - title: metric value with unit only (e.g. "28G", "30 PHÚT", "21%"). UPPERCASE. No extra words.
   - detail: short meaning or context, maximum 8 words. Sentence case — chữ đầu viết hoa, còn lại viết thường.
   - RESULT vs BASELINE rule: when a sentence has both a result metric AND a comparison baseline,
     ALWAYS use the RESULT metric as title — NEVER the baseline.
     RESULT = the improvement/outcome (e.g. "gấp 4 lần", "giảm 40%", "tăng 2x")
     BASELINE = what appears after "so với", "hơn", "thay vì", "compared to"
     BAD: "cải thiện gấp 4 lần so với đi bộ 10.000 bước" → STAT "10.000 BƯỚC"  ← baseline, WRONG
     GOOD: same sentence → STAT "GẤP 4 LẦN" + detail "Cải thiện huyết áp so với đi bộ thường"
4. For ACTION/WARNING cards:
   - title: short subject or hook, maximum 6 words. UPPERCASE.
   - detail: result, mechanism, risk, or practical meaning, maximum 10 words. Sentence case — chữ đầu viết hoa, còn lại viết thường.
5. Cards should not overlap each other when avoidable.
6. PEAK SEPARATION RULE (mandatory): A card must NEVER share a time window with a peak-style sentence.
   - First, finalize all peak sentence time windows (startTime → endTime).
   - Then, place every card entirely OUTSIDE those windows — before or after, never during.
   - If a natural card moment falls inside a peak window, shift the card to the nearest non-peak gap (≥0.5s clear on both sides).
   - A card and a peak sentence showing at the same time is always wrong — they occupy the same visual channel.
7. Card duration: 3.5 to 6.0 seconds. Use longer end of range (5.0–6.0s) for PROCESS/METHOD/CHECKLIST cards that describe multi-step sequences.
8. REPEAT rule: PROCESS and METHOD cards (cards describing a sequence of steps, a protocol, or a workflow) MAY appear 2 times — once near the start of the topic section, once near the end as a recap. Use the same title and detail. Space them at least 15 seconds apart. Do NOT repeat STAT, WARNING, or single-fact cards.

CARD TEXT QUALITY RULES (critical):
- NEVER copy raw transcript text into title or detail. Always rephrase into clean, standalone statements.
- NEVER include filler words: "thì", "mà", "là", "đó", "này", "nhé", "chắc chắn là", "bạn đang nghĩ", "uh", "um" or any speech hesitation.
- NEVER use incomplete thoughts or mid-sentence fragments. Every title and detail must make sense on its own without watching the video.
- title and detail must be clean, publishable Vietnamese that a viewer can read and immediately understand.
- If the source sentence is not clear enough to produce a clean card, skip it — do not create a card for that moment.

DETAIL TEXT EXAMPLES — study these carefully:
BAD (fragment copied from ASR): "kết quả mang lại hiệu quả đến mức"   → rejected: cut off mid-sentence
BAD (fragment copied from ASR): "cuộc họp quan trọng và lặp lại điều"  → rejected: "điều" is incomplete
BAD (fragment copied from ASR): "chiến lược tiến bộ đó là bạn có"      → rejected: "bạn có" is incomplete
GOOD (for 30 PHÚT STAT):        "Duy trì mỗi ngày để tích lũy kết quả" → complete thought, clear meaning
GOOD (for 10.000 BƯỚC STAT):    "Giảm 30% nguy cơ bệnh tim mạch"       → complete, stands alone
GOOD (for 40-45 PHÚT STAT):     "Đốt mỡ tối ưu ở cường độ Zone 2"      → complete, meaningful
The detail must answer "this number/fact means WHAT exactly?" in a complete phrase.
- FIX ALL ASR ERRORS before using any text in card title or detail:
  - Numbers run together: "1530" → "15-30", "2030" → "20-30", "10000" → "10.000"
  - Abbreviations: "ko" → "không", "dc" → "được", "vs" → "và", "k" → "không"
  - Words merged without space: split them correctly
  - Wrong tone marks: correct obvious mispronunciations from speech recognition
  - Never leave ASR artifacts in the final card text — rewrite from the intended meaning

NUMBERED LIST DETECTION RULES (MANDATORY — read carefully):
You MUST detect and tag lists whenever the transcript contains ANY of these patterns:

EXPLICIT triggers (speaker clearly enumerates):
- Numbers: "3 cách", "5 bước", "4 lý do", "2 điều", "cách 1... cách 2...", "bước 1... bước 2..."
- Ordinals: "thứ nhất... thứ hai... thứ ba", "đầu tiên... tiếp theo... cuối cùng"
- Sequence words: "một là... hai là... ba là", "trước tiên... sau đó... cuối cùng"

IMPLICIT triggers (speaker gives parallel items without numbering):
- 3 or more parallel "you can do X" items in sequence (e.g. "bạn có thể thêm vào nước... ăn kèm sữa chua... trộn vào sinh tố...")
- 3 or more health tips/benefits listed back-to-back with similar sentence structure
- Any section where the speaker clearly switches between distinct sub-topics of the same theme

RULES:
1. Assign the same list_group string to ALL items (e.g., "chia-usage", "fat-burn-steps", "sleep-tips")
2. Set list_index (1, 2, 3...) and list_total
3. NEVER create a list with only 1 item. Minimum 2 items required.
4. Choose list_style:
   - "progressive": 2–3 independent tips (most common for health tips)
   - "steps_overview": 4–5 sequential steps forming a protocol
   - "number_slam": items tied to a key number/stat
   - "checklist": do/don't habit items
5. During a list window: NO non-list overlays allowed.
6. When in doubt — TAG IT AS A LIST. Missing a list is worse than over-tagging.

LOTTIE ANIMATION RULE:
For each overlay, set "lottie_query_en" to the EXACT key from the AVAILABLE ANIMATIONS list below that best matches the overlay content.

Rules:
- You MUST pick from the list. Do NOT invent or modify a key.
- Each overlay MUST use a DIFFERENT key — no two overlays may share the same lottie_query_en.
- ⚠️ VARIETY IS MANDATORY: scan the FULL list before picking. Do NOT default to the first matching word. Force yourself to consider at least 5 different candidate keys before choosing.
- VISUAL QUALITY RULE: prefer animations that are COLORFUL, BRIGHT, HIGH-CONTRAST:
  • GOOD picks: fire/flame, trophy, star, lightning, rocket, growth chart, target, confetti, shield, diamond, crown, coin, medal, calendar, alarm, brain (colorful), heart pulse
  • AVOID: keys with "dark", "shadow", "night", "gray", "black" in the name. Also avoid overly clinical/anatomical keys that tend to be monochrome.
- STRONGLY PREFER visual/abstract/object icons over anatomical/body-part icons:
  • "insulin resistance" → "shield protection lock" or "target goal success" (NOT blood/organ)
  • "fat burning" → "fire flame burn" or "energy power lightning" (NOT anatomy)
  • "blood sugar stable" → "balance scale steady" or "graph line stable" (NOT blood drop)
  • Body stats → prefer chart/progress/counter keys, NOT anatomical imagery
- Use anatomical icons ONLY when the overlay is EXPLICITLY about a body part/organ
- ⚠️ MATCH THE TITLE SUBJECT FIRST — the animation must represent WHAT the card is about (its noun/topic), NOT the sentiment/quality of the detail text.
  • "CREATINE CHO MỌI NGƯỜI" + detail "an toàn" → pick "creatine supplement" (topic = creatine), NOT "shield" (sentiment = safe)
  • "INSULIN KHÁNG" + detail "nguy hiểm" → pick "insulin resistance" or "hormone balance", NOT "warning sign"
  • "NGỦ ĐỦ GIẤC" + detail "phục hồi cơ" → pick "sleep recovery" or "8 hours sleep", NOT "muscle"
- Match SEMANTICALLY — think about what the overlay COMMUNICATES as a visual concept:
  • Outcome/benefit → checkmark, trophy, star, medal, crown
  • Warning/risk → warning, danger, alert, alarm
  • Statistic/number → chart, progress bar, counter, percentage
  • Food/nutrition → food item, ingredient, leaf, fruit
  • Process/habit → gear, cycle, calendar, clock, routine
- For STAT cards: match the UNIT visually:
  "45 PHÚT" → "timer countdown clock" or "alarm clock morning"
  "GẤP 4 LẦN" → "chart statistics graph" or "growth increase arrow up" or "bar grow taller"
  "40%" → "percentage progress bar" or "loading progress circle"
- Output the key exactly as it appears in the list (spaces, not underscores).

AVAILABLE ANIMATIONS:
${(() => { const keys = [...lottieKeys]; for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; } return keys.join(', '); })()}

color field:
- "accent"  (default) — green, for positive/informational/neutral content
- "warning"           — red, for danger, risk, mistake, harmful accumulation

OPENING HOOK RULES:
Write one opening hook that captures the single most surprising or counterintuitive insight in this video.
- kicker: 2-4 uppercase words naming the topic (e.g., "SỨC KHỎE", "DINH DƯỠNG", "HẠT CHIA", "GIẤC NGỦ")
- title: 5-9 uppercase words that create tension or surprise. Start with "ĐỪNG" / "BẠN ĐANG" / "SAI LẦM" / "ÍT AI BIẾT" to provoke curiosity. Do not reveal the answer.
- punch: 4-7 uppercase words that hint at the insight without fully explaining it. Start with a verb.

B-ROLL QUERY RULES:
Before scheduling, add "broll_queries_en" at the root level: 4-6 English search queries for Pexels Videos.
Rules:
- English only. Each query must describe a SPECIFIC SCENE from this video's content — not a generic topic.
- Think: what would a camera crew film to illustrate THIS specific moment in the video?
- Include WHO + doing WHAT + WHERE/HOW. 4-7 words per query.
- Good: "person walking slowly after dinner street", "elderly man interval walk park", "woman checking fitness watch heart rate outdoor"
- Bad: "walking", "exercise", "health lifestyle", "fitness person" — too vague, useless for matching
- Each query should match a DIFFERENT key moment discussed in the transcript.
- Portrait orientation preferred (vertical video).

B-ROLL SCHEDULING RULES:
B-roll is OPTIONAL. Only schedule a clip if it specifically and clearly illustrates what the speaker is saying.
- Only in gaps between overlay cards (no card showing)
- Each clip 3-4 seconds
- If no clip closely matches the spoken content → skip that gap entirely. Talking head is fine.
- Do NOT force clips just to fill time. Irrelevant B-roll is worse than no B-roll.
- If no B-roll fits → skip that gap entirely (empty entry, no filler)
- Each item must have "filename" (video clip)
- NEVER use the same filename more than once across the entire schedule
- filename must be EXACTLY as listed in B-roll clips below

Available B-roll clips (video):
${(() => { const activeBroll = typeof getBrollIndex === "function" ? getBrollIndex() : (brollIndex || []); return activeBroll.map(c => `  ${c.filename} — ${c.description || (c.keywords_en||[]).slice(0,4).join(", ")}`).join("\n"); })()}

Input Cues:
${JSON.stringify(cues, null, 2)}
`;

  const payload = {
    contents: [{
      parts: [{ text: promptText }]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          sentences: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                index: { type: "INTEGER" },
                text: { type: "STRING" },
                startTime: { type: "NUMBER" },
                endTime: { type: "NUMBER" },
                words: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                },
                style: { type: "STRING", enum: ["normal", "peak"] },
                peak_lines: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      text: { type: "STRING" },
                      type: { type: "STRING", enum: ["connector", "regular", "anchor", "script", "script_climax"] }
                    },
                    required: ["text", "type"]
                  }
                }
              },
              required: ["index", "text", "startTime", "endTime", "words", "style", "peak_lines"]
            }
          },
          overlays: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                type: { type: "STRING", enum: ["WARNING", "ACTION", "STAT"] },
                archetype: { type: "STRING", enum: ["MECHANISM","BENEFIT","WARNING","TIMELINE","METRIC","ACTION","INGREDIENT","PROCESS","COMPARISON","TRANSFORMATION"] },
                title: { type: "STRING" },
                detail: { type: "STRING" },
                startTime: { type: "NUMBER" },
                endTime: { type: "NUMBER" },
                visual_value: { type: "NUMBER" },
                metric_direction: { type: "STRING", enum: ["up","down","multiply","min","max","cycle","approx","neutral"] },
                lottie_query_en: { type: "STRING" },
                list_group:      { type: "STRING" },
                list_index:  { type: "INTEGER" },
                list_total:  { type: "INTEGER" },
                list_style:  { type: "STRING", enum: ["progressive","steps_overview","number_slam","checklist"] }
              },
              required: ["type", "archetype", "title", "detail", "startTime", "endTime", "visual_value", "lottie_query_en"]
            }
          },
          hook: {
            type: "OBJECT",
            properties: {
              kicker: { type: "STRING" },
              title:  { type: "STRING" },
              punch:  { type: "STRING" }
            },
            required: ["kicker", "title", "punch"]
          },
          broll_schedule: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                startTime: { type: "NUMBER" },
                endTime:   { type: "NUMBER" },
                filename:  { type: "STRING" }
              },
              required: ["startTime", "endTime", "filename"]
            }
          },
          broll_queries_en: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["sentences", "overlays", "hook", "broll_schedule"]
      }
    }
  };

  const models = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
  let lastErr = null;
  for (const model of models) {
    let attempts = 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        console.log(`[gemini] Calling API using model: ${model} (Attempt ${attempt}/${attempts})...`);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API error: ${response.status} - ${errText}`);
        }

        const resultJson = await response.json();
        const textContent = resultJson.candidates[0].content.parts[0].text;
        return JSON.parse(textContent);
      } catch (err) {
        lastErr = err;
        console.log(`\n⚠  Gemini API call with ${model} failed (Attempt ${attempt}/${attempts}): ${err.message}`);
        if (attempt < attempts) {
          console.log(`Retrying in 4 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }
    }
  }
  throw lastErr;
}

  // rewriteCardText — dùng Gemini Flash để làm sạch title/detail của từng card
// Input:  mảng overlays (in-place mutation)
// Output: mutates ov.title / ov.detail cho những card có text lủng củng từ ASR
async function rewriteCardText(overlays, apiKey) {
  const cards = overlays.filter(ov => ov.title);
  if (!cards.length) return;

  console.log(`[rewriteCards] Cleaning text for ${cards.length} cards via Gemini...`);

  const cardInputs = cards.map(ov => ({
    id:     ov.startTime,        // số thực — unique per card
    title:  ov.title  || "",
    detail: ov.detail || ""
  }));

  const prompt = `Bạn là biên tập viên nội dung tiếng Việt chuyên nghiệp. Làm sạch text của các card dưới đây.
Input là transcript ASR (nhận dạng giọng nói tự động) — có thể chứa từ đệm, câu không hoàn chỉnh, ngữ pháp lủng củng.

QUY TẮC BẮT BUỘC:
1. title: tối đa 6 từ — không từ đệm, nghĩa độc lập, ngắn gọn súc tích, dùng được làm tiêu đề đứng một mình
2. detail: tối đa 15 từ — câu hoàn chỉnh, không từ đệm, thông tin cụ thể rõ ràng, đọc độc lập vẫn hiểu
3. Giữ nguyên ý nghĩa cốt lõi — KHÔNG bịa thêm con số hoặc thông tin mới
4. Chỉ tiếng Việt, giữ nguyên tên riêng/thuật ngữ tiếng Anh nếu có
5. Trả về đúng JSON array, không thêm bất kỳ text giải thích nào

Input JSON:
${JSON.stringify(cardInputs)}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type:     "OBJECT",
          properties: {
            id:     { type: "NUMBER" },
            title:  { type: "STRING" },
            detail: { type: "STRING" }
          },
          required: ["id", "title", "detail"]
        }
      }
    }
  };

  const models = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"];
  let result = null;

  for (const model of models) {
    try {
      console.log(`[rewriteCards] Trying model: ${model}...`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const json   = await response.json();
      result = JSON.parse(json.candidates[0].content.parts[0].text);
      console.log(`[rewriteCards] ✓ Model ${model} succeeded`);
      break;
    } catch (err) {
      console.log(`[rewriteCards] ✗ ${model} failed: ${err.message}`);
    }
  }

  if (!result || !Array.isArray(result)) {
    console.log("[rewriteCards] ⚠  All models failed — keeping original card text");
    return;
  }

  // Apply rewrites in-place
  const map = new Map(result.map(r => [r.id, r]));
  let applied = 0;
  for (const ov of overlays) {
    const r = map.get(ov.startTime);
    if (!r) continue;
    if (r.title  && r.title.trim())  ov.title  = r.title.trim();
    if (r.detail && r.detail.trim()) ov.detail = r.detail.trim();
    applied++;
  }
  console.log(`[rewriteCards] Applied rewrites to ${applied}/${cards.length} cards`);
}
// ───────────────────────────────────────────────────────────────────

  return {
    callGemini,
    rewriteCardText
  };
}
