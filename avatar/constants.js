import * as THREE from "three";

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

export const BONE_NAMES = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "leftShoulder", "rightShoulder",
  "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm",
  "leftHand", "rightHand",
  "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg",
  "leftFoot", "rightFoot",
  // Eyes
  "leftEye", "rightEye",
  // Fingers - left
  "leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal",
  "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
  "leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal",
  "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
  "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
  // Fingers - right
  "rightThumbMetacarpal", "rightThumbProximal", "rightThumbDistal",
  "rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal",
  "rightMiddleProximal", "rightMiddleIntermediate", "rightMiddleDistal",
  "rightRingProximal", "rightRingIntermediate", "rightRingDistal",
  "rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal",
];

// Finger bone map: curl value drives X rotation on these bones
// Each entry: [proximal, intermediate, distal]
export const FINGER_BONES = {
  left: {
    thumb:  ["leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal"],
    index:  ["leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal"],
    middle: ["leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal"],
    ring:   ["leftRingProximal", "leftRingIntermediate", "leftRingDistal"],
    pinky:  ["leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal"],
  },
  right: {
    thumb:  ["rightThumbMetacarpal", "rightThumbProximal", "rightThumbDistal"],
    index:  ["rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal"],
    middle: ["rightMiddleProximal", "rightMiddleIntermediate", "rightMiddleDistal"],
    ring:   ["rightRingProximal", "rightRingIntermediate", "rightRingDistal"],
    pinky:  ["rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal"],
  },
};

export const _v3a = new THREE.Vector3();
export const _v3b = new THREE.Vector3();
export const _v3c = new THREE.Vector3();
export const _qa = new THREE.Quaternion();
export const _qb = new THREE.Quaternion();
export const _euler = new THREE.Euler();