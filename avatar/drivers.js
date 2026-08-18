import * as THREE from "three";
import { LIMB_CHAINS, FINGER_BONES, _v3a, _v3c, _qa, _qb, _euler } from "./constants.js";

export function lerpBone(bone, axis, target, alpha) {
  if (!bone) return;
  bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], target, alpha);
}

// ============================================================
// Global sign controls for webcam-mirrored setups
// If motion still feels wrong, change only these.
// ============================================================
const HEAD_SIGNS = {
  yaw: -1,
  pitch: 1,
  roll: -1,
};

const EYE_SIGNS = {
  x: 1,   // vertical
  y: 1,   // horizontal
};

// ======================== Head ========================

export function driveHead(bones, state, neckHeadSplit, alpha) {
  const yaw = state.yaw * HEAD_SIGNS.yaw;
  const pitch = state.pitch * HEAD_SIGNS.pitch;
  const roll = state.roll * HEAD_SIGNS.roll;

  const nf = neckHeadSplit;
  const hf = 1 - nf;

  lerpBone(bones.head, "y", yaw * hf, alpha);
  lerpBone(bones.head, "x", pitch * hf, alpha);
  lerpBone(bones.head, "z", roll * hf, alpha);

  lerpBone(bones.neck, "y", yaw * nf, alpha);
  lerpBone(bones.neck, "x", pitch * nf, alpha);
  lerpBone(bones.neck, "z", roll * nf, alpha);
}

// ======================== Eyes ========================

const MAX_EYE_ANGLE = 0.4;

export function driveEyes(bones, gaze, alpha) {
  if (!gaze) return;

  if (bones.leftEye) {
    bones.leftEye.rotation.x = THREE.MathUtils.lerp(
      bones.leftEye.rotation.x,
      (-gaze.leftY * MAX_EYE_ANGLE) * EYE_SIGNS.x,
      alpha
    );
    bones.leftEye.rotation.y = THREE.MathUtils.lerp(
      bones.leftEye.rotation.y,
      (gaze.leftX * MAX_EYE_ANGLE) * EYE_SIGNS.y,
      alpha
    );
  }

  if (bones.rightEye) {
    bones.rightEye.rotation.x = THREE.MathUtils.lerp(
      bones.rightEye.rotation.x,
      (-gaze.rightY * MAX_EYE_ANGLE) * EYE_SIGNS.x,
      alpha
    );
    bones.rightEye.rotation.y = THREE.MathUtils.lerp(
      bones.rightEye.rotation.y,
      (gaze.rightX * MAX_EYE_ANGLE) * EYE_SIGNS.y,
      alpha
    );
  }
}

// ======================== Torso ========================

export function driveTorso(bones, torso, shoulderTilt, alpha) {
  if (!torso) return;

  const chain = [
    [bones.spine, 0.3],
    [bones.chest, 0.3],
    [bones.upperChest, 0.4],
  ];

  for (const [bone, w] of chain) {
    if (!bone) continue;
    lerpBone(bone, "y", THREE.MathUtils.clamp(torso.yaw * w, -0.8, 0.8), alpha);
    lerpBone(bone, "x", THREE.MathUtils.clamp(torso.pitch * w, -0.5, 0.5), alpha);
    lerpBone(bone, "z", THREE.MathUtils.clamp(-shoulderTilt * w, -0.4, 0.4), alpha);
  }
}

// ======================== Hips ========================

export function driveHips(bones, hipRotation, mode, alpha) {
  if (!bones.hips || !hipRotation) return;

  const b = bones.hips;

  lerpBone(b, "y", THREE.MathUtils.clamp(hipRotation.yaw * 0.5, -0.6, 0.6), alpha);
  lerpBone(b, "z", THREE.MathUtils.clamp(-hipRotation.roll * 0.5, -0.3, 0.3), alpha);

  if (mode === "full") {
    lerpBone(b, "x", THREE.MathUtils.clamp(hipRotation.pitch * 0.3, -0.4, 0.4), alpha);
  }
}

// ======================== Limbs ========================

function mpToVRM(p) {
  return _v3a.set(p.x, -p.y, -p.z);
}

export function driveLimbs(vrm, bones, rest, body, alpha, debugLog) {
  if (!body?.joints3d || !rest || !vrm) return;

  vrm.scene.updateMatrixWorld(true);
  const j = body.joints3d;

  const vis = {
    leftUpperArm: body.hasLeftArm,
    leftLowerArm: body.hasLeftArm,
    rightUpperArm: body.hasRightArm,
    rightLowerArm: body.hasRightArm,
    leftUpperLeg: body.hasLeftLeg,
    leftLowerLeg: body.hasLeftLeg,
    rightUpperLeg: body.hasRightLeg,
    rightLowerLeg: body.hasRightLeg,
  };

  let applied = 0;

  for (const chain of LIMB_CHAINS) {
    if (!vis[chain.bone]) continue;

    const bone = bones[chain.bone];
    const r = rest[chain.bone];
    if (!bone || !r) continue;

    const pa = j[chain.mp[0]];
    const pb = j[chain.mp[1]];
    if (!pa || !pb) continue;

    const worldA = mpToVRM(pa).clone();
    const worldB = mpToVRM(pb);
    const target = _v3c.copy(worldB).sub(worldA);

    if (target.lengthSq() < 1e-8) continue;
    target.normalize();

    _qa.setFromUnitVectors(r.dir, target);
    _qb.copy(r.quat);
    _qa.multiply(_qb);

    bone.parent.getWorldQuaternion(_qb);
    _qb.invert().multiply(_qa);

    if (debugLog && (chain.bone === "leftUpperArm" || chain.bone === "rightUpperArm")) {
      _euler.setFromQuaternion(_qb);
      console.log(
        `  ${chain.bone}: t(${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)})` +
        ` e°(${(_euler.x * 57.3).toFixed(0)},${(_euler.y * 57.3).toFixed(0)},${(_euler.z * 57.3).toFixed(0)})`
      );
    }

    bone.quaternion.slerp(_qb, alpha);
    applied++;
  }

  if (debugLog) console.log(`[Limbs] applied:${applied} mode:${body.mode}`);
}

// ======================== Fingers ========================

const FINGER_MAX_ANGLES = {
  regular: [Math.PI * 0.5, Math.PI * 0.55, Math.PI * 0.45],
  thumb: [Math.PI * 0.35, Math.PI * 0.4, Math.PI * 0.3],
};

function curlCurve(curl) {
  return Math.pow(curl, 0.7);
}

let _fingerLogCount = 0;

export function driveFingers(bones, hands, alpha) {
  if (!hands) return;

  const shouldLog = _fingerLogCount < 3;

  for (const side of ["left", "right"]) {
    const hand = hands[side];
    if (!hand) continue;

    const fingerMap = FINGER_BONES[side];
    if (!fingerMap) continue;

    if (shouldLog) {
      console.log(
        `[Fingers] ${side}:`,
        Object.entries(hand.fingers).map(([k, v]) => `${k}:${v.curl.toFixed(2)}`).join(" ")
      );
    }

    for (const [fingerName, boneNames] of Object.entries(fingerMap)) {
      const finger = hand.fingers[fingerName];
      if (!finger) continue;

      const isThumb = fingerName === "thumb";
      const maxAngles = isThumb ? FINGER_MAX_ANGLES.thumb : FINGER_MAX_ANGLES.regular;
      const adjustedCurl = curlCurve(finger.curl);

      for (let i = 0; i < 3; i++) {
        const bone = bones[boneNames[i]];
        if (!bone) continue;

        const targetAngle = adjustedCurl * maxAngles[i];

        if (isThumb) {
          if (i === 0) {
            lerpBone(bone, "z", targetAngle * 0.8, alpha);
            lerpBone(bone, "x", targetAngle * 0.2, alpha);
          } else {
            lerpBone(bone, "z", targetAngle * 0.3, alpha);
            lerpBone(bone, "x", targetAngle * 0.7, alpha);
          }
        } else {
          lerpBone(bone, "x", targetAngle, alpha);

          if (i === 0) {
            const spreadAngle = (1 - adjustedCurl) * 0.1;
            if (fingerName === "index") {
              lerpBone(bone, "z", -spreadAngle, alpha);
            } else if (fingerName === "pinky") {
              lerpBone(bone, "z", spreadAngle, alpha);
            }
          }
        }
      }
    }

    if (shouldLog) _fingerLogCount++;
  }
}