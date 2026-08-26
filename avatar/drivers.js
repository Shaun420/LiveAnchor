import * as THREE from "three";
import { LIMB_CHAINS, FINGER_BONES, _v3a, _v3c, _qa, _qb, _euler } from "./constants.js";

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

const MAX_EYE_YAW   = 0.26; // ~15° horizontal
const MAX_EYE_PITCH = 0.17; // ~10° vertical

// ============================================================
// Finger Joint Limits (radians)
// ============================================================
const FINGER_JOINT_LIMITS = {
  proximal:     1.55,  // ~89° MCP
  intermediate: 1.85,  // ~106° PIP (bends most)
  distal:       0.85,  // ~49° DIP
};

// ============================================================
// Baked Hand Basis (from miku_skeleton.json)
// These are pre-computed orthonormal bases for each hand,
// eliminating per-frame matrix computation and fixing sign bugs.
// Format: { fwd: [x,y,z], norm: [x,y,z], binormal: [x,y,z] }
// worldQuat is a 4-element array (x,y,z,w) in WXYZ order
// ============================================================
const BAKED_HAND_BASIS = {
  left: {
    fwd:      [0.993, -0.032, 0.115],
    norm:     [0.115,  0.010, -0.993],
    binormal: [0.031,  0.999,  0.014],
    worldQuat: [0.7142, 0, 0, -0.6999]  // WXYZ order from rest_quat_local
  },
  right: {
    fwd:      [-0.9998, 0.0203, 0.0],
    norm:     [0.115,  0.010, -0.993],
    binormal: [-0.031,  0.999,  0.014],
    worldQuat: [0.7142, 0, 0, +0.6999]
  }
};

// ============================================================
// Utility helper to smoothly interpolate a single rotation axis (fine for 1-DoF joints like fingers)
// ============================================================
export function lerpBone(bone, axis, target, alpha) {
  if (!bone) return;
  bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], target, alpha);
}

/**
 * Safely convert any vector-like input into a THREE.Vector3.
 * Handles: THREE.Vector3, array [x,y,z], or object {x,y,z}.
 */
function toVector3(v) {
  if (!v) return new THREE.Vector3();
  if (v.isVector3) return v.clone();
  if (Array.isArray(v)) return new THREE.Vector3(v[0], v[1], v[2]);
  return new THREE.Vector3(v.x ?? 0, v.y ?? 0, v.z ?? 0);
}

// ============================================================
// Head & Neck (Quaternion-Based)
// ============================================================

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

// ============================================================
// Eye Gaze
// ============================================================

// const MAX_EYE_ANGLE = 0.4;

export function driveEyes(bones, gaze, alpha) {
  if (!gaze) return;
  if (bones.leftEye) {
    bones.leftEye.rotation.x = THREE.MathUtils.lerp(bones.leftEye.rotation.x, (-gaze.leftY * MAX_EYE_PITCH) * EYE_SIGNS.x, alpha);
    bones.leftEye.rotation.y = THREE.MathUtils.lerp(bones.leftEye.rotation.y, ( gaze.leftX * MAX_EYE_YAW  ) * EYE_SIGNS.y, alpha);
  }
  if (bones.rightEye) {
    bones.rightEye.rotation.x = THREE.MathUtils.lerp(bones.rightEye.rotation.x, (-gaze.rightY * MAX_EYE_PITCH) * EYE_SIGNS.x, alpha);
    bones.rightEye.rotation.y = THREE.MathUtils.lerp(bones.rightEye.rotation.y, ( gaze.rightX * MAX_EYE_YAW  ) * EYE_SIGNS.y, alpha);
  }
}

// ============================================================
// Torso (Quaternion-Based)
// ============================================================

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

// ============================================================
// Hips (Quaternion-Based)
// ============================================================

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

// ============================================================
// Limbs (Arms & Legs)
// ============================================================

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

// ============================================================
// Fingers & Wrists
// ============================================================

const MAX_FINGER_CURL = 1.5; // Max finger bend
const FINGER_CURL_WEIGHTS = [0.45, 0.35, 0.20]; // Proximal, intermediate, distal distribution

export function driveFingers(vrm, bones, rest, hands, alpha) {
  if (!hands) return;

  vrm.scene.updateMatrixWorld(true);

  for (const side of ["left", "right"]) {
    const hand = hands[side];
    if (!hand) continue;

    const isLeft = side === "left";

    // ✅ FIX: Use BAKED hand basis from JSON (eliminates sign bug + per-frame computation)
    const bakedHand = BAKED_HAND_BASIS[side];

    const handBone = bones[`${side}Hand`];
    const r = rest ? rest[`${side}Hand`] : null;

    // ── 1. Wrist rotation using BAKED orthonormal basis ──
    if (handBone && bakedHand && hand.handForward && hand.palmNormal) {
      // ✅ FIX: Use toVector3() instead of the spread operator (...)
      const tFwd = toVector3(hand.handForward).normalize();
      const tNorm = toVector3(hand.palmNormal).normalize();

      const tBinormal = new THREE.Vector3().crossVectors(tFwd, tNorm).normalize();
      const tNormOrtho = new THREE.Vector3().crossVectors(tBinormal, tFwd).normalize();

      const rFwd = new THREE.Vector3(...bakedHand.fwd);
      const rNorm = new THREE.Vector3(...bakedHand.norm);
      const rBinormal = new THREE.Vector3(...bakedHand.binormal);

      const M_rest = new THREE.Matrix4().makeBasis(rBinormal, rNorm, rFwd);
      const M_tracked = new THREE.Matrix4().makeBasis(tBinormal, tNormOrtho, tFwd);

      const M_delta = M_tracked.clone().multiply(M_rest.invert());
      const Q_delta = new THREE.Quaternion().setFromRotationMatrix(M_delta);

      // Use baked worldQuat (WXYZ order from the JSON data)
      const restQuat = new THREE.Quaternion(
        bakedHand.worldQuat[1], bakedHand.worldQuat[2],
        bakedHand.worldQuat[3], bakedHand.worldQuat[0]
      );
      const desiredWorld = Q_delta.multiply(restQuat);

      const parentWorld = new THREE.Quaternion();
      handBone.parent.getWorldQuaternion(parentWorld);
      const localTarget = parentWorld.invert().multiply(desiredWorld);

      handBone.quaternion.slerp(localTarget, alpha);
    }

    // ── 2. Curl fingers with CORRECTED SIGNS ──
    const fingerMap = FINGER_BONES[side];
    if (!fingerMap) continue;

    // ✅ FIXED: Left hand curl sign = +1, Right hand curl sign = -1
    // This was swapped in the original code - your skeleton data confirms:
    // Left hand fingers curl toward +Z, Right hand fingers curl toward -Z
    const curlSign = isLeft ? 1 : -1;

    for (const [fingerName, boneNames] of Object.entries(fingerMap)) {
      const finger = hand.fingers[fingerName];
      if (!finger) continue;

      const curl = Math.pow(finger.curl, 0.75);

      for (let i = 0; i < 3; i++) {
        const bone = bones[boneNames[i]];
        if (!bone) continue;

        if (fingerName === "thumb") {
          const thumbAngle = curl * 0.9;
          const sign = isLeft ? 1 : -1;
          lerpBone(bone, "y", thumbAngle * 0.6 * -curlSign, alpha);
          lerpBone(bone, "z", thumbAngle * 0.5 * curlSign, alpha);
        } else {
          const jointNames = ["proximal", "intermediate", "distal"];
          const maxAngle = FINGER_JOINT_LIMITS[jointNames[i]];
          lerpBone(bone, "z", curl * maxAngle * curlSign, alpha);
        }
      }
    }
  }
}