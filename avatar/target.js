import * as THREE from "three";

export function computeTarget(face, body, camera, config) {
  const fw = face.frameWidth || config.sourceWidth;
  const fh = face.frameHeight || config.sourceHeight;
  const eyeN = face.eyeDistanceNorm ?? (face.eyeDistance || 0) / fw;

  // Visible plane at camera distance
  const d = Math.abs(camera.position.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const planeH = 2 * Math.tan(fov / 2) * d;
  const planeW = planeH * camera.aspect;

  // Scale
  const absYaw = Math.abs(face.yaw || 0);
  const yawCos = Math.max(config.minYawCos, Math.cos(absYaw));
  const corrected = eyeN / Math.pow(yawCos, config.yawScaleCompensation);
  let scaleEye = (corrected * planeW * config.sizeMultiplier) / config.avatarEyeDistance;
  let scale = scaleEye;

  if (body && !body.synthesized && body.shoulderWidthNorm) {
    const sn = body.shoulderWidthNorm;
    const expected = eyeN * config.avatarShoulderToEyeRatio;
    const r = sn / (expected || 0.01);
    if (r > 0.4 && r < 2.5) {
      const scaleSh = (sn * planeW * config.sizeMultiplier) / config.avatarShoulderWidth;
      const sw = config.shoulderScaleWeight;
      scale = scaleSh * sw + scaleEye * (1 - sw);
    }
  }
  scale = THREE.MathUtils.clamp(scale, 0.05, 20);

  // Position
  let x, y;
  if (body && !body.synthesized && body.shoulderMidXNorm !== undefined) {
    x = (body.shoulderMidXNorm - 0.5) * planeW;
    y = (0.5 - body.shoulderMidYNorm) * planeH;
  } else {
    const xn = face.xNorm ?? face.x / fw;
    const yn = face.yNorm ?? face.y / fh;
    x = (xn - 0.5) * planeW;
    y = (0.5 - yn) * planeH - eyeN * 2.5 * planeH * config.sizeMultiplier;
  }

  return {
    x, y, scale,
    yaw: face.yaw || 0,
    pitch: face.pitch || 0,
    roll: face.roll || 0,
    shoulderTilt: body && !body.synthesized ? (body.shoulderTilt || 0) : 0,
  };
}