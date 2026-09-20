import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { _v3a, _v3b } from "./constants.js";

// VRM humanoid bone names (standard mapping)
const VRM_HUMANOID_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "jaw",
  "leftUpperLeg",
  "rightUpperLeg",
  "leftLowerLeg",
  "rightLowerLeg",
  "leftFoot",
  "rightFoot",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "leftToes",
  "rightToes",
  "leftThumbProximal",
  "leftThumbIntermediate",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightThumbProximal",
  "rightThumbIntermediate",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
];

function buildHumanoidFromGLTF(gltf) {
  // Map bone names to THREE.Object3D nodes
  const boneMap = new Map();
  gltf.scene.traverse((node) => {
    if (node.isBone || node.isSkinnedMesh) {
      boneMap.set(node.name, node);
    }
  });

  // Check how many VRM humanoid bones we can map
  const humanoid = {};
  let mapped = 0;
  for (const boneName of VRM_HUMANOID_BONES) {
    const node = boneMap.get(boneName);
    if (node) {
      humanoid[boneName] = node;
      mapped++;
    }
  }

  // Need at least core skeleton (hips, spine, chest, head, arms, legs)
  const required = ["hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "rightUpperArm", "leftUpperLeg", "rightUpperLeg"];
  const hasRequired = required.every((b) => humanoid[b]);

  if (!hasRequired || mapped < 15) {
    return null; // Not a VRM-compatible skeleton
  }

  return {
    getNormalizedBoneNode: (name) => humanoid[name] || null,
    // Minimal humanoid interface for our loader
  };
}

export async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));

  const gltf = await loader.loadAsync(url, (e) => {
    if (e.total > 0) console.log(`[Avatar] Loading ${Math.round(e.loaded / e.total * 100)}%`);
  });

  // First, try standard VRM path
  let vrm = gltf.userData.vrm;

  if (!vrm) {
    // ⚡ NEW: Try to auto-detect VRM-compatible skeleton in plain GLB/GLTF
    console.log("[Avatar] No VRM metadata found. Attempting auto-detection of humanoid skeleton...");
    const humanoid = buildHumanoidFromGLTF(gltf);

    if (humanoid) {
      console.log("[Avatar] ✅ Auto-detected VRM-compatible humanoid skeleton!");
      // Create a minimal VRM-like object
      vrm = {
        scene: gltf.scene,
        humanoid,
        // Minimal interface for our loader
        expressionManager: null, // No blendshapes in plain GLB
        meta: { metaVersion: "1" },
      };
      // Mark as auto-detected so we know blendshapes/springBones aren't available
      vrm._autoDetected = true;
    }
  }

  if (!vrm) throw new Error("No VRM data found and no VRM-compatible skeleton detected");

  if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);

  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
    if (o.isMesh) o.castShadow = o.receiveShadow = false;
  });

  return vrm;
}

export function measureModel(vrm, anchorRoot, modelRoot, scene) {
  modelRoot.position.set(0, 0, 0);
  scene.updateMatrixWorld(true);

  const humanoid = vrm.humanoid;
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(_v3a);
  const center = box.getCenter(_v3b);

  // Eye distance
  const le = humanoid?.getNormalizedBoneNode("leftEye");
  const re = humanoid?.getNormalizedBoneNode("rightEye");
  let eyeDist;
  if (le && re) {
    le.getWorldPosition(_v3a);
    re.getWorldPosition(_v3b);
    eyeDist = Math.max(_v3a.distanceTo(_v3b), 0.001);
  } else {
    eyeDist = size.y * 0.065;
  }

  // Shoulder width + center
  const lsb = humanoid?.getNormalizedBoneNode("leftUpperArm");
  const rsb = humanoid?.getNormalizedBoneNode("rightUpperArm");
  let shoulderCenter, shoulderWidth;
  if (lsb && rsb) {
    lsb.getWorldPosition(_v3a);
    rsb.getWorldPosition(_v3b);
    shoulderCenter = _v3a.clone().add(_v3b).multiplyScalar(0.5);
    shoulderWidth = Math.max(_v3a.distanceTo(_v3b), 0.001);
  } else {
    shoulderWidth = eyeDist * 4.5;
    shoulderCenter = new THREE.Vector3(center.x, center.y + size.y * 0.15, center.z);
  }

  // Anchor at shoulder midpoint
  const local = anchorRoot.worldToLocal(shoulderCenter.clone());
  modelRoot.position.set(-local.x, -local.y, -local.z);

  console.log(`[Avatar] eyeDist:${eyeDist.toFixed(4)} shoulderW:${shoulderWidth.toFixed(4)}`);

  return {
    eyeDistance: eyeDist,
    shoulderWidth,
    shoulderToEyeRatio: shoulderWidth / eyeDist,
  };
}