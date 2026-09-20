import * as THREE from "three";
import { LIMB_CHAINS, BONE_NAMES, FINGER_BONES, _v3a, _v3b, _v3c, _v3d } from "./constants.js";

const LEGACY_MAP = {
  hips: ["J_Bip_C_Hips", "bip_hips", "hips"],
  spine: ["J_Bip_C_Spine", "bip_spine", "spine"],
  chest: ["J_Bip_C_Chest", "bip_chest", "chest"],
  upperChest: ["J_Bip_C_UpperChest", "bip_upperChest", "upperChest"],
  neck: ["J_Bip_C_Neck", "bip_neck", "neck"],
  head: ["J_Bip_C_Head", "bip_head", "head"],
  leftShoulder: ["J_Bip_L_Shoulder", "bip_l_shoulder", "leftShoulder"],
  rightShoulder: ["J_Bip_R_Shoulder", "bip_r_shoulder", "rightShoulder"],
  leftUpperArm: ["J_Bip_L_UpperArm", "bip_l_upperArm", "leftUpperArm"],
  rightUpperArm: ["J_Bip_R_UpperArm", "bip_r_upperArm", "rightUpperArm"],
  leftLowerArm: ["J_Bip_L_LowerArm", "bip_l_lowerArm", "leftLowerArm"],
  rightLowerArm: ["J_Bip_R_LowerArm", "bip_r_lowerArm", "rightLowerArm"],
  leftHand: ["J_Bip_L_Hand", "bip_l_hand", "leftHand"],
  rightHand: ["J_Bip_R_Hand", "bip_r_hand", "rightHand"],
  leftUpperLeg: ["J_Bip_L_UpperLeg", "bip_l_upperLeg", "leftUpperLeg"],
  rightUpperLeg: ["J_Bip_R_UpperLeg", "bip_r_upperLeg", "rightUpperLeg"],
  leftLowerLeg: ["J_Bip_L_LowerLeg", "bip_l_lowerLeg", "leftLowerLeg"],
  rightLowerLeg: ["J_Bip_R_LowerLeg", "bip_r_lowerLeg", "rightLowerLeg"],
  leftFoot: ["J_Bip_L_Foot", "bip_l_foot", "leftFoot"],
  rightFoot: ["J_Bip_R_Foot", "bip_r_foot", "rightFoot"],
  leftEye: ["J_Adj_L_FaceEye", "leftEye"],
  rightEye: ["J_Adj_R_FaceEye", "rightEye"],
};

export function findAllBones(vrm) {
  if (!vrm) return {};
  const h = vrm.humanoid;
  const bones = {};

  for (const name of BONE_NAMES) {
    let node = h?.getNormalizedBoneNode?.(name) || null;
    if (!node) {
      for (const alt of LEGACY_MAP[name] || [name]) {
        node = vrm.scene.getObjectByName(alt);
        if (node) break;
      }
    }
    if (!node) {
      const suffix = name.toLowerCase();
      vrm.scene.traverse((child) => {
        if (!node && child.name && child.name.toLowerCase().endsWith(suffix)) node = child;
      });
    }
    bones[name] = node || null;
  }

  console.log(`[Avatar] Bones resolved: ${BONE_NAMES.filter((n) => bones[n]).length}/${BONE_NAMES.length}`);
  return bones;
}

function buildHandBasis(handBone, middleMcp, indexMcp, pinkyMcp, side) {
  if (!handBone) return null;
  const w = handBone.getWorldPosition(_v3a);

  const f = _v3b.set(0, 0, 0);
  if (middleMcp) middleMcp.getWorldPosition(f);
  f.sub(w);
  if (f.lengthSq() < 1e-8) f.set(side === "left" ? 1 : -1, 0, 0);
  f.normalize();

  const a = _v3c.set(0, 0, 1);
  if (indexMcp && pinkyMcp) {
    indexMcp.getWorldPosition(a);
    pinkyMcp.getWorldPosition(_v3d);
    a.sub(_v3d);
    if (a.lengthSq() > 1e-8) {
      a.addScaledVector(f, -a.dot(f)).normalize();
    } else {
      a.set(0, 0, 1);
    }
  }

  const n = new THREE.Vector3().crossVectors(f, a).normalize();
  if (side === "left") n.negate();

  const b  = new THREE.Vector3().crossVectors(n, f).normalize();
  const nO = new THREE.Vector3().crossVectors(f, b).normalize();

  return { b, nO, f, worldQuat: handBone.getWorldQuaternion(new THREE.Quaternion()) };
}

export function captureRestPose(vrm, bones) {
  if (!vrm) return null;
  vrm.scene.updateMatrixWorld(true);
  const rest = {};

  for (const chain of LIMB_CHAINS) {
    const b = bones[chain.bone], c = bones[chain.child];
    if (!b || !c) continue;
    const bp = new THREE.Vector3(), cp = new THREE.Vector3();
    b.getWorldPosition(bp);
    c.getWorldPosition(cp);
    const d = cp.sub(bp);
    if (d.lengthSq() < 1e-8) continue;
    const len = Math.max(d.length(), 1e-5);
    rest[chain.bone] = {
      dir: d.normalize(),
      quat: b.getWorldQuaternion(new THREE.Quaternion()),
      len,
    };
  }

  for (const side of ["left", "right"]) {
    const basis = buildHandBasis(
      bones[`${side}Hand`],
      bones[`${side}MiddleProximal`],
      bones[`${side}IndexProximal`],
      bones[`${side}LittleProximal`],
      side,
    );
    if (basis) rest[`${side}HandBasis`] = basis;
  }

  for (const side of ["left", "right"]) {
    for (const names of Object.values(FINGER_BONES[side])) {
      for (const name of names) {
        const bone = bones[name];
        if (bone) rest[name] = { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
      }
    }
  }

  console.log("[Avatar] Rest pose captured:", Object.keys(rest).length, "entries");
  return rest;
}
