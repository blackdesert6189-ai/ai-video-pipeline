/**
 * src/pipeline/lottieFilter.js
 * Lottie icon luminance analysis and CSS drop-shadow/brightness filter generation.
 * Pure deterministic calculation without filesystem or browser dependencies.
 */

function analyzeLottieAvgBrightness(animData) {
  const vals = [];
  function fromShape(s) {
    if (!s) return;
    if ((s.ty === 'fl' || s.ty === 'st') && s.c && s.c.k !== undefined) {
      const k = s.c.k;
      if (Array.isArray(k) && typeof k[0] === 'number' && k.length >= 3) {
        vals.push(0.299 * k[0] + 0.587 * k[1] + 0.114 * k[2]);
      } else if (Array.isArray(k)) {
        k.forEach(kf => {
          if (kf.s && typeof kf.s[0] === 'number')
            vals.push(0.299 * kf.s[0] + 0.587 * kf.s[1] + 0.114 * kf.s[2]);
        });
      }
    }
    if (s.it) s.it.forEach(fromShape);
  }
  function fromLayer(layer) {
    if (!layer) return;
    if (layer.ty === 1) return; // solid bg layer — skip
    const nm = (layer.nm || '').toLowerCase().trim();
    if (nm === 'bg' || nm === 'bkg' || nm === 'background' || nm === 'backdrop') return;
    if (layer.shapes) layer.shapes.forEach(fromShape);
    if (layer.layers) layer.layers.forEach(fromLayer);
  }
  if (animData && animData.layers) animData.layers.forEach(fromLayer);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.5;
}

export function getLottieIconFilter(animData, isWarn) {
  const avg = analyzeLottieAvgBrightness(animData);
  const glow = isWarn
    ? 'drop-shadow(0 0 14px rgba(255,68,68,0.88)) drop-shadow(0 4px 12px rgba(0,0,0,0.55))'
    : 'drop-shadow(0 0 20px rgba(166,255,61,0.88)) drop-shadow(0 4px 12px rgba(0,0,0,0.6))';
  if (avg < 0.20) return 'brightness(4.5) contrast(0.85) ' + glow;
  if (avg < 0.40) return 'brightness(2.5) ' + glow;
  if (avg < 0.55) return 'brightness(1.6) ' + glow;
  return glow;
}
