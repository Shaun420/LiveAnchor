// avatar/lifting.js
import * as THREE from "three";

// COCO 17-joint indices
const C = {
  LS: 5, RS: 6, LE: 7, RE: 8, LW: 9, RW: 10,
  LH: 11, RH: 12, LK: 13, RK: 14, LA: 15, RA: 16
};

// Map COCO limbs to Miku's bone names (from miku_skeleton.json)
const LIMB_MAP = {
  leftUpperArm:  { from: C.LS, to: C.LE },
  leftLowerArm:  { from: C.LE, to: C.LW },
  rightUpperArm: { from: C.RS, to: C.RE },
  rightLowerArm: { from: C.RE, to: C.RW },
  leftUpperLeg:  { from: C.LH, to: C.LK },
  leftLowerLeg:  { from: C.LK, to: C.LA },
  rightUpperLeg: { from: C.RH, to: C.RK },
  rightLowerLeg: { from: C.RK, to: C.RA }
};

// Miku's anatomical basis vectors (derived from miku_skeleton.json)
// Z is UP, -X is RIGHT (since Left Shoulder is +X), -Y is FORWARD
const MIKU_UP    = new THREE.Vector3(0, 0, 1);
const MIKU_RIGHT = new THREE.Vector3(-1, 0, 0);
const MIKU_FWD   = new THREE.Vector3(0, -1, 0);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export function applyLiftedPose(avatar, joints17, alpha) {
  if (!joints17 || joints17.length < 51) return;

  // 1. Parse 3D points
  const pts = [];
  for (let i = 0; i < 17; i++) {
    pts.push(new THREE.Vector3(joints17[i*3], joints17[i*3+1], joints17[i*3+2]));
  }

  // 2. Build Pose Torso Basis (aligns the model's output to Miku's space)
  const shoulderMid = _v1.copy(pts[C.LS]).add(pts[C.RS]).multiplyScalar(0.5);
  const hipMid = _v2.copy(pts[C.LH]).add(pts[C.RH]).multiplyScalar(0.5);
  
  const poseUp = _v3.copy(shoulderMid).sub(hipMid).normalize();
  const poseRight = new THREE.Vector3().copy(pts[C.RS]).sub(pts[C.LS]).normalize();
  const poseFwd = new THREE.Vector3().crossVectors(poseRight, poseUp).normalize();
  poseRight.crossVectors(poseUp, poseFwd).normalize(); // Re-orthogonalize

  // 3. Calculate Alignment Quaternion (Pose Basis -> Miku Basis)
  const poseBasis = new THREE.Matrix4().makeBasis(poseRight, poseUp, poseFwd);
  const mikuBasis = new THREE.Matrix4().makeBasis(MIKU_RIGHT, MIKU_UP, MIKU_FWD);
  const alignMat = mikuBasis.multiply(poseBasis.clone().invert());
  const qAlign = new THREE.Quaternion().setFromRotationMatrix(alignMat);

  // 4. Drive Miku's Bones
  for (const [boneName, indices] of Object.entries(LIMB_MAP)) {
    const bone = avatar.bones[boneName];
    const rest = avatar.rest[boneName];
    if (!bone || !rest) continue;

    // Get pose vector and align it to Miku's coordinate space
    const poseDir = new THREE.Vector3().copy(pts[indices.to]).sub(pts[indices.from]).normalize();
    poseDir.applyQuaternion(qAlign);

    // Calculate delta rotation from Miku's rest direction to the new pose direction
    const qDelta = new THREE.Quaternion().setFromUnitVectors(rest.dir, poseDir);
    
    // Apply delta to Miku's rest quaternion to get the target rotation
    const qTarget = qDelta.clone().multiply(rest.quat);

    // Smoothly interpolate the bone to the target
    bone.quaternion.slerp(qTarget, alpha);
  }
}