import { HAND } from "./constants.js";

function angle3d(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const magBA = Math.hypot(ba.x, ba.y, ba.z) || 1;
  const magBC = Math.hypot(bc.x, bc.y, bc.z) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
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

// Finger curl calculation: 0 = straight, 1 = fully curled fist
function fingerCurl(wrist, mcp, pip, dip, tip) {
  const pipAngle = angle3d(mcp, pip, dip);
  const dipAngle = angle3d(pip, dip, tip);
  const mcpAngle = angle3d(wrist, mcp, pip);

  // π (180°) is straight (curl = 0), smaller angle = bent (curl = 1)
  const avg = (pipAngle + dipAngle + mcpAngle) / 3;
  return Math.max(0, Math.min(1, 1 - avg / Math.PI));
}

export function extractHand(landmarks, worldLandmarks, handedness) {
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

  // --- Hand 3D Orientation Vectors ---
  // 1. Forward direction (from wrist pointing towards knuckles)
  const handForward = normalize(dir(wrist, middleMcp));

  // 2. Across knuckles vector
  const handAcross = normalize(dir(indexMcp, pinkyMcp));

  // 3. Palm normal (pointing out from palm)
  let palmNormal = normalize(cross(handForward, handAcross));
  if (handedness === "Left") {
    // Invert normal for left hand chirality
    palmNormal = { x: -palmNormal.x, y: -palmNormal.y, z: -palmNormal.z };
  }

  // --- Finger Curls ---
  const fingers = {
    thumb: {
      curl: fingerCurl(wrist, get(HAND.THUMB_CMC), get(HAND.THUMB_MCP), get(HAND.THUMB_IP), get(HAND.THUMB_TIP)),
    },
    index: {
      curl: fingerCurl(wrist, indexMcp, get(HAND.INDEX_PIP), get(HAND.INDEX_DIP), get(HAND.INDEX_TIP)),
    },
    middle: {
      curl: fingerCurl(wrist, middleMcp, get(HAND.MIDDLE_PIP), get(HAND.MIDDLE_DIP), get(HAND.MIDDLE_TIP)),
    },
    ring: {
      curl: fingerCurl(wrist, get(HAND.RING_MCP), get(HAND.RING_PIP), get(HAND.RING_DIP), get(HAND.RING_TIP)),
    },
    pinky: {
      curl: fingerCurl(wrist, pinkyMcp, get(HAND.PINKY_PIP), get(HAND.PINKY_DIP), get(HAND.PINKY_TIP)),
    },
  };

  return {
    handedness, // "Left" or "Right"
    wrist,
    handForward,
    palmNormal,
    fingers,
    worldSpace: use3d,
  };
}

export function logHandData(hand, label) {
  if (!hand) return;
  const f = hand.fingers;
  console.log(
    `[Hand: ${label}] Forward:(${hand.handForward.x.toFixed(2)},${hand.handForward.y.toFixed(2)},${hand.handForward.z.toFixed(2)}) ` +
    `Curls: T:${f.thumb.curl.toFixed(2)} I:${f.index.curl.toFixed(2)} M:${f.middle.curl.toFixed(2)} R:${f.ring.curl.toFixed(2)} P:${f.pinky.curl.toFixed(2)}`
  );
}