// Hand ROI cascade — square crops only (contract).
// A non-square crop scaled into a square canvas skews angles and basis
// vectors; every crop below is square by construction.

const MIN_ROI_PX = 96;
const ROI_SCALE = 1.7;
const REACH = 0.35;

function vis(j) {
  return j?.visibility ?? 0;
}

function squareROI(wrist, elbow, frameW, frameH) {
  if (!wrist || !elbow) return null;
  const conf = Math.min(vis(wrist), vis(elbow));
  const forearm = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
  const size = Math.max(MIN_ROI_PX, forearm * ROI_SCALE);

  let dx = wrist.x - elbow.x, dy = wrist.y - elbow.y;
  const fl = Math.hypot(dx, dy) || 1;
  dx /= fl; dy /= fl;
  const cx = wrist.x + dx * size * REACH;
  const cy = wrist.y + dy * size * REACH;

  let x = cx - size / 2, y = cy - size / 2;
  x = Math.max(0, Math.min(x, frameW - size));
  y = Math.max(0, Math.min(y, frameH - size));

  return {
    crop: { x: Math.round(x), y: Math.round(y), width: Math.round(size), height: Math.round(size) },
    confidence: conf,
  };
}

export function computeHandROIs(body, frameW, frameH) {
  const j = body?.joints2d;
  if (!j) return { left: null, right: null };
  return {
    left:  squareROI(j.leftWrist,  j.leftElbow,  frameW, frameH),
    right: squareROI(j.rightWrist, j.rightElbow, frameW, frameH),
  };
}

export function remapLandmarks(landmarks, roi, frameW, frameH) {
  if (!roi || !landmarks) return landmarks;
  const { x, y, width, height } = roi.crop;
  const sx = width / frameW, sy = height / frameH;
  return landmarks.map((lm) => ({
    x: (x + lm.x * width) / frameW,
    y: (y + lm.y * height) / frameH,
    z: (lm.z || 0) * sx,
  }));
}
