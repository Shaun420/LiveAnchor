import { HAND } from "./constants.js";

// ============================================================
// Extract hand landmarks into a structured format
//
// Each finger has 4 joints: MCP, PIP, DIP, TIP
// We compute the curl angle for each finger (how bent it is)
// and the spread angle between fingers.
// ============================================================

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

// Finger curl: 0 = straight, 1 = fully bent
function fingerCurl(wrist, mcp, pip, dip, tip) {
  // Angle at PIP joint (main bend)
  const pipAngle = angle3d(mcp, pip, dip);
  // Angle at DIP joint
  const dipAngle = angle3d(pip, dip, tip);
  // Angle at MCP (knuckle)
  const mcpAngle = angle3d(wrist, mcp, pip);

  // Combine: straight = π at each joint
  const avgAngle = (pipAngle + dipAngle + mcpAngle) / 3;
  // π = straight (curl=0), 0 = fully bent (curl=1)
  return 1 - avgAngle / Math.PI;
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

  // Per-finger data
  const fingers = {
    thumb: {
      curl: fingerCurl(
        wrist,
        get(HAND.THUMB_CMC),
        get(HAND.THUMB_MCP),
        get(HAND.THUMB_IP),
        get(HAND.THUMB_TIP)
      ),
      dir: dir(get(HAND.THUMB_MCP), get(HAND.THUMB_TIP)),
      joints: [get(HAND.THUMB_CMC), get(HAND.THUMB_MCP), get(HAND.THUMB_IP), get(HAND.THUMB_TIP)],
    },
    index: {
      curl: fingerCurl(wrist, get(HAND.INDEX_MCP), get(HAND.INDEX_PIP), get(HAND.INDEX_DIP), get(HAND.INDEX_TIP)),
      dir: dir(get(HAND.INDEX_MCP), get(HAND.INDEX_TIP)),
      joints: [get(HAND.INDEX_MCP), get(HAND.INDEX_PIP), get(HAND.INDEX_DIP), get(HAND.INDEX_TIP)],
    },
    middle: {
      curl: fingerCurl(wrist, get(HAND.MIDDLE_MCP), get(HAND.MIDDLE_PIP), get(HAND.MIDDLE_DIP), get(HAND.MIDDLE_TIP)),
      dir: dir(get(HAND.MIDDLE_MCP), get(HAND.MIDDLE_TIP)),
      joints: [get(HAND.MIDDLE_MCP), get(HAND.MIDDLE_PIP), get(HAND.MIDDLE_DIP), get(HAND.MIDDLE_TIP)],
    },
    ring: {
      curl: fingerCurl(wrist, get(HAND.RING_MCP), get(HAND.RING_PIP), get(HAND.RING_DIP), get(HAND.RING_TIP)),
      dir: dir(get(HAND.RING_MCP), get(HAND.RING_TIP)),
      joints: [get(HAND.RING_MCP), get(HAND.RING_PIP), get(HAND.RING_DIP), get(HAND.RING_TIP)],
    },
    pinky: {
      curl: fingerCurl(wrist, get(HAND.PINKY_MCP), get(HAND.PINKY_PIP), get(HAND.PINKY_DIP), get(HAND.PINKY_TIP)),
      dir: dir(get(HAND.PINKY_MCP), get(HAND.PINKY_TIP)),
      joints: [get(HAND.PINKY_MCP), get(HAND.PINKY_PIP), get(HAND.PINKY_DIP), get(HAND.PINKY_TIP)],
    },
  };

  // Finger spread: angle between adjacent MCP→TIP directions
  const spreadAngle = (f1, f2) => {
    const d1 = f1.dir, d2 = f2.dir;
    const dot = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
    const m1 = Math.hypot(d1.x, d1.y, d1.z) || 1;
    const m2 = Math.hypot(d2.x, d2.y, d2.z) || 1;
    return Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2))));
  };

  const spread = {
    thumbIndex: spreadAngle(fingers.thumb, fingers.index),
    indexMiddle: spreadAngle(fingers.index, fingers.middle),
    middleRing: spreadAngle(fingers.middle, fingers.ring),
    ringPinky: spreadAngle(fingers.ring, fingers.pinky),
  };

  // Wrist rotation: palm normal direction
  const palmNormal = computePalmNormal(
    get(HAND.WRIST),
    get(HAND.INDEX_MCP),
    get(HAND.PINKY_MCP)
  );

  return {
    handedness, // "Left" or "Right"
    wrist,
    fingers,
    spread,
    palmNormal,
    worldSpace: use3d,
  };
}

function computePalmNormal(wrist, indexMcp, pinkyMcp) {
  // Two vectors on the palm plane
  const v1 = dir(wrist, indexMcp);
  const v2 = dir(wrist, pinkyMcp);

  // Cross product = palm normal
  return {
    x: v1.y * v2.z - v1.z * v2.y,
    y: v1.z * v2.x - v1.x * v2.z,
    z: v1.x * v2.y - v1.y * v2.x,
  };
}

export function logHandData(hand, label) {
  if (!hand) { console.log(`[Hand] ${label}: null`); return; }
  console.log(`=== HAND: ${label} (${hand.handedness}) ===`);
  const f = hand.fingers;
  console.log(
    `curl: thumb:${f.thumb.curl.toFixed(2)} index:${f.index.curl.toFixed(2)}`,
    `mid:${f.middle.curl.toFixed(2)} ring:${f.ring.curl.toFixed(2)} pinky:${f.pinky.curl.toFixed(2)}`
  );
  console.log(
    `spread: TI:${(hand.spread.thumbIndex * 57.3).toFixed(0)}°`,
    `IM:${(hand.spread.indexMiddle * 57.3).toFixed(0)}°`,
    `MR:${(hand.spread.middleRing * 57.3).toFixed(0)}°`,
    `RP:${(hand.spread.ringPinky * 57.3).toFixed(0)}°`
  );
  console.log("========================");
}