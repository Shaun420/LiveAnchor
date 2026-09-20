import * as THREE from "three";
import { FINGER_BONES, _v3a, _v3b, _v3c, _qa, _qb } from "./constants.js";

export const GESTURE_POSES = {
  peace_sign: { thumb: 0.70, index: 0.05, middle: 0.05, ring: 0.95, pinky: 0.95 },
  thumbs_up:  { thumb: 0.05, index: 0.95, middle: 0.95, ring: 0.95, pinky: 0.95 },
  pointing:   { thumb: 0.60, index: 0.05, middle: 0.95, ring: 0.95, pinky: 0.95 },
  open_palm:  { thumb: 0.00, index: 0.00, middle: 0.00, ring: 0.00, pinky: 0.00 },
  rock_on:    { thumb: 0.60, index: 0.05, middle: 0.95, ring: 0.95, pinky: 0.05 },
};

export const GRIP_POSE = { thumb: 0.60, index: 0.85, middle: 0.90, ring: 0.90, pinky: 0.85 };

const JOINT_LIMITS = [1.55, 1.85, 0.85];

export function captureAnchors(avatar) {
  const { bones, anchorRoot, rest } = avatar;
  if (!bones?.hips || !anchorRoot) return null;
  const p = new THREE.Vector3();
  const local = (bone) => bone ? anchorRoot.worldToLocal(bone.getWorldPosition(p).clone()) : null;

  const hipL = local(bones.leftUpperLeg), hipR = local(bones.rightUpperLeg);
  const chest = local(bones.upperChest || bones.chest);
  const head = local(bones.head);
  const up = rest?.head?.dir || new THREE.Vector3(0, 1, 0);
  const build = (hip) => hip && ({
    hip,
    chest: chest.clone().add(new THREE.Vector3(0, -0.04, 0.02)),
    chin: head.clone().addScaledVector(up, -0.06),
    mouth: head.clone().addScaledVector(up, -0.09),
    behind_back: new THREE.Vector3(hip.x * 0.8, hip.y + 0.06, hip.z - 0.10),
  });
  rest.anchors = { left: build(hipL), right: build(hipR) };
  return rest.anchors;
}

export function solveArmIK(ctrl, side, anchorModel, alpha) {
  const up = ctrl.bones[`${side}UpperArm`];
  const lo = ctrl.bones[`${side}LowerArm`];
  const rUp = ctrl.rest?.[`${side}UpperArm`];
  const rLo = ctrl.rest?.[`${side}LowerArm`];
  if (!up || !lo || !rUp?.len || !rLo?.len) return;

  const a = rUp.len, b = rLo.len;
  const S = up.getWorldPosition(_v3a);
  const T = ctrl.anchorRoot.localToWorld(_v3b.copy(anchorModel));

  const v = _v3c.copy(T).sub(S);
  const d = THREE.MathUtils.clamp(v.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  v.normalize();

  const pole = new THREE.Vector3(side === "left" ? 0.06 : -0.06, 0.35, -0.10);
  const x = pole.addScaledVector(v, -pole.dot(v));
  if (x.lengthSq() < 1e-8) x.set(0, 1, 0); else x.normalize();

  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const angA = Math.acos(cosA);
  const upperDir = v.clone().multiplyScalar(Math.cos(angA)).addScaledVector(x, Math.sin(angA));
  const elbow = S.clone().addScaledVector(upperDir, a);
  const lowerDir = T.clone().sub(elbow).normalize();

  _applyWorldDir(up, rUp, upperDir, alpha);
  _applyWorldDir(lo, rLo, lowerDir, alpha);
}

function _applyWorldDir(bone, rest, dirWorld, alpha) {
  _qa.setFromUnitVectors(rest.dir, dirWorld);
  _qa.multiply(rest.quat);
  bone.parent.getWorldQuaternion(_qb);
  _qb.invert().multiply(_qa);
  bone.quaternion.slerp(_qb, alpha);
}

export function applyFingerPose(bones, side, pose, lerpBone, alpha) {
  const sign = side === "left" ? -1 : 1;
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
