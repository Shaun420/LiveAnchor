export function formatDebugHUD(data, tracker) {
  if (!data) return "no data";

  const f = data.face;
  const b = data.body;
  const h = data.hands;
  let d = "";

  // Preset + FPS
  if (tracker?.preset) {
    d += `preset:${tracker.preset.label.split(" ")[0]} `;
  }
  d += `faces:${data.facesDetected}\n`;

  if (f) {
    d += `yaw:${(f.yaw * 57.3).toFixed(1)}° `;
    d += `pitch:${(f.pitch * 57.3).toFixed(1)}° `;
    d += `roll:${(f.roll * 57.3).toFixed(1)}°\n`;
    d += `eye:${f.eyeDistance?.toFixed(0)}px `;
    d += `mouth:${f.mouthOpen?.toFixed(2)}\n`;
    if (f.gaze) {
      d += `gaze:(${f.gaze.leftX?.toFixed(1)},${f.gaze.leftY?.toFixed(1)})\n`;
    }
  }

  if (b) {
    d += `[${b.mode}] sh:${b.shoulderWidth?.toFixed(0)}px\n`;
    if (b.torso) {
      d += `torso Y${(b.torso.yaw * 57.3).toFixed(0)}° `;
      d += `P${(b.torso.pitch * 57.3).toFixed(0)}°\n`;
    }
    d += `arms:${b.hasLeftArm}/${b.hasRightArm} `;
    d += `legs:${b.hasLeftLeg}/${b.hasRightLeg}\n`;
  }

  if (h) {
    for (const [side, hand] of Object.entries(h)) {
      const fg = hand.fingers;
      d += `${side[0].toUpperCase()}:`;
      d += `T${fg.thumb?.curl?.toFixed(1)} `;
      d += `I${fg.index?.curl?.toFixed(1)} `;
      d += `M${fg.middle?.curl?.toFixed(1)} `;
      d += `R${fg.ring?.curl?.toFixed(1)} `;
      d += `P${fg.pinky?.curl?.toFixed(1)}\n`;
    }
  }

  return d;
}