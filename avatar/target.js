import * as THREE from "three";

const _ndcVec = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _dirVec = new THREE.Vector3();

/**
 * Computes the 3D world position and rotation for the avatar's root anchor.
 * Uses camera unprojection to map 2D screen coordinates to the 3D plane.
 */
export function computeTarget(face, body, camera, config) {
  let targetX = 0;
  let targetY = 0;
  let targetScale = config.sizeMultiplier || 1.0;
  
  let targetYaw = 0;
  let targetPitch = 0;
  let targetRoll = 0;
  let targetShoulderTilt = 0;

  if (face) {
    const ndcX0 = (face.xNorm * 2) - 1;
    const ndcX = config.mirrored ? -ndcX0 : ndcX0;
    const ndcY = (face.yNorm * 2) - 1;

    _ndcVec.set(ndcX, ndcY, 0.5);
    _ndcVec.unproject(camera);

    _dirVec.copy(_ndcVec).sub(camera.position).normalize();
    
    if (Math.abs(_dirVec.z) > 1e-6) {
      const distance = -camera.position.z / _dirVec.z;
      _worldPos.copy(camera.position).addScaledVector(_dirVec, distance);
      
      targetX = _worldPos.x;
      targetY = _worldPos.y;
    }

    const refEyeDist = config.referenceEyeDistance || 0.15;
    if (face.eyeDistanceNorm > 0.02) {
      targetScale = (face.eyeDistanceNorm / refEyeDist) * (config.sizeMultiplier || 1.0);
    }

    targetYaw = face.yaw;
    targetPitch = face.pitch;
    targetRoll = face.roll;
  }

  if (body) {
    targetShoulderTilt = body.shoulderTilt || 0;
  }

  return {
    x: targetX,
    y: targetY,
    scale: targetScale,
    yaw: targetYaw,
    pitch: targetPitch,
    roll: targetRoll,
    shoulderTilt: targetShoulderTilt,
  };
}
