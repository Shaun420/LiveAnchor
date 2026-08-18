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
// Returns { leftX, leftY, rightX, rightY } in range [-1, 1]
// where (0,0) = looking straight, (-1,0) = looking left, (0,-1) = looking down
// ============================================================

function extractGaze(landmarks, w, h) {
  // Check if iris landmarks exist (indices 468-477)
  if (landmarks.length < 474) return null;

  const leftIris = get2D(landmarks, FACE.LEFT_IRIS_CENTER, w, h);
  const leftInner = get2D(landmarks, FACE.LEFT_EYE_INNER, w, h);
  const leftOuter = get2D(landmarks, FACE.LEFT_EYE_OUTER_CORNER, w, h);
  const leftTop = get2D(landmarks, FACE.LEFT_EYE_TOP, w, h);
  const leftBottom = get2D(landmarks, FACE.LEFT_EYE_BOTTOM, w, h);

  const rightIris = get2D(landmarks, FACE.RIGHT_IRIS_CENTER, w, h);
  const rightInner = get2D(landmarks, FACE.RIGHT_EYE_INNER, w, h);
  const rightOuter = get2D(landmarks, FACE.RIGHT_EYE_OUTER_CORNER, w, h);
  const rightTop = get2D(landmarks, FACE.RIGHT_EYE_TOP, w, h);
  const rightBottom = get2D(landmarks, FACE.RIGHT_EYE_BOTTOM, w, h);

  // Left eye: iris position relative to eye bounds
  const leftEyeW = dist2D(leftInner, leftOuter) || 1;
  const leftEyeH = dist2D(leftTop, leftBottom) || 1;
  const leftCenterX = (leftInner.x + leftOuter.x) / 2;
  const leftCenterY = (leftTop.y + leftBottom.y) / 2;
  const leftX = ((leftIris.x - leftCenterX) / (leftEyeW * 0.5)) * 2;
  const leftY = ((leftIris.y - leftCenterY) / (leftEyeH * 0.5)) * 2;

  // Right eye
  const rightEyeW = dist2D(rightInner, rightOuter) || 1;
  const rightEyeH = dist2D(rightTop, rightBottom) || 1;
  const rightCenterX = (rightInner.x + rightOuter.x) / 2;
  const rightCenterY = (rightTop.y + rightBottom.y) / 2;
  const rightX = ((rightIris.x - rightCenterX) / (rightEyeW * 0.5)) * 2;
  const rightY = ((rightIris.y - rightCenterY) / (rightEyeH * 0.5)) * 2;

  return {
    leftX: Math.max(-1, Math.min(1, leftX)),
    leftY: Math.max(-1, Math.min(1, leftY)),
    rightX: Math.max(-1, Math.min(1, rightX)),
    rightY: Math.max(-1, Math.min(1, rightY)),
  };
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