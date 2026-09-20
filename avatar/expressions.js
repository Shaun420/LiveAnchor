import * as THREE from "three";

export function driveExpressions(vrm, data) {
  if (!vrm?.expressionManager) return;
  const em = vrm.expressionManager;
  const bs = data?.blendshapes;
  const face = data?.face;

  const set = (name, val) => {
    if (em.getExpression(name)) {
      em.setValue(name, THREE.MathUtils.clamp(val, 0, 1));
    }
  };

  if (bs) {
    set("aa", bs.jawOpen || 0);
    set("ou", (bs.mouthPucker || 0) + (bs.mouthFunnel || 0) * 0.5);
    set("ih", (bs.jawOpen || 0) * 0.3);
    set("ee", ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) * 0.25);
    set("oh", (bs.jawOpen || 0) * 0.5 + (bs.mouthFunnel || 0) * 0.3);
    set("blinkLeft", bs.eyeBlinkLeft || 0);
    set("blinkRight", bs.eyeBlinkRight || 0);
  } else if (face) {
    set("aa", Math.min(1, (face.mouthOpen || 0) * 5));
  }
}
