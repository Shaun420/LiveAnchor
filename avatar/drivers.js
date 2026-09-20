import * as THREE from "three";
import {
  LIMB_CHAINS,
  FINGER_BONES,
  FINGER_JOINT_LIMITS,
  DIP_COUPLING,
  _v3a,
  _v3b,
  _v3c,
  _v3d,
  _qa,
  _qb,
  _qc,
  _euler,
  _m4a,
  _m4b,
} from "./constants.js";

const HEAD_SIGNS = { yaw: -1, pitch: 1, roll: -1 };
const EYE_SIGNS = { x: 1, y: 1 };
const MAX_EYE_YAW   = 0.26;
const MAX_EYE_PITCH = 0.17;

export function lerpBone(bone, axis, target, alpha) {
  if (!bone) return;
  bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], target, alpha);
}

function toVector3(v, out = _v3a) {
  if (!v) return out.set(0, 0, 0);
  if (v.isVector3) return out.copy(v);
  if (Array.isArray(v)) return out.set(v[0] || 0, v[1] || 0, v[2] || 0);
  return out.set(v.x ?? 0, v.y ?? 0, v.z ?? 0);
}

export function driveHead(bones, state, neckHeadSplit, alpha) {
  if (!bones.head) return;
  const yaw = state.yaw * HEAD_SIGNS.yaw;
  const pitch = state.pitch * HEAD_SIGNS.pitch;
  const roll = state.roll * HEAD_SIGNS.roll;

  const nf = neckHeadSplit;
  const hf = 1 - nf;

  _euler.set(pitch * hf, yaw * hf, roll * hf, "YXZ");
  _qa.setFromEuler(_euler);
  bones.head.quaternion.slerp(_qa, alpha);

  if (bones.neck) {
    _euler.set(pitch * nf, yaw * nf, roll * nf, "YXZ");
    _qa.setFromEuler(_euler);
    bones.neck.quaternion.slerp(_qa, alpha);
  }
}

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

export function driveTorso(bones, torso, shoulderTilt, alpha) {
  if (!torso) return;
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

export function driveHips(bones, hipRotation, mode, alpha) {
  if (!bones.hips || !hipRotation) return;
  const yaw = -hipRotation.yaw * 0.5;
  const roll = -hipRotation.roll * 0.5;
  const pitch = mode === "full" ? hipRotation.pitch * 0.3 : 0;

  _euler.set(pitch, yaw, roll, "YXZ");
  _qa.setFromEuler(_euler);
  bones.hips.quaternion.slerp(_qa, alpha);
}

function mpToVRM(p, out = _v3a) {
  return out.set(p.x, -p.y, -p.z);
}

export function driveLimbs(vrm, bones, rest, body, alpha, debugLog) {
  if (!body?.joints3d || !rest || !vrm) return;
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

    const worldA = mpToVRM(pa, _v3a).clone();
    const worldB = mpToVRM(pb, _v3b);
    const target = _v3c.copy(worldB).sub(worldA);
    if (target.lengthSq() < 1e-8) continue;
    target.normalize();

    _qa.setFromUnitVectors(r.dir, target);
    _qa.multiply(r.quat);

    bone.parent.getWorldQuaternion(_qb);
    _qb.invert().multiply(_qa);

    bone.quaternion.slerp(_qb, alpha);
    applied++;
  }
  if (debugLog) console.log(`[Limbs] applied:${applied}`);
}

export function driveFingers(vrm, bones, rest, hands, alpha) {
  if (!hands) return;

  for (const side of ["left", "right"]) {
    const hand = hands[side];
    if (!hand) continue;

    const isLeft = side === "left";
    const handBone = bones[`${side}Hand`];
    const handBasis = rest ? rest[`${side}HandBasis`] : null;

    // ── 1. Wrist Orientation via det=+1 Orthonormal Basis ──
    // Apply 180° rotation about X (x, -y, -z) to match Three.js coordinate alignment
    if (handBone && handBasis && hand.handForward && hand.palmNormal) {
      const rawFwd = toVector3(hand.handForward, _v3a);
      const rawNorm = toVector3(hand.palmNormal, _v3b);

      const tFwd = _v3a.set(rawFwd.x, -rawFwd.y, -rawFwd.z).normalize();
      const tNorm = _v3b.set(rawNorm.x, -rawNorm.y, -rawNorm.z).normalize();

      const tBinormal = _v3c.crossVectors(tNorm, tFwd).normalize();
      const tNormOrtho = _v3d.crossVectors(tFwd, tBinormal).normalize();

      _m4a.makeBasis(handBasis.b, handBasis.nO, handBasis.f);
      _m4b.makeBasis(tBinormal, tNormOrtho, tFwd);

      _m4b.multiply(_m4a.invert());
      _qa.setFromRotationMatrix(_m4b);

      const desiredWorld = _qa.multiply(handBasis.worldQuat);
      handBone.parent.getWorldQuaternion(_qb);
      const localTarget = _qb.invert().multiply(desiredWorld);

      handBone.quaternion.slerp(localTarget, alpha);
    }

    // ── 2. Fingers & 2-DoF Thumb Drive ──
    const fingerMap = FINGER_BONES[side];
    if (!fingerMap) continue;

    const curlSign = isLeft ? 1 : -1;

    for (const [fingerName, boneNames] of Object.entries(fingerMap)) {
      const finger = hand.fingers?.[fingerName];
      if (!finger) continue;

      if (fingerName === "thumb") {
        const metaBone = bones[boneNames[0]];
        const proxBone = bones[boneNames[1]];
        const distBone = bones[boneNames[2]];

        const restMeta = rest?.[boneNames[0]] || { x: 0, y: 0, z: 0 };
        const restProx = rest?.[boneNames[1]] || { x: 0, y: 0, z: 0 };
        const restDist = rest?.[boneNames[2]] || { x: 0, y: 0, z: 0 };

        // Opposition / Span drives Metacarpal Y
        const opposition = finger.opposition ?? 0.5;
        if (metaBone) {
          lerpBone(metaBone, "y", restMeta.y + opposition * 0.8 * -curlSign, alpha);
          lerpBone(metaBone, "z", restMeta.z + opposition * 0.3 * curlSign, alpha);
        }

        // Flexion drives Proximal / Distal Z
        const flex = finger.curl ?? 0;
        if (proxBone) {
          lerpBone(proxBone, "z", restProx.z + flex * 0.7 * curlSign, alpha);
        }
        if (distBone) {
          lerpBone(distBone, "z", restDist.z + flex * 0.9 * curlSign, alpha);
        }
      } else {
        const curl = Math.pow(finger.curl ?? 0, 0.75);
        const proxBone = bones[boneNames[0]];
        const intBone  = bones[boneNames[1]];
        const distBone = bones[boneNames[2]];

        const restProx = rest?.[boneNames[0]] || { x: 0, y: 0, z: 0 };
        const restInt  = rest?.[boneNames[1]] || { x: 0, y: 0, z: 0 };
        const restDist = rest?.[boneNames[2]] || { x: 0, y: 0, z: 0 };

        if (proxBone) {
          lerpBone(proxBone, "z", restProx.z + curl * FINGER_JOINT_LIMITS.proximal * curlSign, alpha);
        }
        if (intBone) {
          lerpBone(intBone, "z", restInt.z + curl * FINGER_JOINT_LIMITS.intermediate * curlSign, alpha);
        }
        if (distBone) {
          // Coupled DIP
          lerpBone(distBone, "z", restDist.z + curl * FINGER_JOINT_LIMITS.intermediate * DIP_COUPLING * curlSign, alpha);
        }
      }
    }
  }
}
