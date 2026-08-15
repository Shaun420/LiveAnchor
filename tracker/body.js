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

function computeRotations(j) {
  return {
    leftElbowAngle: angle3d(j.leftShoulder, j.leftElbow, j.leftWrist),
    rightElbowAngle: angle3d(j.rightShoulder, j.rightElbow, j.rightWrist),
    leftKneeAngle: angle3d(j.leftHip, j.leftKnee, j.leftAnkle),
    rightKneeAngle: angle3d(j.rightHip, j.rightKnee, j.rightAnkle),
    leftUpperArmDir: dir(j.leftShoulder, j.leftElbow),
    leftLowerArmDir: dir(j.leftElbow, j.leftWrist),
    rightUpperArmDir: dir(j.rightShoulder, j.rightElbow),
    rightLowerArmDir: dir(j.rightElbow, j.rightWrist),
    leftUpperLegDir: dir(j.leftHip, j.leftKnee),
    leftLowerLegDir: dir(j.leftKnee, j.leftAnkle),
    rightUpperLegDir: dir(j.rightHip, j.rightKnee),
    rightLowerLegDir: dir(j.rightKnee, j.rightAnkle),
  };
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

  const sd = dir(hMid, sMid);
  const sl = Math.hypot(sd.x, sd.y, sd.z) || 1;
  sd.x /= sl; sd.y /= sl; sd.z /= sl;

  const lat = dir(j.rightShoulder, j.leftShoulder);
  const ll = Math.hypot(lat.x, lat.y, lat.z) || 1;
  lat.x /= ll; lat.y /= ll; lat.z /= ll;

  return {
    yaw: Math.atan2(lat.z, lat.x),
    pitch: Math.asin(Math.max(-1, Math.min(1, sd.z))),
    roll: Math.asin(Math.max(-1, Math.min(1, -sd.x))),
  };
}

export function extractFullBody(poseLandmarks, poseWorldLandmarks, video, visThreshold) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const useWorld = !!poseWorldLandmarks;

  const get2d = (idx) => {
    const lm = poseLandmarks[idx];
    return { x: lm.x * w, y: lm.y * h, visibility: getVis(lm) };
  };

  const get3d = (idx) => {
    const src = useWorld ? poseWorldLandmarks[idx] : poseLandmarks[idx];
    return { x: src.x, y: src.y, z: src.z };
  };

  // 2D joints
  const j2 = {};
  const j2map = {
    nose: POSE.NOSE,
    leftShoulder: POSE.LEFT_SHOULDER, rightShoulder: POSE.RIGHT_SHOULDER,
    leftElbow: POSE.LEFT_ELBOW, rightElbow: POSE.RIGHT_ELBOW,
    leftWrist: POSE.LEFT_WRIST, rightWrist: POSE.RIGHT_WRIST,
    leftHip: POSE.LEFT_HIP, rightHip: POSE.RIGHT_HIP,
    leftKnee: POSE.LEFT_KNEE, rightKnee: POSE.RIGHT_KNEE,
    leftAnkle: POSE.LEFT_ANKLE, rightAnkle: POSE.RIGHT_ANKLE,
    leftIndex: POSE.LEFT_INDEX, rightIndex: POSE.RIGHT_INDEX,
  };
  for (const [name, idx] of Object.entries(j2map)) j2[name] = get2d(idx);

  // 3D joints
  const j3 = {};
  const j3map = {
    nose: POSE.NOSE,
    leftShoulder: POSE.LEFT_SHOULDER, rightShoulder: POSE.RIGHT_SHOULDER,
    leftElbow: POSE.LEFT_ELBOW, rightElbow: POSE.RIGHT_ELBOW,
    leftWrist: POSE.LEFT_WRIST, rightWrist: POSE.RIGHT_WRIST,
    leftHip: POSE.LEFT_HIP, rightHip: POSE.RIGHT_HIP,
    leftKnee: POSE.LEFT_KNEE, rightKnee: POSE.RIGHT_KNEE,
    leftAnkle: POSE.LEFT_ANKLE, rightAnkle: POSE.RIGHT_ANKLE,
  };
  for (const [name, idx] of Object.entries(j3map)) j3[name] = get3d(idx);

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

  // Visibility
  const mv = visThreshold;
  const hasShoulders = ls.visibility > mv && rs.visibility > mv;
  const hasLeftArm = ls.visibility > mv && j2.leftElbow.visibility > mv && j2.leftWrist.visibility > mv;
  const hasRightArm = rs.visibility > mv && j2.rightElbow.visibility > mv && j2.rightWrist.visibility > mv;
  const hasLeftLeg = lh.visibility > mv && j2.leftKnee.visibility > mv && j2.leftAnkle.visibility > mv;
  const hasRightLeg = rh.visibility > mv && j2.rightKnee.visibility > mv && j2.rightAnkle.visibility > mv;

  return {
    joints2d: j2,
    joints3d: j3,
    rotations: computeRotations(j3),
    torso: computeTorso(j3),
    leftShoulder: ls, rightShoulder: rs,
    shoulderMidX, shoulderMidY,
    shoulderMidXNorm: shoulderMidX / w,
    shoulderMidYNorm: shoulderMidY / h,
    shoulderWidth,
    shoulderWidthNorm: shoulderWidth / w,
    shoulderTilt, hipTilt,
    hasShoulders, hasLeftArm, hasRightArm, hasLeftLeg, hasRightLeg,
    worldSpace: useWorld,
    synthesized: false,
  };
}

export function logRawPose(poseLandmarks, poseWorldLandmarks) {
  console.log("=== RAW POSE ===");
  console.log("Count:", poseLandmarks.length, "| World:", !!poseWorldLandmarks);

  const keys = { NOSE: 0, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16, L_HI: 23, R_HI: 24 };
  for (const [name, idx] of Object.entries(keys)) {
    const lm = poseLandmarks[idx];
    console.log(`${name}[${idx}]: (${lm.x?.toFixed(3)},${lm.y?.toFixed(3)},${lm.z?.toFixed(3)}) vis:${lm.visibility} keys:[${Object.keys(lm)}]`);
  }
  console.log("================");
}