import { FACE } from "./constants.js";

function get2D(landmarks, idx, w, h) {
  const lm = landmarks[idx];
  return { x: lm.x * w, y: lm.y * h, z: lm.z };
}

function get3D(worldLandmarks, idx) {
  const lm = worldLandmarks[idx];
  return { x: lm.x, y: lm.y, z: lm.z };
}

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function extractFace(landmarks, worldLandmarks, video, calibration) {
  const w = video.videoWidth;
  const h = video.videoHeight;

  const leftEye = get2D(landmarks, FACE.LEFT_EYE_OUTER, w, h);
  const rightEye = get2D(landmarks, FACE.RIGHT_EYE_OUTER, w, h);
  const nose = get2D(landmarks, FACE.NOSE, w, h);
  const chin = get2D(landmarks, FACE.CHIN, w, h);
  const forehead = get2D(landmarks, FACE.FOREHEAD, w, h);
  const upperLip = get2D(landmarks, FACE.UPPER_LIP, w, h);
  const lowerLip = get2D(landmarks, FACE.LOWER_LIP, w, h);

  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const eyeCenterY = (leftEye.y + rightEye.y) / 2;
  const eyeDistance = dist2D(leftEye, rightEye);

  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;
  const roll = Math.atan2(dy, dx);

  let yaw = 0, pitch = 0;

  if (worldLandmarks) {
    const nose3D = get3D(worldLandmarks, FACE.NOSE);
    const leftEye3D = get3D(worldLandmarks, FACE.LEFT_EYE_OUTER);
    const rightEye3D = get3D(worldLandmarks, FACE.RIGHT_EYE_OUTER);

    const ec3d = {
      x: (leftEye3D.x + rightEye3D.x) / 2,
      y: (leftEye3D.y + rightEye3D.y) / 2,
      z: (leftEye3D.z + rightEye3D.z) / 2,
    };

    const fwd = {
      x: nose3D.x - ec3d.x,
      y: nose3D.y - ec3d.y,
      z: nose3D.z - ec3d.z,
    };
    const len = Math.hypot(fwd.x, fwd.y, fwd.z) || 1;
    fwd.x /= len; fwd.y /= len; fwd.z /= len;

    yaw = Math.atan2(fwd.x, fwd.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, -fwd.y)));
  } else {
    const faceWidth = dist2D(
      get2D(landmarks, FACE.LEFT_EAR, w, h),
      get2D(landmarks, FACE.RIGHT_EAR, w, h)
    );
    yaw = ((nose.x - eyeCenterX) / (faceWidth || 1)) * 1.2;
    pitch = ((nose.y - eyeCenterY) / (dist2D(forehead, chin) || 1)) * 0.8;
  }

  const mouthOpen = dist2D(upperLip, lowerLip) / (eyeDistance || 1);

  // Eye gaze extraction
  const gaze = extractGaze(landmarks, w, h);

  return {
    x: eyeCenterX,
    y: eyeCenterY,
    xNorm: eyeCenterX / w,
    yNorm: eyeCenterY / h,
    eyeDistance,
    eyeDistanceNorm: eyeDistance / w,
    yaw: yaw - calibration.yaw,
    pitch: pitch - calibration.pitch,
    roll: roll - calibration.roll,
    mouthOpen,
    confidence: 1.0,
    gaze,
  };
}

// ============================================================
// Eye gaze: compute where each iris is relative to the eye bounds
// Includes dead-zone (anti-jitter) and de-crossing bias (anti-crosseyed)
// ============================================================

const GAZE_DEAD_ZONE = 0.05;      // Ignores micro-saccades (nervous twitching)
const GAZE_DE_CROSS_BIAS = 0.12;  // Pushes eyes outward to cancel screen convergence

function extractGaze(landmarks, w, h) {
  // Check if iris landmarks exist (indices 468-477)
  if (landmarks.length < 474) return null;

  const leftIris = get2D(landmarks, FACE.LEFT_IRIS_CENTER, w, h);
  const leftInner = get2D(landmarks, FACE.LEFT_EYE_INNER, w, h);
  const leftOuter = get2D(landmarks, FACE.LEFT_EYE_OUTER_CORNER, w, h);

  const rightIris = get2D(landmarks, FACE.RIGHT_IRIS_CENTER, w, h);
  const rightInner = get2D(landmarks, FACE.RIGHT_EYE_INNER, w, h);
  const rightOuter = get2D(landmarks, FACE.RIGHT_EYE_OUTER_CORNER, w, h);

  // --- Left Eye ---
  const leftEyeW = dist2D(leftInner, leftOuter) || 1;
  const leftCenterX = (leftInner.x + leftOuter.x) / 2;
  const leftCenterY = (leftInner.y + leftOuter.y) / 2;
  
  // Normalize by eye width for both axes to maintain aspect ratio
  let leftX = ((leftIris.x - leftCenterX) / leftEyeW) * 2.0;
  let leftY = ((leftIris.y - leftCenterY) / leftEyeW) * 2.0;

  // --- Right Eye ---
  const rightEyeW = dist2D(rightInner, rightOuter) || 1;
  const rightCenterX = (rightInner.x + rightOuter.x) / 2;
  const rightCenterY = (rightInner.y + rightOuter.y) / 2;

  let rightX = ((rightIris.x - rightCenterX) / rightEyeW) * 2.0;
  let rightY = ((rightIris.y - rightCenterY) / rightEyeW) * 2.0;

  // --- 1. Apply Dead Zone (stops nervous eye micro-vibrations) ---
  if (Math.abs(leftX) < GAZE_DEAD_ZONE) leftX = 0;
  if (Math.abs(leftY) < GAZE_DEAD_ZONE) leftY = 0;
  if (Math.abs(rightX) < GAZE_DEAD_ZONE) rightX = 0;
  if (Math.abs(rightY) < GAZE_DEAD_ZONE) rightY = 0;

  // --- 2. Apply De-Crossing Bias ---
  // When looking at a phone screen, eyes naturally converge inward.
  // We push the gaze values OUTWARD to compensate and make the avatar look straight ahead.
  leftX  -= GAZE_DE_CROSS_BIAS;
  rightX += GAZE_DE_CROSS_BIAS;

  // --- 3. Final Clamp to anatomical limits ---
  leftX = Math.max(-1, Math.min(1, leftX));
  leftY = Math.max(-1, Math.min(1, leftY));
  rightX = Math.max(-1, Math.min(1, rightX));
  rightY = Math.max(-1, Math.min(1, rightY));

  return { leftX, leftY, rightX, rightY };
}

export function extractBlendshapes(bsData) {
  const map = {};
  if (bsData.categories) {
    for (const cat of bsData.categories) {
      map[cat.categoryName] = cat.score;
    }
  }
  return map;
}