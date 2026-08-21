/**
 * src/pipeline/layout.js
 * Centralized layout configuration and mathematical derivations.
 */

export function createLayout() {
  const layout = {
    canvas:     { w: 1080, h: 1920 },
    card: {
      defaultTop:    1100,   // px — INFO card top (lower third: ~57% of 1920)
      statTop:       900,    // px — STAT card top (giữ nguyên vị trí STAT)
      offscreenLeft: -700,   // px — vị trí ngoài màn hình (legacy, không dùng cho float-up)
      neonBarLeft:   70,     // px — vị trí thanh neon dọc (boundary trái của visual content)
      infoLeft:      80,     // px — centered: (1080 - 920) / 2 = 80
      statLeft:      70,     // px — STAT card slide-in target (bắt đầu từ neon bar)
      introX:        -160,   // px — legacy, không dùng
      width:         920,    // px — INFO card width (wider: ~85% of 1080, centered)
      height:        175,    // px — INFO card height (reference only, CSS dùng auto)
      lottieRatio:   0.34,   // legacy — lottie cell đã removed khỏi card layout
      lottieIconSize: 200,   // px — float Lottie animation free-floating (TYB style, no circle)
      statWidth:     920,    // px — STAT card width
      statMinHeight: 250,    // px — STAT card min-height
      stackOffset:   160,    // px — đẩy card xuống nếu 2 card cùng lúc
      exitX:         -34,    // px — hướng slide ra (âm = trái, dương = phải)
      titleFontSize:       42,  // px — INFO card title (must dominate body)
      bodyFontSize:        26,  // px — INFO card body (supporting detail, smaller than title)
      listTitleFontSize:   26,  // px — list card title (progressive/slam/check)
      listDetailFontSize:  22,  // px — list card detail
    },
    visualRow: {
      // width KHÔNG định nghĩa ở đây — tự tính từ card.width / card.statWidth
      left:       70,     // px — bắt đầu tại neon bar, không bao giờ vượt trái
      top:        975,    // px — ngay dưới INFO card (820+155)
      statTop:    1150,   // px — ngay dưới STAT card (900+250)
      height:     320,    // px — chiều cao visual row
      imageWidth: 420,    // px — chiều rộng image cell (bên phải primitive)
      introX:     -24,    exitX: -16,
    },
    subtitle: {
      top:         1520,  // px — normal container top (lower third)
      peakTop:     1050,  // px — peak: chest level (~55% of 1920 canvas)
      left: 40, width: 1000, height: 340,
      maxWords: 6,
      // ── 2-mode display sizes ──────────────────────────────────────
      normalFontSize:            34,  // px — standard pill karaoke
      // ── TYB peak chunk types (5 types, Gemini-labeled) ────────────
      peakConnectorSize:         28,  // px — L5: glue words, rất nhỏ — chỉ là context glue
      peakRegularSize:           52,  // px — L4: context phrase, middle step rõ hơn
      peakAnchorSize:            124, // px — L1: key concept — focal point dominant (to nhất)
      peakScriptSize:            68,  // px — L3: italic accent (DVN Grandy mờ) — TYB small italic style
      peakScriptClimaxSize:      96,  // px — L2: cursive accent — style/màu nổi, size nhường anchor làm focal
      peakScriptClimaxFont:      'DVN Grandy',  // local font — assets/fonts/DVN-Grandy-gehcaa.ttf
      peakScriptClimaxLineHeight: 0.82, // cursive font em-box lớn hơn ExtraBold — tighten để giảm dead space
      // peakScriptClimaxTopOffset — derived below từ font size × 0.13 (tỉ lệ dead-space trên của DVN Grandy)
      peakIndentStep:            16,  // px — subtle cascade indent (magazine feel)
      // legacy (kept for fallback)
      peakRegularFontSize:       48,
      peakRegularBottomFontSize: 36,
      peakKeyFontSize:           64,
    },
    hook: {
      fadeOutAt:  4.2,  // giây — hook bắt đầu fade out
      safeStart:  4.8,  // card không được xuất hiện trước thời điểm này
    },
    colors: {
      accent:    '#a6ff3d',
      accentRgb: '166,255,61',
      warning:   '#ff4444',
      yellow:    '#f5c518',
      darkBg:    '#0a0a0a',
      statBg:    'rgba(5,5,5,0.92)',
    },
    // ── Cinematic grade — drives both HTML vignette overlay and FFmpeg color grade ──
    cinematic: {
      // FFmpeg eq filter on final composited video output
      colorGrade: {
        enabled:    true,
        brightness: 0.00,   // neutral
        contrast:   1.10,   // cinematic punch
        saturation: 1.12,   // màu tươi nhưng không lòe loẹt
        gamma:      0.91,   // mids tối — cảm giác depth
        gammaR:     1.07,   // highlight ấm cam — skin tone đẹp
        gammaG:     0.98,   // mids hơi lạnh — complement lime green
        gammaB:     0.90,   // shadow teal — teal-orange contrast
      },
      // CSS radial-gradient vignette baked into PNG overlay frames
      vignette: {
        enabled:    true,
        opacity:    0.72,   // max darkness at edges/corners (0–1)
        ellipseX:   55,     // % — X-radius of clear center ellipse
        ellipseY:   32,     // % — Y-radius of clear center ellipse
        centerX:    50,     // % — gradient origin X
        centerY:    42,     // % — gradient origin Y (above center = face framing)
        clearAt:    30,     // % — inner fully-transparent stop
        fadeAt:     72,     // % — mid-fade transition stop
      },
      // CSS linear-gradient ở phần dưới — tăng cảm giác depth & cinematic ở 1/4 dưới video
      bottomGrad: {
        enabled:    true,
        opacity:    0.62,   // max darkness tại đáy (0–1) — đủ cinematic, không che subject
        heightPct:  27,     // % canvas height từ dưới lên mà gradient phủ
        midOpacity: 0.18,   // opacity tại điểm giữa gradient (tạo curve mềm, không linear)
      },
    },
  };

  // Derived: cursive font (DVN Grandy) tạo dead-space ở trên glyph ~12% của font-size
  // → margin-top âm để kéo chunk script_climax lên, loại bỏ khoảng trắng thừa
  layout.subtitle.peakScriptClimaxTopOffset = -Math.round(layout.subtitle.peakScriptClimaxSize * 0.12);

  // ── Peak chunk validation rules — đặt ở LAYOUT để dễ điều chỉnh, không hardcode trong logic ──
  layout.peak = {
    maxClimaxPerSentence: 1,          // số script_climax tối đa mỗi peak sentence
    maxChunks:            4,          // TYB max 3-4 dòng — Gemini hay trả 5-6, cần cap

    // Anchor KHÔNG được kết thúc bằng giới từ/liên từ — "lập trình cho" → anchor sai
    // Rule: anchor phải là semantic unit độc lập (noun/verb), không trailing preposition
    anchorEndBlockPattern: /\s+(cho|về|trong|trên|dưới|từ|với|đến|tới|qua|sau|trước|theo|tại|ở|của|mà|và|hay|hoặc|nhưng|vì|nếu|khi|để|như|bằng|ngoài|suốt|cùng|giữa|là|thì|mà)\s*$/i,

    // Anchor bắt đầu bằng động từ hành động → split: verb → connector, phần còn lại → anchor
    // "giảm các triệu chứng" → anchor sai → split: connector="giảm", anchor="triệu chứng"
    // Classifier/article ở đầu anchor cũng split tương tự
    // RULE: dùng FULL compound verb phrases (không dùng âm tiết lẻ để tránh false match)
    // Longer phrases first → regex tries them before shorter alternatives
    // "tăng cường sức mạnh" → connector="tăng cường", regular="sức mạnh" (anchor guarantee picks "sức mạnh")
    // "mang lại lợi ích"    → connector="mang lại", regular="lợi ích" → anchor="lợi ích"
    // "giảm triệu chứng"    → connector="giảm", regular="triệu chứng" → anchor="triệu chứng"
    anchorVerbHeadPattern: /^(tăng cường|cải thiện|hỗ trợ|bảo vệ|phòng ngừa|điều trị|phục hồi|duy trì|kiểm soát|loại bỏ|thúc đẩy|mang lại|đem lại|kích thích|ức chế|giảm thiểu|giúp|giảm|tăng)\s+/i,
    // Classifier/article KHÔNG được đứng cuối anchor → trailing classifier → demote toàn anchor
    anchorTrailingClassifierPattern: /\s+(các|cái|những|một|mỗi|này|đó|kia|ấy)\s*$/i,

    // Cross-chunk compound noun repair — linguistic rule, không hardcode từ cụ thể
    // Nếu từ CUỐI của chunk[i] khớp pattern → có thể đang là nửa đầu từ ghép 2 âm tiết
    // → merge từ đầu tiên của chunk[i+1] vào chunk[i] để phục hồi từ ghép
    // RULE: Dùng dạng ASCII (foldText) để tránh Unicode NFC/NFD collision từ Gemini API
    // Gemini có thể trả về diacritics ở NFD form, trong khi regex source code là NFC → không match
    // → Luôn test bằng foldText(lastWord) thay vì raw lastWord
    // Guard currWords.length <= 2 đảm bảo chỉ fix chunk đơn hoặc chunk 2-từ cuối là compound prefix
    compoundPrefixPattern: /^(hieu|te|thu|khang|trao|xuc|thi|thinh|vi|khuu|sinh|ly|cau|chuc|tac|tich|uc|dan|bien|trieu|ket|tham|gia|tri|oxy|mo|he|tong|nguyen|tieu|tiet|chuyen|hap|tuan|dac|hau|co|ao|than)$/i,
    // Loại bỏ: 'hoa'(hóa) → collision với "hoa"(flower); 'ho'(hô) → collision với "ho"(cough); 'qua'(quá) → collision với "qua"(pass)

    // Regex patterns: phrase khớp bất kỳ rule nào → KHÔNG được là script_climax
    // Nguyên tắc: structural linguistic rules (giới từ, đại từ sở hữu, mẫu ngữ pháp)
    // — KHÔNG liệt kê từ/cụm từ nội dung cụ thể (đó mới là hardcode)
    climaxBlockRules: [
      // 1. Bắt đầu bằng giới từ / liên từ / copula → đây là mệnh đề phụ thuộc, không phải concept độc lập
      // "là ..." = mệnh đề mô tả/phân loại; "thì ..." = mệnh đề điều kiện — đều không phải impact line
      /^(cho|của|với|trong|trên|dưới|về|từ|đến|tới|mà|và|hay|hoặc|nhưng|vì|nếu|khi|để|như|bằng|qua|sau|trước|ngoài|theo|tại|ở|suốt|cùng|khỏi|giữa|là|thì)\s/i,
      // 2. Kết thúc bằng đại từ sở hữu → phrase phụ thuộc, không độc lập
      /của\s+(bạn|mình|tôi|tớ|họ|nó|ta|chúng\s*ta|mọi\s*người)\s*$/i,
      // 3. Bắt đầu bằng từ chỉ mức độ (modifier, không phải concept)
      /^(rất|quá|cực|vô cùng|hết sức|khá|hơi|chút|siêu)\s+\S/i,
      // 4. Bắt đầu bằng từ chỉ tần suất / thời điểm (time expression không phải concept)
      /^(mỗi|hàng|suốt|cả|từng)\s+(ngày|tuần|tháng|năm|giờ|phút|lần|buổi|sáng|chiều|tối)\s*$/i,
      // 5. Filler / discourse marker — không mang nội dung semantic
      /^(như vậy|như thế|vậy thôi|mà thôi|thôi|vậy đó|thế đó|đó thôi|chỉ vậy|không hơn)\s*$/i,
      // 6. Bắt đầu bằng từ chỉ mục đích → bổ ngữ mục đích, không phải concept chính
      /^(để|nhằm|nhằm mục đích|hướng tới|hướng đến)\s/i,
    ],

    // ── Smart cascade indent — tự động canh lề line 2 & 3 theo font size, không hardcode px ──
    // Rule: line 2 bắt đầu sau ký tự đầu tiên của anchor (line 1)
    //       line 3 bắt đầu tại vị trí ước tính cuối line 2
    //       → tạo visual "right-staircase" thay vì các bước nhỏ đều nhau (16px/32px)
    peakSmartIndentEnabled:   true,
    peakSmartFirstCharRatio:  0.50,   // width ký tự đầu anchor ≈ anchorFontSize × ratio
    peakSmartRegCharRatio:    0.55,   // avg char advance ≈ fontSize × ratio (regular/connector)
    peakSmartScriptCharRatio: 0.48,   // avg char advance của DVN Grandy cursive (hẹp hơn một chút)
    peakSmartAvgWordChars:    3.0,    // trung bình số ký tự/từ tiếng Việt
    peakSmartClimaxTopPullRatio: 0.35, // pull-up tỷ lệ với font size của line 2 — tự scale khi font thay đổi
                                     // ví dụ: regular 44px → pull = round(44×0.35) = 15px
                                     //        connector 34px → pull = round(34×0.35) = 12px

    // ── TYB Per-word adaptive sizing ─────────────────────────────────────────────
    // Rule 1: Function words (sẽ, lại, của...) trong anchor chunk → nhỏ xíu inline
    //         Content words (giảm, đốt, kết quả...) → full chunk size
    //         Ví dụ: anchor "sẽ đốt cơ" → "sẽ" hiện ≈35px, "đốt cơ" hiện 124px (TYB: "lại GIẢM")
    peakFunctionWordScale:    0.28,   // function_word_size = chunkFontSize × 0.28
    peakFunctionWordMinSize:  18,     // px — sàn tối thiểu (tránh quá nhỏ không đọc được)

    // Rule 2: Cascade không có anchor → climax TRỞ THÀNH hero (lớn nhất), regular thành label
    //         Cascade có anchor   → anchor là hero, climax là accent, regular là support
    //         Ví dụ no-anchor: "thì đạt được cái" (28px) + "điểm số cao hơn" (100px) → climax dominates
    peakRegularSizeFaded:     28,     // px — regular xuống connector size khi ko có anchor
    peakClimaxSizeHero:       100,    // px — climax hero size khi ko có anchor (gần anchor để dominant)
    // Indent cho no-anchor cascade: climax indent lớn hơn step mặc định để staircase visible
    peakNoAnchorClimaxIndent: 32,    // px — min indent climax hero (no anchor) vs 16px default step

    // ── Anchor guarantee system ───────────────────────────────────────────────────
    // TYB rule: mọi cascade PHẢI có anchor (focal point trắng đậm) + script_climax (gold accent)
    // Nếu Gemini không assign anchor → pipeline tự promote regular phù hợp → anchor
    anchorMaxWords:       3,     // anchor tối đa 3 từ (tránh overflow 124px × n words)
    anchorPromoteEnabled: true,  // bật/tắt tính năng tự promote regular → anchor
  };

  // ── Peak animation timing — all values in LAYOUT, no magic numbers in GSAP code ──
  // Hiệu ứng: các hàng xuất hiện từ dưới lên (bottom-first stagger), thoát từ trên xuống
  layout.peakAnim = {
    enterY:        18,             // px  — chunk bắt đầu bên dưới vị trí đúng, slide lên
    enterX:        -5,             // px  — nhích trái nhẹ khi enter
    enterDuration: 0.22,           // s   — mỗi chunk enter mất bao lâu
    enterEase:    'back.out(1.5)', //     — hơi nảy nhẹ cho "uyển chuyển"
    enterStagger:  0.09,           // s   — delay giữa mỗi chunk (bottom chunk đầu tiên)
    exitY:         -8,             // px  — drift lên nhẹ khi exit
    exitDuration:  0.18,           // s
    exitEase:     'power2.in',
    exitStagger:   0.04,           // s   — top chunk exit đầu tiên
  };

  // ── Derived LAYOUT values (tính sau khi object đã định nghĩa xong) ──
  // infoLeft: căn giữa card — (canvas.w - card.width) / 2, không hardcode
  layout.card.infoLeft = Math.round((layout.canvas.w - layout.card.width) / 2);
  // peakSmartFirstCharWidth: ước tính width ký tự đầu tiên của anchor (116px bold)
  // = anchorFontSize × firstCharRatio → tự scale nếu peakAnchorSize thay đổi
  layout.subtitle.peakSmartFirstCharWidth = Math.round(
    layout.subtitle.peakAnchorSize * layout.peak.peakSmartFirstCharRatio
  );
  // visualRow.top: an toàn phía trên subtitle, không overlap
  // Constraint: top + height < subtitle.top → top < 1520 - 320 = 1200
  // Giữ 975 (giữa màn hình ~50%) — visual row xuất hiện khi B-roll, không phải lúc card on screen
  // layout.visualRow.top giữ nguyên = 975 (đã định nghĩa trong layout object ở trên)

  return layout;
}
