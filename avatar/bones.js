import * as THREE from "three";
import { LIMB_CHAINS, BONE_NAMES } from "./constants.js";

// Mapping dictionary for legacy or un-normalized VRM/VRoid rigs
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
  rightEye: ["J_Adj_R_FaceEye", "rightEye"]
};

/**
 * Locate all required VRM humanoid bones in the loaded scene with robust fallback search.
 */
export function findAllBones(vrm) {
  if (!vrm) return {};
  const h = vrm.humanoid;
  const bones = {};

  for (const name of BONE_NAMES) {
    // 1. Try standard normalized humanoid lookup first (safest)
    let node = h?.getNormalizedBoneNode(name);

    // 2. Fall back to scene graph search matching standard named patterns
    if (!node) {
      const alternatives = LEGACY_MAP[name] || [name];
      for (const alt of alternatives) {
        node = vrm.scene.getObjectByName(alt);
        if (node) break;
      }
    }

    // 3. Last resort fuzzy search
    if (!node) {
      vrm.scene.traverse((child) => {
        if (!node && child.name && child.name.toLowerCase().endsWith(name.toLowerCase())) {
          node = child;
        }
      });
    }

    bones[name] = node || null;
  }

  const found = BONE_NAMES.filter((n) => bones[n]);
  console.log(`[Avatar] Bones resolved: ${found.length}/${BONE_NAMES.length}`);
  return bones;
}

/**
 * Capture the rest-pose (T-Pose) orientations of all limb and hand bones.
 */
export function captureRestPose(vrm, bones) {
  if (!vrm) return null;
  vrm.scene.updateMatrixWorld(true);

  const rest = {};

  // 1. Capture Arm and Leg Rest Vectors
  for (const chain of LIMB_CHAINS) {
    const b = bones[chain.bone];
    const c = bones[chain.child];
    if (!b || !c) continue;

    const bp = new THREE.Vector3();
    const cp = new THREE.Vector3();
    b.getWorldPosition(bp);
    c.getWorldPosition(cp);

    const d = cp.clone().sub(bp);
    if (d.lengthSq() < 1e-8) continue;
    d.normalize();

    const quat = new THREE.Quaternion();
    b.getWorldQuaternion(quat);
    rest[chain.bone] = { dir: d, quat };
  }

  // 2. Capture Wrist 3D Orthonormal Bases
  for (const side of ["left", "right"]) {
    const handBone = bones[`${side}Hand`];
    const indexMcp = bones[`${side}IndexProximal`];
    const pinkyMcp = bones[`${side}LittleProximal`];
    const middleMcp = bones[`${side}MiddleProximal`] || bones[`${side}IndexProximal`];

    if (!handBone) continue;

    const hp = new THREE.Vector3();
    handBone.getWorldPosition(hp);

    const fwd = new THREE.Vector3();
    if (middleMcp) {
      middleMcp.getWorldPosition(fwd);
      fwd.sub(hp).normalize();
    } else {
      fwd.set(side === "left" ? 1 : -1, 0, 0);
    }

    const across = new THREE.Vector3(0, 0, 1);
    if (indexMcp && pinkyMcp) {
      const ip = new THREE.Vector3();
      const pp = new THREE.Vector3();
      indexMcp.getWorldPosition(ip);
      pinkyMcp.getWorldPosition(pp);
      across.copy(pp).sub(ip).normalize();
    }

    const norm = new THREE.Vector3().crossVectors(fwd, across).normalize();
    if (side === "left") {
      norm.negate();
    }

    const binormal = new THREE.Vector3().crossVectors(fwd, norm).normalize();
    norm.crossVectors(binormal, fwd).normalize();

    const quat = new THREE.Quaternion();
    handBone.getWorldQuaternion(quat);

    rest[`${side}Hand`] = {
      fwd,
      norm,
      binormal,
      quat,
    };
  }

  console.log("[Avatar] Rest pose captured for:", Object.keys(rest).join(", "));
  return rest;
}