import { POSE } from "./constants.js";

function getVis(lm) {
  if (typeof lm.visibility === "number") return lm.visibility;
  if (typeof lm.presence === "number") return lm.presence;
  return 1.0;
}

function angle3d(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const magBA = Math.hypot(ba.x, ba.y, ba.z) || 1;
  const magBC = Math.hypot(bc.x, bc.y, bc.z) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
}

function dir(a, b) {
  return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
}

function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function computeRotations(j, hasArms, hasLegs) {
  const rot = {};

  if (hasArms.left) {
    rot.leftElbowAngle = angle3d(j.leftShoulder, j.leftElbow, j.leftWrist);
    rot.leftUpperArmDir = dir(j.leftShoulder, j.leftElbow);
    rot.leftLowerArmDir = dir(j.leftElbow, j.leftWrist);
  }
  if (hasArms.right) {
    rot.rightElbowAngle = angle3d(j.rightShoulder, j.rightElbow, j.rightWrist);
    rot.rightUpperArmDir = dir(j.rightShoulder, j.rightElbow);
    rot.rightLowerArmDir = dir(j.rightElbow, j.rightWrist);
  }
  if (hasLegs.left) {
    rot.leftKneeAngle = angle3d(j.leftHip, j.leftKnee, j.leftAnkle);
    rot.leftUpperLegDir = dir(j.leftHip, j.leftKnee);
    rot.leftLowerLegDir = dir(j.leftKnee, j.leftAnkle);
  }
  if (hasLegs.right) {
    rot.rightKneeAngle = angle3d(j.rightHip, j.rightKnee, j.rightAnkle);
    rot.rightUpperLegDir = dir(j.rightHip, j.rightKnee);
    rot.rightLowerLegDir = dir(j.rightKnee, j.rightAnkle);
  }

  return rot;
}

function computeTorso(j) {
  const sMid = {
    x: (j.leftShoulder.x + j.rightShoulder.x) / 2,
    y: (j.leftShoulder.y + j.rightShoulder.y) / 2,
    z: (j.leftShoulder.z + j.rightShoulder.z) / 2,
  };
  const hMid = {
    x: (j.leftHip.x + j.rightHip.x) / 2,
    y: (j.leftHip.y + j.rightHip.y) / 2,
    z: (j.leftHip.z + j.rightHip.z) / 2,
  };

  const sd = normalize(dir(hMid, sMid));

  const lat = normalize(dir(j.rightShoulder, j.leftShoulder));

  return {
    yaw: Math.atan2(lat.z, lat.x),
    pitch: Math.asin(Math.max(-1, Math.min(1, sd.z))),
    roll: Math.asin(Math.max(-1, Math.min(1, -sd.x))),
  };
}

function computeHipRotation(j) {
  const hipLat = normalize(dir(j.rightHip, j.leftHip));
  const hipYaw = Math.atan2(hipLat.z, hipLat.x);

  // Hip tilt from difference in hip heights
  const hipRoll = Math.atan2(j.leftHip.y - j.rightHip.y, Math.hypot(j.leftHip.x - j.rightHip.x, j.leftHip.z - j.rightHip.z) || 1);

  // Forward lean from spine direction
  const sMid = {
    x: (j.leftShoulder.x + j.rightShoulder.x) / 2,
    y: (j.leftShoulder.y + j.rightShoulder.y) / 2,
    z: (j.leftShoulder.z + j.rightShoulder.z) / 2,
  };
  const hMid = {
    x: (j.leftHip.x + j.rightHip.x) / 2,
    y: (j.leftHip.y + j.rightHip.y) / 2,
    z: (j.leftHip.z + j.rightHip.z) / 2,
  };
  const spineDir = normalize(dir(hMid, sMid));
  const hipPitch = Math.asin(Math.max(-1, Math.min(1, spineDir.z)));

  return { yaw: hipYaw, pitch: hipPitch, roll: hipRoll };
}

// ============================================================
// Detect body mode from landmark visibility
// ============================================================

function detectMode(j2, mv) {
  const hasSh = j2.leftShoulder.visibility > mv && j2.rightShoulder.visibility > mv;
  const hasHips = j2.leftHip.visibility > mv && j2.rightHip.visibility > mv;
  const hasKnees = j2.leftKnee.visibility > mv && j2.rightKnee.visibility > mv;
  const hasAnkles = j2.leftAnkle.visibility > mv && j2.rightAnkle.visibility > mv;

  if (hasSh && hasHips && hasKnees && hasAnkles) return "full";
  if (hasSh && hasHips && hasKnees) return "seated";
  if (hasSh && hasHips) return "upper";
  if (hasSh) return "head";
  return "none";
}

// ============================================================
// Main extraction
// ============================================================

export function extractFullBody(poseLandmarks, poseWorldLandmarks, video, visThreshold) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const useWorld = !!poseWorldLandmarks;
  const mv = visThreshold;

  const get2d = (idx) => {
    const lm = poseLandmarks[idx];
    return { x: lm.x * w, y: lm.y * h, visibility: getVis(lm) };
  };

  const get3d = (idx) => {
    const src = useWorld ? poseWorldLandmarks[idx] : poseLandmarks[idx];
    return { x: src.x, y: src.y, z: src.z };
  };

  // 2D
  const j2keys = {
    nose: POSE.NOSE,
    leftShoulder: POSE.LEFT_SHOULDER, rightShoulder: POSE.RIGHT_SHOULDER,
    leftElbow: POSE.LEFT_ELBOW, rightElbow: POSE.RIGHT_ELBOW,
    leftWrist: POSE.LEFT_WRIST, rightWrist: POSE.RIGHT_WRIST,
    leftHip: POSE.LEFT_HIP, rightHip: POSE.RIGHT_HIP,
    leftKnee: POSE.LEFT_KNEE, rightKnee: POSE.RIGHT_KNEE,
    leftAnkle: POSE.LEFT_ANKLE, rightAnkle: POSE.RIGHT_ANKLE,
    leftIndex: POSE.LEFT_INDEX, rightIndex: POSE.RIGHT_INDEX,
  };
  const j2 = {};
  for (const [name, idx] of Object.entries(j2keys)) j2[name] = get2d(idx);

  // 3D
  const j3keys = {
    nose: POSE.NOSE,
    leftShoulder: POSE.LEFT_SHOULDER, rightShoulder: POSE.RIGHT_SHOULDER,
    leftElbow: POSE.LEFT_ELBOW, rightElbow: POSE.RIGHT_ELBOW,
    leftWrist: POSE.LEFT_WRIST, rightWrist: POSE.RIGHT_WRIST,
    leftHip: POSE.LEFT_HIP, rightHip: POSE.RIGHT_HIP,
    leftKnee: POSE.LEFT_KNEE, rightKnee: POSE.RIGHT_KNEE,
    leftAnkle: POSE.LEFT_ANKLE, rightAnkle: POSE.RIGHT_ANKLE,
  };
  const j3 = {};
  for (const [name, idx] of Object.entries(j3keys)) j3[name] = get3d(idx);

  // Detect mode
  const mode = detectMode(j2, mv);

  // Shoulder metrics
  const ls = j2.leftShoulder, rs = j2.rightShoulder;
  const sdx = ls.x - rs.x, sdy = ls.y - rs.y;
  const shoulderWidth = Math.hypot(sdx, sdy);
  const shoulderTilt = Math.atan2(sdy, sdx);
  const shoulderMidX = (ls.x + rs.x) / 2;
  const shoulderMidY = (ls.y + rs.y) / 2;

  // Hip metrics
  const lh = j2.leftHip, rh = j2.rightHip;
  const hipTilt = Math.atan2(lh.y - rh.y, lh.x - rh.x);

  // Per-limb visibility
  const hasShoulders = ls.visibility > mv && rs.visibility > mv;
  const hasHips = lh.visibility > mv && rh.visibility > mv;

  const hasLeftArm = ls.visibility > mv && j2.leftElbow.visibility > mv && j2.leftWrist.visibility > mv;
  const hasRightArm = rs.visibility > mv && j2.rightElbow.visibility > mv && j2.rightWrist.visibility > mv;
  const hasLeftLeg = lh.visibility > mv && j2.leftKnee.visibility > mv && j2.leftAnkle.visibility > mv;
  const hasRightLeg = rh.visibility > mv && j2.rightKnee.visibility > mv && j2.rightAnkle.visibility > mv;

  // Compute rotations only for visible limbs
  const rotations = computeRotations(
    j3,
    { left: hasLeftArm, right: hasRightArm },
    { left: hasLeftLeg, right: hasRightLeg }
  );

  // Torso
  const torso = hasShoulders && hasHips ? computeTorso(j3) : null;

  // Hip rotation (for full/seated modes)
  const hipRotation = hasHips ? computeHipRotation(j3) : null;

  return {
      joints2d: j2,
      joints3d: j3,
      rotations,
      torso,
      hipRotation,
      mode,

      leftShoulder: ls, rightShoulder: rs,
      shoulderMidX, shoulderMidY,
      shoulderMidXNorm: shoulderMidX / w,
      shoulderMidYNorm: shoulderMidY / h,
      shoulderWidth, shoulderWidthNorm: shoulderWidth / w,
      shoulderTilt, hipTilt,

      hasShoulders, hasHips,
      hasLeftArm, hasRightArm,
      hasLeftLeg, hasRightLeg,

      worldSpace: useWorld,
      synthesized: false,
      // NEW: Include raw landmarks array for ROI cascade
      landmarks: poseLandmarks,
      poseLandmarks: poseLandmarks
    };
}