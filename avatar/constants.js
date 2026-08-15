import * as THREE from "three";

// Limb chain definitions: VRM bone → child bone → [MP joint parent, MP joint child]
export const LIMB_CHAINS = [
  { bone: "leftUpperArm",  child: "leftLowerArm",  mp: ["leftShoulder",  "leftElbow"]  },
  { bone: "leftLowerArm",  child: "leftHand",       mp: ["leftElbow",     "leftWrist"]  },
  { bone: "rightUpperArm", child: "rightLowerArm",  mp: ["rightShoulder", "rightElbow"] },
  { bone: "rightLowerArm", child: "rightHand",      mp: ["rightElbow",    "rightWrist"] },
  { bone: "leftUpperLeg",  child: "leftLowerLeg",   mp: ["leftHip",       "leftKnee"]   },
  { bone: "leftLowerLeg",  child: "leftFoot",       mp: ["leftKnee",      "leftAnkle"]  },
  { bone: "rightUpperLeg", child: "rightLowerLeg",   mp: ["rightHip",      "rightKnee"]  },
  { bone: "rightLowerLeg", child: "rightFoot",       mp: ["rightKnee",     "rightAnkle"] },
];

// All VRM bone names we use
export const BONE_NAMES = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftShoulder", "rightShoulder",
  "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm",
  "leftHand", "rightHand",
  "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg",
  "leftFoot", "rightFoot",
];

// Reusable THREE objects (avoids per-frame allocation)
export const _v3a = new THREE.Vector3();
export const _v3b = new THREE.Vector3();
export const _v3c = new THREE.Vector3();
export const _qa = new THREE.Quaternion();
export const _qb = new THREE.Quaternion();
export const _euler = new THREE.Euler();