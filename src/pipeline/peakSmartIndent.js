/**
 * src/pipeline/peakSmartIndent.js
 * Peak subtitle smart indentation and climax top pull-up calculation.
 * Computes padding-left staircase and margin-top dead-space correction for peak cascades.
 */

export function createPeakSmartIndent({
  layoutPeak,
  layoutSubtitle
}) {
  function getPeakSmartIndents(chunks) {
    const LP = layoutPeak;
    const LS = layoutSubtitle;
    if (!LP.peakSmartIndentEnabled)            return null; // feature flag
    if (chunks[0].type !== 'anchor')           return null; // anchor must be first
    if (chunks[chunks.length - 1].type !== 'script_climax') return null; // script_climax must be last

    const firstCharW = LS.peakSmartFirstCharWidth; // = Math.round(anchorSize * 0.50)

    // ── 2-chunk shortcut: anchor + script_climax ──
    if (chunks.length === 2) {
      return {
        indents: [0, firstCharW],
        climaxExtraTopPull: 0,
      };
    }

    // ── Estimate line 2 width ──
    const midChunk  = chunks[1];
    const midWords  = midChunk.text.trim().split(/\s+/).filter(Boolean);
    const midFontSz = ({
      connector:    LS.peakConnectorSize,
      regular:      LS.peakRegularSize,
      anchor:       LS.peakAnchorSize,
      script:       LS.peakScriptSize,
      script_climax: LS.peakScriptClimaxSize,
    })[midChunk.type] ?? LS.peakRegularSize;
    const midEstW = Math.round(
      midWords.length * midFontSz * LP.peakSmartRegCharRatio * LP.peakSmartAvgWordChars
    );

    // ── Estimate line 3 width (DVN Grandy cursive) for safety-cap ──
    const scChunk = chunks[2];
    const scWords = scChunk.text.trim().split(/\s+/).filter(Boolean);
    const scEstW  = Math.round(
      scWords.length * LS.peakScriptClimaxSize * LP.peakSmartScriptCharRatio * LP.peakSmartAvgWordChars
    );

    // Indent line 3 = firstCharW + estimated line 2 width
    // Cap: ensure line 3 does not overflow container (left margin 20px)
    const rawLine3Indent = firstCharW + midEstW;
    const maxSafeIndent  = Math.max(LS.width - scEstW - 20, firstCharW);
    const line3Indent    = Math.min(rawLine3Indent, maxSafeIndent);

    // Pull-up proportional to line 2 font-size
    const climaxExtraTopPull = Math.round(midFontSz * LP.peakSmartClimaxTopPullRatio);

    return {
      indents: chunks.map((_, i) => {
        if (i === 0) return 0;
        if (i === 1) return firstCharW;
        if (i === 2) return line3Indent;
        return i * LS.peakIndentStep; // 4+ chunks: fallback
      }),
      climaxExtraTopPull,
    };
  }

  return {
    getPeakSmartIndents
  };
}
