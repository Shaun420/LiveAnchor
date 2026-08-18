export function formatDebugHUD(data, privacyOn) {
  if (!data) return "No data";

  const f = data.face, b = data.body, h = data.hands;
  let d = `faces:${data.facesDetected} privacy:${privacyOn ? "ON" : "OFF"}`;
  if (data.mask) d += ` mask:${data.mask.width}x${data.mask.height}`;
  d += "\n";

  if (f) {
    d += `yaw:${(f.yaw * 57.3).toFixed(1)}° pitch:${(f.pitch * 57.3).toFixed(1)}° roll:${(f.roll * 57.3).toFixed(1)}°\n`;
    d += `eye:${f.eyeDistance.toFixed(0)}px mouth:${f.mouthOpen.toFixed(2)}`;
    if (f.gaze) d += ` gaze:(${f.gaze.leftX.toFixed(1)},${f.gaze.leftY.toFixed(1)})`;
    d += "\n";
  }

  if (b) {
    d += `[${b.mode}] sh:${b.shoulderWidth.toFixed(0)}px tilt:${((b.shoulderTilt || 0) * 57.3).toFixed(1)}°\n`;
    if (b.torso) d += `torso Y:${(b.torso.yaw * 57.3).toFixed(1)}° P:${(b.torso.pitch * 57.3).toFixed(1)}°\n`;
    if (b.hipRotation) d += `hips Y:${(b.hipRotation.yaw * 57.3).toFixed(1)}° R:${(b.hipRotation.roll * 57.3).toFixed(1)}°\n`;
    d += `arms:${b.hasLeftArm}/${b.hasRightArm} legs:${b.hasLeftLeg}/${b.hasRightLeg}\n`;
  }

  if (h) {
    for (const [side, hand] of Object.entries(h)) {
      const fg = hand.fingers;
      d += `${side[0].toUpperCase()}: T${fg.thumb.curl.toFixed(1)} I${fg.index.curl.toFixed(1)} M${fg.middle.curl.toFixed(1)} R${fg.ring.curl.toFixed(1)} P${fg.pinky.curl.toFixed(1)}\n`;
    }
  }

  return d;
}