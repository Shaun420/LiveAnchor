// avatar/overrides.js
// Semantic override engine: 2-bone analytic IK + procedural grips + gesture poses.
// Bone lengths & anchors derived from miku_skeleton.json (Z-up, facing -Y).

import * as THREE from "three";
import { FINGER_BONES } from "./constants.js";

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

const ARM_LEN = { upper: 0.21531, lower: 0.20235 }; // from skeleton JSON

// IK anchor table in MODEL space (character faces -Y, Z is up)
export const ANCHORS = {
  left: {
    hip:         new THREE.Vector3( 0.10, -0.01, 0.93),
    chest:       new THREE.Vector3( 0.00, -0.13, 1.24),
    chin:        new THREE.Vector3( 0.00, -0.07, 1.44),
    mouth:       new THREE.Vector3( 0.00, -0.08, 1.47),
    behind_back: new THREE.Vector3( 0.08,  0.14, 0.98),
  },
  right: {
    hip:         new THREE.Vector3(-0.10, -0.01, 0.93),
    chest:       new THREE.Vector3( 0.00, -0.13, 1.24),
    chin:        new THREE.Vector3( 0.00, -0.07, 1.44),
    mouth:       new THREE.Vector3( 0.00, -0.08, 1.47),
    behind_back: new THREE.Vector3(-0.08,  0.14, 0.98),
  },
};

// Finger curl poses (0 = straight, 1 = full curl)
export const GESTURE_POSES = {
  peace_sign: { thumb: 0.70, index: 0.05, middle: 0.05, ring: 0.95, little: 0.95 },
  thumbs_up:  { thumb: 0.05, index: 0.95, middle: 0.95, ring: 0.95, little: 0.95 },
  pointing:   { thumb: 0.60, index: 0.05, middle: 0.95, ring: 0.95, little: 0.95 },
  open_palm:  { thumb: 0.00, index: 0.00, middle: 0.00, ring: 0.00, little: 0.00 },
  rock_on:    { thumb: 0.60, index: 0.05, middle: 0.95, ring: 0.95, little: 0.05 },
};

export const GRIP_POSE = { thumb: 0.60, index: 0.85, middle: 0.90, ring: 0.90, little: 0.85 };

const JOINT_LIMITS = [1.55, 1.85, 0.85]; // proximal, intermediate, distal

// ── Analytic 2-bone IK: solves upper+lower arm world directions, applies delta-quat ──
export function solveArmIK(ctrl, side, anchorModel, alpha) {
  const up = ctrl.bones[`${side}UpperArm`];
  const lo = ctrl.bones[`${side}LowerArm`];
  const rUp = ctrl.rest[`${side}UpperArm`];
  const rLo = ctrl.rest[`${side}LowerArm`];
  if (!up || !lo || !rUp || !rLo) return;

  const a = ARM_LEN.upper, b = ARM_LEN.lower;
  const S = up.getWorldPosition(_v1);                          // shoulder (animated)
  const T = ctrl.anchorRoot.localToWorld(_v2.copy(anchorModel)); // target (world)

  const v = _v3.copy(T).sub(S);
  const d = THREE.MathUtils.clamp(v.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  v.normalize(); // z-axis of the IK plane

  // Elbow pole: behind (+Y) and slightly out/down → natural human bend
  const pole = new THREE.Vector3(side === "left" ? 0.06 : -0.06, 0.35, -0.10);
  const x = pole.addScaledVector(v, -pole.dot(v));             // project ⊥ to v
  if (x.lengthSq() < 1e-8) x.set(0, 1, 0); else x.normalize();

  // Shoulder angle via law of cosines; elbow sits toward the pole side
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const angA = Math.acos(cosA);
  const upperDir = v.clone().multiplyScalar(Math.cos(angA)).addScaledVector(x, Math.sin(angA));
  const elbow = S.clone().addScaledVector(upperDir, a);
  const lowerDir = T.clone().sub(elbow).normalize();

  // Apply upper arm, refresh matrices, then lower arm (same delta-quat math as driveLimbs)
  _applyWorldDir(up, rUp, upperDir, alpha);
  ctrl.vrm.scene.updateMatrixWorld(true);
  _applyWorldDir(lo, rLo, lowerDir, alpha);
}

function _applyWorldDir(bone, rest, dirWorld, alpha) {
  _qa.setFromUnitVectors(rest.dir, dirWorld);
  _qa.multiply(rest.quat);                    // desired WORLD quat
  bone.parent.getWorldQuaternion(_qb);
  _qb.invert().multiply(_qa);                 // → local
  bone.quaternion.slerp(_qb, alpha);
}

// ── Procedural finger pose (grip or gesture), smoothed by lerpBone ──
export function applyFingerPose(bones, side, pose, lerpBone, alpha) {
  const sign = side === "left" ? 1 : -1;
  const map = FINGER_BONES[side];
  if (!map) return;

  for (const [fingerName, boneNames] of Object.entries(map)) {
    const curl = pose[fingerName] ?? 0;
    for (let i = 0; i < 3; i++) {
      const bone = bones[boneNames[i]];
      if (!bone) continue;
      if (fingerName === "thumb") {
        lerpBone(bone, "y", curl * 0.5 * -sign, alpha);
        lerpBone(bone, "z", curl * 0.6 * sign, alpha);
      } else {
        lerpBone(bone, "z", curl * JOINT_LIMITS[i] * sign, alpha);
      }
    }
  }
}