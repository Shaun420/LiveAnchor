import * as THREE from "three";
import { LIMB_CHAINS, BONE_NAMES } from "./constants.js";

export function findAllBones(vrm) {
  if (!vrm?.humanoid) return {};
  const h = vrm.humanoid;
  const bones = {};
  for (const name of BONE_NAMES) {
    bones[name] = h.getNormalizedBoneNode(name);
  }
  const found = BONE_NAMES.filter((n) => bones[n]);
  console.log("[Avatar] Bones:", found.join(", "));
  return bones;
}

export function captureRestPose(vrm, bones) {
  if (!vrm) return null;
  vrm.scene.updateMatrixWorld(true);

  const rest = {};
  for (const chain of LIMB_CHAINS) {
    const b = bones[chain.bone];
    const c = bones[chain.child];
    if (!b || !c) continue;

    const bp = new THREE.Vector3();
    const cp = new THREE.Vector3();
    b.getWorldPosition(bp);
    c.getWorldPosition(cp);

    const dir = cp.clone().sub(bp);
    if (dir.lengthSq() < 1e-8) continue;
    dir.normalize();

    const quat = new THREE.Quaternion();
    b.getWorldQuaternion(quat);
    rest[chain.bone] = { dir, quat };
  }

  console.log("[Avatar] Rest:", Object.keys(rest).join(", "));
  return rest;
}