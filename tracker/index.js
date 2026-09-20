import {
  FaceLandmarker, PoseLandmarker, HandLandmarker, FilesetResolver,
} from "./wasm/vision_bundle.js";
import { extractFace, extractBlendshapes } from "./face.js";
import { extractFullBody } from "./body.js";
import { extractHand } from "./hands.js";
import { FilterPipeline } from "../filters/index.js";
import { computeHandROIs, remapLandmarks } from "./roi.js";

const PRESETS = {
  low:    { numFaces: 1, poseModel: "pose_landmarker_lite.task", numHands: 0, label: "low (weak GPU)" },
  medium: { numFaces: 1, poseModel: "pose_landmarker_full.task", numHands: 2, label: "medium" },
  high:   { numFaces: 4, poseModel: "pose_landmarker_full.task", numHands: 2, label: "high" },
};

function realGPUName(gl) {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (!ext) return gl.getParameter(gl.RENDERER) || "";
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "";
}

function detectPreset() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return "low";
  const info = realGPUName(gl).toLowerCase();
  console.log("[Tracker] GPU:", info);
  const lost = gl.getExtension("WEBGL_lose_context");
  lost?.loseContext();

  if (/adreno|mali|powervr|apple gpu/.test(info)) return "medium";
  if (/hd 3|hd 4|intel.*hd|gma|mesa|swiftshader/.test(info)) return "low";
  return "medium";
}

async function createLandmarker(Ctor, vision, modelPath, extra) {
  try {
    return await Ctor.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPath, delegate: "GPU" }, ...extra });
  } catch (err) {
    console.warn(`[Tracker] GPU delegate failed for ${modelPath}, falling back to CPU:`, err.message);
    return Ctor.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPath, delegate: "CPU" }, ...extra });
  }
}

export class Tracker {
  constructor(presetOverride) {
    this.faceLandmarker = null;
    this.poseLandmarker = null;
    this._handTrackers = { left: null, right: null };
    this.ready = false;
    this.preset = null;

    this.calibration = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    this.enableBody = true;
    this.enableHands = true;
    this.visibilityThreshold = 0.3;

    this.filters = new FilterPipeline();
    this._handROIs = { left: null, right: null };
    this._handROILostFrames = { left: 0, right: 0 };
    this._handROIEnabled = false;
    this._cropCanvas = null;

    this._presetOverride = presetOverride || null;
    this._lastTs = null;
    this._fpsBuffer = [];
    this._initTime = 0;
  }

  async init() {
    this._initTime = performance.now();
    const presetKey = this._presetOverride || detectPreset();
    this.preset = PRESETS[presetKey];
    console.log(`[Tracker] Preset: ${presetKey} — ${this.preset.label}`);

    const vision = await FilesetResolver.forVisionTasks("./tracker/wasm");

    this.faceLandmarker = await createLandmarker(FaceLandmarker, vision, "./models/face_landmarker.task", {
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: this.preset.numFaces,
    });

    this.poseLandmarker = await createLandmarker(PoseLandmarker, vision, `./models/${this.preset.poseModel}`, {
      runningMode: "VIDEO",
      numPoses: 1,
    });

    if (this.preset.numHands > 0) {
      const handOpts = { runningMode: "VIDEO", numHands: 1 };
      this._handTrackers.left  = await createLandmarker(HandLandmarker, vision, "./models/hand_landmarker.task", handOpts);
      this._handTrackers.right = await createLandmarker(HandLandmarker, vision, "./models/hand_landmarker.task", handOpts);
      this._handROIEnabled = presetKey !== "low";
      this._cropCanvas = document.createElement("canvas");
      this._cropCanvas.width = 256;
      this._cropCanvas.height = 256;
      if (this._handROIEnabled) console.log("[Tracker] Hand ROI cascade enabled");
    } else {
      this.enableHands = false;
    }

    const elapsed = ((performance.now() - this._initTime) / 1000).toFixed(1);
    this.ready = true;
    console.log(`[Tracker] Offline init ${elapsed}s: face(${this.preset.numFaces}) + ${this.preset.poseModel}` +
      (this.preset.numHands ? ` + hands(2×1)` : ""));
  }

  calibrate(anchor) {
    if (!anchor) return;
    this.calibration = { yaw: anchor.yaw, pitch: anchor.pitch, roll: anchor.roll, x: anchor.x, y: anchor.y };
  }

  setSmoothing(val) { this.filters.setSmoothing(val); }

  _pickBestFace(faceRes) {
    const all = faceRes.faceLandmarks;
    if (!all?.length) return -1;
    if (all.length === 1) return 0;
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < all.length; i++) {
      const lm = all[i];
      const eyeDist = Math.hypot(lm[33].x - lm[263].x, lm[33].y - lm[263].y);
      const centerDist = Math.hypot(lm[1].x - 0.5, lm[1].y - 0.5);
      const score = eyeDist * 3 - centerDist;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return bestIdx;
  }

  _detectHandSide(side, video, ts) {
    const inst = this._handTrackers[side];
    if (!inst) return null;
    const roi = this._handROIs[side];
    const useCrop = this._handROIEnabled && roi && roi.confidence > 0.6 &&
                    this._handROILostFrames[side] <= 3;

    let res;
    if (useCrop) {
      const { crop } = roi;
      const ctx = this._cropCanvas.getContext("2d");
      ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, 256, 256);
      res = inst.detectForVideo(this._cropCanvas, ts);
      if (res.landmarks?.length) {
        return extractHand(
          res.landmarks[0],
          res.worldLandmarks?.[0] || null,
          side === "left" ? "Left" : "Right",
          { remap: (lms) => remapLandmarks(lms, roi, video.videoWidth, video.videoHeight) },
        );
      }
      this._handROILostFrames[side]++;
      return null;
    }

    res = inst.detectForVideo(video, ts);
    if (!res.landmarks?.length) return null;
    let best = -1, bestScore = -1;
    for (let i = 0; i < res.landmarks.length; i++) {
      const label = res.handedness?.[i]?.[0]?.categoryName;
      if ((side === "left") !== (label === "Left")) continue;
      const score = res.handedness?.[i]?.[0]?.score ?? 0;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return null;
    return extractHand(res.landmarks[best], res.worldLandmarks?.[best] || null,
                       side === "left" ? "Left" : "Right");
  }

  process(video, timestamp) {
    if (!this.ready || !video.videoWidth) return null;

    const ts = timestamp / 1000;
    if (this._lastTs !== null) {
      const dt = ts - this._lastTs;
      if (dt > 0 && dt < 0.5) {
        this._fpsBuffer.push(1 / dt);
        if (this._fpsBuffer.length > 30) this._fpsBuffer.shift();
        this.filters.setFrequency(this._fpsBuffer.reduce((a, b) => a + b, 0) / this._fpsBuffer.length);
      }
    }
    this._lastTs = ts;

    const result = { face: null, body: null, blendshapes: null, hands: null, facesDetected: 0 };

    const faceRes = this.faceLandmarker.detectForVideo(video, timestamp);
    result.facesDetected = faceRes.faceLandmarks?.length || 0;
    const bestIdx = this._pickBestFace(faceRes);
    if (bestIdx >= 0) {
      const rawFace = extractFace(faceRes.faceLandmarks[bestIdx],
        faceRes.faceWorldLandmarks?.[bestIdx] || null, video, this.calibration);
      result.face = this.filters.filterFace(rawFace, ts);
      if (faceRes.faceBlendshapes?.[bestIdx]) {
        result.blendshapes = extractBlendshapes(faceRes.faceBlendshapes[bestIdx]);
      }
    }

    if (this.enableBody) {
      const poseRes = this.poseLandmarker.detectForVideo(video, timestamp);
      if (poseRes.landmarks?.length > 0) {
        const rawBody = extractFullBody(poseRes.landmarks[0],
          poseRes.worldLandmarks?.[0] || null, video, this.visibilityThreshold);
        result.body = this.filters.filterBody(rawBody, ts);

        if (this._handROIEnabled && result.body) {
          const rois = computeHandROIs(result.body, video.videoWidth, video.videoHeight);
          for (const side of ["left", "right"]) {
            if (rois[side] && rois[side].confidence > 0.6) {
              this._handROIs[side] = rois[side];
              this._handROILostFrames[side] = 0;
            } else {
              this._handROIs[side] = this._handROIs[side] || rois[side];
              this._handROILostFrames[side]++;
            }
          }
        }
      }
    }

    if (this.enableHands && this.preset.numHands > 0) {
      const hands = {};
      for (const side of ["left", "right"]) {
        const hand = this._detectHandSide(side, video, timestamp);
        if (hand) hands[side] = hand;
      }
      result.hands = this.filters.filterHands(hands, ts);
    }

    return result;
  }

  dispose() {
    this.faceLandmarker?.close?.();
    this.poseLandmarker?.close?.();
    this._handTrackers.left?.close?.();
    this._handTrackers.right?.close?.();
    this.faceLandmarker = this.poseLandmarker = null;
    this._handTrackers = { left: null, right: null };
    this._cropCanvas = null;
    this.ready = false;
  }
}
