// lifting/normalize.js
// MediaPipe 33-pose -> VideoPose3D COCO-17 normalization
// Root-centered (mid-hip), scale-normalized (torso length), Y-flipped.

// COCO-17 joint order -> MediaPipe 33 indices
export const COCO_TO_MP = [
  0,   // nose
  2,   // left_eye
  5,   // right_eye
  7,   // left_ear
  8,   // right_ear
  11,  // left_shoulder
  12,  // right_shoulder
  13,  // left_elbow
  14,  // right_elbow
  15,  // left_wrist
  16,  // right_wrist
  23,  // left_hip
  24,  // right_hip
  25,  // left_knee
  26,  // right_knee
  27,  // left_ankle
  28   // right_ankle
];

const REQUIRED_ROOT = [23, 24];      // hips for root
const REQUIRED_SCALE = [11, 12];     // shoulders for torso length
const MIN_VISIBILITY_ROOT = 0.5;
const MIN_VISIBILITY_SCALE = 0.5;
const MIN_VISIBILITY_JOINT = 0.3;
const MIN_TORSO_LEN = 10;            // pixels
const NORMALIZATION_FACTOR = 2.0;    // maps torsoLen -> 1.0 in normalized space

/**
 * Normalize filtered MediaPipe pose landmarks for VideoPose3D input.
 * @param {Object} body - Filtered body data with landmarks array
 * @param {number} frameW - Source frame width
 * @param {number} frameH - Source frame height
 * @returns {Float32Array(34) | null} 17 joints * (x,y) normalized, or null if invalid
 */
export function normalizeForVideoPose3D(body, frameW, frameH) {
  const lm = body.landmarks || body.poseLandmarks || [];
  if (!lm || lm.length < 33) return null;

  const get = (idx) => lm[idx] ? { x: lm[idx].x, y: lm[idx].y, z: lm[idx].z, visibility: lm[idx].visibility } : null;

  // 1. Root = mid-hip (frame pixels, Y-down)
  const hipL = get(REQUIRED_ROOT[0]);
  const hipR = get(REQUIRED_ROOT[1]);
  if (!hipL || !hipR || hipL.visibility < MIN_VISIBILITY_ROOT || hipR.visibility < MIN_VISIBILITY_ROOT) {
    return null;
  }
  const rootX = (hipL.x + hipR.x) * 0.5 * frameW;
  const rootY = (hipL.y + hipR.y) * 0.5 * frameH;

  // 2. Scale = torso length (shoulderMid -> hipMid) in frame pixels
  const shL = get(REQUIRED_SCALE[0]);
  const shR = get(REQUIRED_SCALE[1]);
  if (!shL || !shR || shL.visibility < MIN_VISIBILITY_SCALE || shR.visibility < MIN_VISIBILITY_SCALE) {
    return null;
  }
  const shoulderMidX = (shL.x + shR.x) * 0.5 * frameW;
  const shoulderMidY = (shL.y + shR.y) * 0.5 * frameH;
  const torsoLen = Math.hypot(shoulderMidX - rootX, shoulderMidY - rootY);
  if (torsoLen < MIN_TORSO_LEN) return null;

  const scale = NORMALIZATION_FACTOR / torsoLen;

  // 3. Build 17x2 normalized output (COCO order)
  const out = new Float32Array(34);
  for (let i = 0; i < 17; i++) {
    const src = get(COCO_TO_MP[i]);
    if (!src || src.visibility < MIN_VISIBILITY_JOINT) {
      // Missing joint -> place at root (TCN will interpolate)
      out[i * 2] = 0;
      out[i * 2 + 1] = 0;
    } else {
      // Convert to frame pixels, then normalize, flip Y (MediaPipe Y-down -> model Y-up)
      const px = src.x * frameW;
      const py = src.y * frameH;
      out[i * 2] = (px - rootX) * scale;
      out[i * 2 + 1] = -(py - rootY) * scale;
    }
  }
  return out;
}

/**
 * Ring buffer for VideoPose3D temporal receptive field (27 frames).
 */
export class VideoPose3DBuffer {
  constructor(size = 27) {
    this.size = size;
    this.buffer = [];
  }

  push(frame34) {
    this.buffer.push(frame34);
    if (this.buffer.length > this.size) this.buffer.shift();
  }

  isReady() {
    return this.buffer.length === this.size;
  }

  /** Returns tensor [1, 27, 17, 2] or null if not full */
  getTensor(ort) {
    if (!this.isReady()) return null;
    const flat = new Float32Array(this.size * 34);
    this.buffer.forEach((frame, t) => flat.set(frame, t * 34));
    return new ort.Tensor('float32', flat, [1, this.size, 17, 2]);
  }

  clear() { this.buffer = []; }
}

/**
 * Sign verification helper for manual calibration.
 * Call with normalized output to verify coordinate conventions.
 * @param {Float32Array} normalized34
 * @returns {Object} Human-readable joint positions
 */
export function debugNormalized(normalized34) {
  const names = [
    'nose', 'L_eye', 'R_eye', 'L_ear', 'R_ear',
    'L_shoulder', 'R_shoulder', 'L_elbow', 'R_elbow',
    'L_wrist', 'R_wrist', 'L_hip', 'R_hip',
    'L_knee', 'R_knee', 'L_ankle', 'R_ankle'
  ];
  const obj = {};
  for (let i = 0; i < 17; i++) {
    obj[names[i]] = { x: normalized34[i*2], y: normalized34[i*2+1] };
  }
  return obj;
}