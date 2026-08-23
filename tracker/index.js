// Import from the local copy of the vision bundle
import {
  FaceLandmarker,
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
} from "./wasm/vision_bundle.js";

import { extractFace, extractBlendshapes } from "./face.js";
import { extractFullBody } from "./body.js";
import { extractHand } from "./hands.js";
import { FilterPipeline } from "../filters/index.js";

const PRESETS = {
  low: {
    numFaces: 1,
    poseModel: "pose_landmarker_lite.task", // Local file name
    numHands: 0,
    label: "low (desktop/weak GPU)",
  },
  medium: {
    numFaces: 1,
    poseModel: "pose_landmarker_full.task", // Local file name
    numHands: 2,
    label: "medium (good GPU)",
  },
  high: {
    numFaces: 4,
    poseModel: "pose_landmarker_full.task", // Local file name
    numHands: 2,
    label: "high (phone/powerful GPU)",
  },
};

function detectPreset() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return "low";

  const renderer = gl.getParameter(gl.RENDERER) || "";
  const vendor = gl.getParameter(gl.VENDOR) || "";
  const info = (renderer + " " + vendor).toLowerCase();

  console.log("[Tracker] GPU Detected:", renderer);

  const isMobileGPU = /adreno|mali|powervr|apple gpu|img/.test(info);
  const isWeakGPU = /hd 3|hd 4|intel.*hd|radeon.*hd|gma|mesa/.test(info);

  if (isMobileGPU) return "medium"; 
  if (isWeakGPU) return "low";
  return "medium";
}

export class Tracker {
  constructor(presetOverride) {
    this.faceLandmarker = null;
    this.poseLandmarker = null;
    this.handLandmarker = null;
    this.ready = false;
    this.preset = null;

    this.calibration = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    this.enableBody = true;
    this.enableHands = true;
    this.visibilityThreshold = 0.3;

    this.filters = new FilterPipeline();

    this._presetOverride = presetOverride || null;
    this._lastTs = null;
    this._fpsBuffer = [];
    this._initTime = 0;
  }

  async init() {
    this._initTime = performance.now();

    const presetKey = this._presetOverride || detectPreset();
    this.preset = PRESETS[presetKey];
    console.log(`[Tracker] Performance Preset: ${presetKey} — ${this.preset.label}`);

    // Resolve WebAssembly assets from local directory
    const vision = await FilesetResolver.forVisionTasks("./tracker/wasm");

    // Face Landmarker (Local file)
    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "./models/face_landmarker.task",
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: this.preset.numFaces,
    });

    // Pose Landmarker (Local file based on preset)
    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `./models/${this.preset.poseModel}`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });

    // Hand Landmarker (Local file)
    if (this.preset.numHands > 0) {
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "./models/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: this.preset.numHands,
      });
    } else {
      this.enableHands = false;
    }

    const elapsed = ((performance.now() - this._initTime) / 1000).toFixed(1);
    this.ready = true;

    console.log(
      `[Tracker] Offline Initialization Complete in ${elapsed}s: ` +
      `face(${this.preset.numFaces}) + ${this.preset.poseModel}` +
      (this.handLandmarker ? ` + hands(${this.preset.numHands})` : "")
    );
  }

  calibrate(anchor) {
    if (!anchor) return;
    this.calibration = {
      yaw: anchor.yaw, pitch: anchor.pitch, roll: anchor.roll,
      x: anchor.x, y: anchor.y,
    };
  }

  setSmoothing(val) {
    this.filters.setSmoothing(val);
  }

  _pickBestFace(faceRes) {
    const all = faceRes.faceLandmarks;
    if (!all?.length) return -1;
    if (all.length === 1) return 0;

    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < all.length; i++) {
      const lm = all[i];
      const le = lm[33], re = lm[263];
      const eyeDist = Math.hypot(le.x - re.x, le.y - re.y);
      const nose = lm[1];
      const centerDist = Math.hypot(nose.x - 0.5, nose.y - 0.5);
      const score = eyeDist * 3 - centerDist;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return bestIdx;
  }

  process(video, timestamp) {
    if (!this.ready || !video.videoWidth) return null;

    const ts = timestamp / 1000;
    if (this._lastTs !== null) {
      const dt = ts - this._lastTs;
      if (dt > 0 && dt < 0.5) {
        this._fpsBuffer.push(1 / dt);
        if (this._fpsBuffer.length > 30) this._fpsBuffer.shift();
        const avgFps = this._fpsBuffer.reduce((a, b) => a + b, 0) / this._fpsBuffer.length;
        this.filters.setFrequency(avgFps);
      }
    }
    this._lastTs = ts;

    const result = {
      face: null, body: null, blendshapes: null,
      hands: null, facesDetected: 0,
    };

    const faceRes = this.faceLandmarker.detectForVideo(video, timestamp);
    result.facesDetected = faceRes.faceLandmarks?.length || 0;

    const bestIdx = this._pickBestFace(faceRes);
    if (bestIdx >= 0) {
      const rawFace = extractFace(
        faceRes.faceLandmarks[bestIdx],
        faceRes.faceWorldLandmarks?.[bestIdx] || null,
        video,
        this.calibration
      );
      result.face = this.filters.filterFace(rawFace, ts);

      if (faceRes.faceBlendshapes?.[bestIdx]) {
        result.blendshapes = extractBlendshapes(faceRes.faceBlendshapes[bestIdx]);
      }
    }

    if (this.enableBody) {
      const poseRes = this.poseLandmarker.detectForVideo(video, timestamp);
      if (poseRes.landmarks?.length > 0) {
        const rawBody = extractFullBody(
          poseRes.landmarks[0],
          poseRes.worldLandmarks?.[0] || null,
          video,
          this.visibilityThreshold
        );
        result.body = this.filters.filterBody(rawBody, ts);
      }
    }

    if (this.enableHands && this.handLandmarker) {
      const handRes = this.handLandmarker.detectForVideo(video, timestamp);
      if (handRes.landmarks?.length > 0) {
        const rawHands = {};
        for (let i = 0; i < handRes.landmarks.length; i++) {
          const handedness = handRes.handedness?.[i]?.[0]?.categoryName || "Left";
          const worldLm = handRes.worldLandmarks?.[i] || null;
          const hand = extractHand(handRes.landmarks[i], worldLm, handedness);
          if (hand) rawHands[handedness === "Left" ? "left" : "right"] = hand;
        }
        result.hands = this.filters.filterHands(rawHands, ts);
      }
    }

    return result;
  }
}