import { HAND } from "./constants.js";

function angle3d(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const magBA = Math.hypot(ba.x, ba.y, ba.z) || 1;
  const magBC = Math.hypot(bc.x, bc.y, bc.z) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
}

function flexion(a, b, c) {
  return Math.PI - angle3d(a, b, c);
}

function dir(a, b) {
  return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
}

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dist3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

export function extractHand(landmarks, worldLandmarks, handedness, opts = {}) {
  if (!landmarks || landmarks.length < 21) return null;

  const use3d = !!worldLandmarks;
  const get = (idx) => {
    if (use3d) {
      const lm = worldLandmarks[idx];
      return { x: lm.x, y: lm.y, z: lm.z };
    }
    const lm = landmarks[idx];
    return { x: lm.x, y: lm.y, z: lm.z || 0 };
  };

  const wrist = get(HAND.WRIST);
  const indexMcp = get(HAND.INDEX_MCP);
  const middleMcp = get(HAND.MIDDLE_MCP);
  const pinkyMcp = get(HAND.PINKY_MCP);

  const handScale = dist3D(wrist, middleMcp) || 1;
  const handForward = normalize(dir(wrist, middleMcp));

  let handAcross = dir(indexMcp, pinkyMcp);
  const dot = handAcross.x * handForward.x + handAcross.y * handForward.y + handAcross.z * handForward.z;
  handAcross.x -= dot * handForward.x;
  handAcross.y -= dot * handForward.y;
  handAcross.z -= dot * handForward.z;
  handAcross = normalize(handAcross);

  let palmNormal = normalize(cross(handForward, handAcross));
  if (handedness === "Left") {
    palmNormal = { x: -palmNormal.x, y: -palmNormal.y, z: -palmNormal.z };
  }

  const computeFinger = (mcpIdx, pipIdx, dipIdx, tipIdx, maxAngle = 2.8) => {
    const mcpPt = get(mcpIdx);
    const pipPt = get(pipIdx);
    const dipPt = get(dipIdx);
    const tipPt = get(tipIdx);

    const mcpFlex = flexion(wrist, mcpPt, pipPt);
    const pipFlex = flexion(mcpPt, pipPt, dipPt);
    const dipFlex = flexion(pipPt, dipPt, tipPt);

    const totalFlex = mcpFlex + pipFlex;
    const curl = Math.max(0, Math.min(1, totalFlex / maxAngle));

    return { curl, mcp: mcpFlex, pip: pipFlex, dip: dipFlex };
  };

  const thumbMcp = get(HAND.THUMB_MCP);
  const thumbIp = get(HAND.THUMB_IP);
  const thumbTip = get(HAND.THUMB_TIP);

  const thumbFlex = flexion(thumbMcp, thumbIp, thumbTip);
  const thumbCurl = Math.max(0, Math.min(1, thumbFlex / 1.5));

  const thumbSpan = Math.max(0, Math.min(1.5, dist3D(thumbTip, pinkyMcp) / handScale));
  const thumbOpposition = Math.max(0, Math.min(1, 1 - (thumbSpan - 0.25) / 0.85));

  const fingers = {
    thumb: {
      curl: thumbCurl,
      flexion: thumbFlex,
      opposition: thumbOpposition,
      span: thumbSpan,
    },
    index:  computeFinger(HAND.INDEX_MCP, HAND.INDEX_PIP, HAND.INDEX_DIP, HAND.INDEX_TIP),
    middle: computeFinger(HAND.MIDDLE_MCP, HAND.MIDDLE_PIP, HAND.MIDDLE_DIP, HAND.MIDDLE_TIP),
    ring:   computeFinger(HAND.RING_MCP, HAND.RING_PIP, HAND.RING_DIP, HAND.RING_TIP),
    pinky:  computeFinger(HAND.PINKY_MCP, HAND.PINKY_PIP, HAND.PINKY_DIP, HAND.PINKY_TIP),
  };

  return {
    handedness,
    wrist,
    handForward,
    palmNormal,
    handScale,
    fingers,
    worldSpace: use3d,
    landmarks: opts.remap ? opts.remap(landmarks) : landmarks,
  };
}
