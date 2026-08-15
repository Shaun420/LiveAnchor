import * as THREE from "three";
import { LIMB_CHAINS, _v3a, _v3c, _qa, _qb, _euler } from "./constants.js";

export function lerpBone(bone, axis, target, alpha) {
  if (!bone) return;
  bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], target, alpha);
}

export function driveHead(bones, state, neckHeadSplit, alpha) {
  const { yaw, pitch, roll } = state;
  const nf = neckHeadSplit;
  const hf = 1 - nf;

  lerpBone(bones.head, "y", yaw * hf, alpha);
  lerpBone(bones.head, "x", pitch * hf, alpha);
  lerpBone(bones.head, "z", -roll * hf, alpha);

  lerpBone(bones.neck, "y", yaw * nf, alpha);
  lerpBone(bones.neck, "x", pitch * nf, alpha);
  lerpBone(bones.neck, "z", -roll * nf, alpha);
}

export function driveTorso(bones, torso, shoulderTilt, alpha) {
  if (!torso) return;

  const chain = [
    [bones.spine, 0.3],
    [bones.chest, 0.3],
    [bones.upperChest, 0.4],
  ];

  for (const [bone, w] of chain) {
    if (!bone) continue;
    lerpBone(bone, "y", THREE.MathUtils.clamp(torso.yaw * w, -0.8, 0.8), alpha);
    lerpBone(bone, "x", THREE.MathUtils.clamp(torso.pitch * w, -0.5, 0.5), alpha);
    lerpBone(bone, "z", THREE.MathUtils.clamp(-shoulderTilt * w, -0.4, 0.4), alpha);
  }
}

export function driveLimbs(vrm, bones, rest, body, alpha, debugLog) {
  if (!body?.joints3d || !rest || !vrm) return;

  vrm.scene.updateMatrixWorld(true);
  const j = body.joints3d;

  const toVRM = (p) => _v3a.set(p.x, -p.y, -p.z);

  const vis = {
    leftUpperArm: body.hasLeftArm, leftLowerArm: body.hasLeftArm,
    rightUpperArm: body.hasRightArm, rightLowerArm: body.hasRightArm,
    leftUpperLeg: body.hasLeftLeg, leftLowerLeg: body.hasLeftLeg,
    rightUpperLeg: body.hasRightLeg, rightLowerLeg: body.hasRightLeg,
  };

  let applied = 0;

  for (const chain of LIMB_CHAINS) {
    if (!vis[chain.bone]) continue;

    const bone = bones[chain.bone];
    const r = rest[chain.bone];
    if (!bone || !r) continue;

    const pa = j[chain.mp[0]];
    const pb = j[chain.mp[1]];
    if (!pa || !pb) continue;

    const worldA = toVRM(pa).clone();
    const worldB = toVRM(pb);
    const target = _v3c.copy(worldB).sub(worldA);
    if (target.lengthSq() < 1e-8) continue;
    target.normalize();

    _qa.setFromUnitVectors(r.dir, target);
    _qb.copy(r.quat);
    _qa.multiply(_qb);

    bone.parent.getWorldQuaternion(_qb);
    _qb.invert().multiply(_qa);

    if (debugLog && (chain.bone === "leftUpperArm" || chain.bone === "rightUpperArm")) {
      _euler.setFromQuaternion(_qb);
      console.log(`  ${chain.bone}: t(${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)}) e°(${(_euler.x*57.3).toFixed(0)},${(_euler.y*57.3).toFixed(0)},${(_euler.z*57.3).toFixed(0)})`);
    }

    bone.quaternion.slerp(_qb, alpha);
    applied++;
  }

  if (debugLog) console.log(`[Limbs] applied:${applied}`);
}