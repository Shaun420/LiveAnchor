import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { _v3a, _v3b } from "./constants.js";

export async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));

  const gltf = await loader.loadAsync(url, (e) => {
    if (e.total > 0) console.log(`[Avatar] Loading ${Math.round(e.loaded / e.total * 100)}%`);
  });

  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("No VRM data found");

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