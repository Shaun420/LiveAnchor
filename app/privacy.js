let privacyEnabled = true;
let maskImageData = null;
let debugCounter = 0;

// Tune this if needed:
// 0   = very permissive
// 255 = very strict
const PERSON_THRESHOLD = 127;

export function isPrivacyEnabled() {
  return privacyEnabled;
}

export function setPrivacyEnabled(val) {
  privacyEnabled = val;
}

export function drawPrivacyMask(bgCanvas, mask) {
  const ctx = bgCanvas.getContext("2d");
  const cw = bgCanvas.width;
  const ch = bgCanvas.height;

  ctx.clearRect(0, 0, cw, ch);

  if (!privacyEnabled || !mask || !mask.data) return;

  const mw = mask.width;
  const mh = mask.height;

  if (!maskImageData || maskImageData.width !== cw || maskImageData.height !== ch) {
    maskImageData = ctx.createImageData(cw, ch);
    console.log("[Privacy] ImageData ready:", cw, "x", ch);
  }

  const out = maskImageData.data;
  const src = mask.data;

  let visiblePixels = 0;

  // Fast path: mask matches canvas size
  if (mw === cw && mh === ch) {
    for (let i = 0; i < src.length; i++) {
      const j = i * 4;
      const person = src[i] >= PERSON_THRESHOLD;

      if (person) {
        out[j] = 0;
        out[j + 1] = 0;
        out[j + 2] = 0;
        out[j + 3] = 255;
        visiblePixels++;
      } else {
        out[j] = 0;
        out[j + 1] = 0;
        out[j + 2] = 0;
        out[j + 3] = 0;
      }
    }
  } else {
    // Fallback if sizes differ
    const scaleX = mw / cw;
    const scaleY = mh / ch;

    for (let y = 0; y < ch; y++) {
      const my = Math.min(mh - 1, Math.floor(y * scaleY));
      for (let x = 0; x < cw; x++) {
        const mx = Math.min(mw - 1, Math.floor(x * scaleX));
        const m = src[my * mw + mx];
        const j = (y * cw + x) * 4;
        const person = m >= PERSON_THRESHOLD;

        if (person) {
          out[j] = 0;
          out[j + 1] = 0;
          out[j + 2] = 0;
          out[j + 3] = 255;
          visiblePixels++;
        } else {
          out[j] = 0;
          out[j + 1] = 0;
          out[j + 2] = 0;
          out[j + 3] = 0;
        }
      }
    }
  }

  ctx.putImageData(maskImageData, 0, 0);

  // Small debug log every ~120 frames
  if (++debugCounter % 120 === 0) {
    const ratio = ((visiblePixels / (cw * ch)) * 100).toFixed(1);
    console.log(`[Privacy] visible pixels: ${visiblePixels} (${ratio}%) threshold:${PERSON_THRESHOLD}`);
  }
}