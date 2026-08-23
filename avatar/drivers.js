import * as THREE from "three";
import { LIMB_CHAINS, FINGER_BONES, _v3a, _v3c, _qa, _qb, _euler } from "./constants.js";

/**
 * Utility helper to smoothly interpolate a single rotation axis (fine for 1-DoF joints like fingers)
 */
export function lerpBone(bone, axis, target, alpha) {
  if (!bone) return;
  bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], target, alpha);
}

// ============================================================
// Global Sign Configurations
// ============================================================
const HEAD_SIGNS = {
  yaw: -1,
  pitch: 1,
  roll: -1,
};

const EYE_SIGNS = {
  x: 1,  // Pitch (vertical)
  y: 1,  // Yaw (horizontal)
};

// ======================== Head & Neck (Quaternion-Based) ========================

export function driveHead(bones, state, neckHeadSplit, alpha) {
  if (!bones.head) return;

  const yaw = state.yaw * HEAD_SIGNS.yaw;
  const pitch = state.pitch * HEAD_SIGNS.pitch;
  const roll = state.roll * HEAD_SIGNS.roll;

  const nf = neckHeadSplit;
  const hf = 1 - nf;

  // 1. Solve Head Rotation (using YXZ Euler order to prevent gimbal locks)
  _euler.set(pitch * hf, yaw * hf, roll * hf, "YXZ");
  _qa.setFromEuler(_euler);
  bones.head.quaternion.slerp(_qa, alpha);

  // 2. Solve Neck Rotation
  if (bones.neck) {
    _euler.set(pitch * nf, yaw * nf, roll * nf, "YXZ");
    _qa.setFromEuler(_euler);
    bones.neck.quaternion.slerp(_qa, alpha);
  }
}

// ======================== Eye Gaze ========================

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

// ======================== Torso (Quaternion-Based) ========================

export function driveTorso(bones, torso, shoulderTilt, alpha) {
  if (!torso) return;

  // Map and distribute torso yaw/pitch/roll across the spine chain
  const yaw = -torso.yaw;
  const pitch = torso.pitch;
  const roll = -shoulderTilt;

  const chain = [
    { bone: bones.spine, weight: 0.3 },
    { bone: bones.chest, weight: 0.3 },
    { bone: bones.upperChest, weight: 0.4 },
  ];

  for (const { bone, weight } of chain) {
    if (!bone) continue;

    const ty = THREE.MathUtils.clamp(yaw * weight, -0.24, 0.24);
    const tx = THREE.MathUtils.clamp(pitch * weight, -0.15, 0.15);
    const tz = THREE.MathUtils.clamp(roll * weight, -0.12, 0.12);

    _euler.set(tx, ty, tz, "YXZ");
    _qa.setFromEuler(_euler);
    bone.quaternion.slerp(_qa, alpha);
  }
}

// ======================== Hips (Quaternion-Based) ========================

export function driveHips(bones, hipRotation, mode, alpha) {
  if (!bones.hips || !hipRotation) return;

  const yaw = -hipRotation.yaw * 0.5;
  const roll = -hipRotation.roll * 0.5;
  const pitch = mode === "full" ? hipRotation.pitch * 0.3 : 0;

  // Apply absolute hips rotation safely
  _euler.set(pitch, yaw, roll, "YXZ");
  _qa.setFromEuler(_euler);
  bones.hips.quaternion.slerp(_qa, alpha);
}

// ======================== Limbs (Arms & Legs) ========================

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

    bone.quaternion.slerp(_qb, alpha);
    applied++;
  }

  if (debugLog) console.log(`[Limbs] applied:${applied}`);
}

// ======================== Fingers & Wrists ========================

const MAX_FINGER_CURL = 1.5; // Max finger bend
const FINGER_CURL_WEIGHTS = [0.45, 0.35, 0.20]; // Proximal, intermediate, distal distribution

export function driveFingers(vrm, bones, rest, hands, alpha) {
  if (!hands) return;

  vrm.scene.updateMatrixWorld(true);

  for (const side of ["left", "right"]) {
    const hand = hands[side];
    if (!hand) continue;

    const isLeft = side === "left";

    // ── 1. Rotate the Wrist (Hand Bone) ──
    const handBone = bones[`${side}Hand`];
    const r = rest ? rest[`${side}Hand`] : null;

    if (handBone && r && hand.handForward && hand.palmNormal) {
      const tFwd = mpToVRM(hand.handForward).clone().normalize();
      const tNorm = mpToVRM(hand.palmNormal).clone().normalize();

      // Orthonormal basis reconstruction
      const tBinormal = new THREE.Vector3().crossVectors(tFwd, tNorm).normalize();
      const tNormOrtho = new THREE.Vector3().crossVectors(tBinormal, tFwd).normalize();

      const M_rest = new THREE.Matrix4().makeBasis(r.binormal, r.norm, r.fwd);
      const M_tracked = new THREE.Matrix4().makeBasis(tBinormal, tNormOrtho, tFwd);

      const M_delta = M_tracked.clone().multiply(M_rest.invert());
      const Q_delta = new THREE.Quaternion().setFromRotationMatrix(M_delta);

      const desiredWorld = Q_delta.multiply(r.quat.clone());
      const parentWorld = new THREE.Quaternion();
      handBone.parent.getWorldQuaternion(parentWorld);
      const localTarget = parentWorld.invert().multiply(desiredWorld);

      handBone.quaternion.slerp(localTarget, alpha);
    }

    // ── 2. Curl Fingers (Standard Humanoid Z-Axis Flexion) ──
    const fingerMap = FINGER_BONES[side];
    if (!fingerMap) continue;

    for (const [fingerName, boneNames] of Object.entries(fingerMap)) {
      const finger = hand.fingers[fingerName];
      if (!finger) continue;

      const curl = Math.pow(finger.curl, 0.75); // Apply curve to make slight movements look responsive

      for (let i = 0; i < 3; i++) {
        const bone = bones[boneNames[i]];
        if (!bone) continue;

        if (fingerName === "thumb") {
          // Thumb opposition and flexion (blends Z and Y axes)
          const thumbAngle = curl * 0.7;
          const sign = isLeft ? 1 : -1;
          lerpBone(bone, "y", thumbAngle * 0.5 * sign, alpha);
          lerpBone(bone, "z", -thumbAngle * 0.7 * sign, alpha);
        } else {
          // Normal fingers flex exclusively along the Z-axis in standard Humanoid bone space.
          // Left hand bends with -Z, Right hand bends with +Z.
          const sign = isLeft ? -1 : 1;
          const targetAngle = curl * MAX_FINGER_CURL * (FINGER_CURL_WEIGHTS[i] / FINGER_CURL_WEIGHTS[0]) * sign;
          lerpBone(bone, "z", targetAngle, alpha);
        }
      }
    }
  }
}