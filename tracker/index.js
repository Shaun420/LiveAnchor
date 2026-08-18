import {
  FaceLandmarker,
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs";

import { extractFace, extractBlendshapes } from "./face.js";
import { extractFullBody } from "./body.js";
import { extractHand, logHandData } from "./hands.js";
import { initSegmenter, segmentFrame, isSegmenterReady } from "./segmenter.js";

export class Tracker {
  constructor() {
    this.faceLandmarker = null;
    this.poseLandmarker = null;
    this.handLandmarker = null;
    this.ready = false;

    this.calibration = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    this.enableBody = true;
    this.enableHands = true;
    this.enablePrivacy = true;
    this.smoothing = 0.5;
    this.visibilityThreshold = 0.3;

    // Segmentation runs every N frames to save performance
    this.segSkipFrames = 2;
    this._segFrameCount = 0;
    this._lastMask = null;

    this.prevFace = null;
    this.prevBody = null;
    this._loggedHands = false;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
    );

    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 4,
    });

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });

    if (this.enableHands) {
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
    }

    // Segmenter for privacy mask
    if (this.enablePrivacy) {
      try {
        await initSegmenter();
        console.log("[Tracker] Segmenter ready");
      } catch (err) {
        console.warn("[Tracker] Segmenter failed:", err.message);
      }
    }

    this.ready = true;
    console.log("[Tracker] Init: face(4) + pose_full" +
      (this.handLandmarker ? " + hands" : "") +
      (isSegmenterReady() ? " + segmenter" : "")
    );
  }

  calibrate(anchor) {
    if (!anchor) return;
    this.calibration = {
      yaw: anchor.yaw, pitch: anchor.pitch, roll: anchor.roll,
      x: anchor.x, y: anchor.y,
    };
  }

  _pickBestFace(faceRes) {
    const all = faceRes.faceLandmarks;
    if (!all || all.length === 0) return -1;
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

    const result = {
      face: null, body: null, blendshapes: null,
      hands: null, facesDetected: 0, mask: null,
    };

    // --- Face ---
    const faceRes = this.faceLandmarker.detectForVideo(video, timestamp);
    result.facesDetected = faceRes.faceLandmarks?.length || 0;

    const bestIdx = this._pickBestFace(faceRes);
    if (bestIdx >= 0) {
      result.face = extractFace(
        faceRes.faceLandmarks[bestIdx],
        faceRes.faceWorldLandmarks?.[bestIdx] || null,
        video,
        this.calibration
      );
      if (faceRes.faceBlendshapes?.[bestIdx]) {
        result.blendshapes = extractBlendshapes(faceRes.faceBlendshapes[bestIdx]);
      }
    }

    // --- Pose ---
    if (this.enableBody) {
      const poseRes = this.poseLandmarker.detectForVideo(video, timestamp);
      if (poseRes.landmarks?.length > 0) {
        result.body = extractFullBody(
          poseRes.landmarks[0],
          poseRes.worldLandmarks?.[0] || null,
          video,
          this.visibilityThreshold
        );
      }
    }

    // --- Hands ---
    if (this.handLandmarker && this.enableHands) {
      const handRes = this.handLandmarker.detectForVideo(video, timestamp);
      if (handRes.landmarks?.length > 0) {
        result.hands = {};
        for (let i = 0; i < handRes.landmarks.length; i++) {
          const handedness = handRes.handedness?.[i]?.[0]?.categoryName || (i === 0 ? "Left" : "Right");
          const worldLm = handRes.worldLandmarks?.[i] || null;
          const hand = extractHand(handRes.landmarks[i], worldLm, handedness);
          if (hand) {
            const key = handedness === "Left" ? "left" : "right";
            result.hands[key] = hand;
            if (!this._loggedHands) logHandData(hand, key);
          }
        }
        if (!this._loggedHands && Object.keys(result.hands).length > 0) {
          this._loggedHands = true;
        }
      }
    }

    // --- Segmentation (throttled) ---
    if (isSegmenterReady() && this.enablePrivacy) {
      this._segFrameCount++;
      if (this._segFrameCount >= this.segSkipFrames) {
        this._segFrameCount = 0;
        this._lastMask = segmentFrame(video, timestamp);
      }
      result.mask = this._lastMask;
    }

    // Smoothing
    if (result.face) result.face = this._smoothFace(result.face);
    if (result.body) result.body = this._smoothBody(result.body);

    return result;
  }

  _smoothFace(f) {
    if (!this.prevFace) { this.prevFace = { ...f }; return f; }
    const a = 0.15 + (1 - this.smoothing) * 0.6;
    const l = (p, n) => p + (n - p) * a;
    const s = {
      x: l(this.prevFace.x, f.x), y: l(this.prevFace.y, f.y),
      xNorm: l(this.prevFace.xNorm, f.xNorm), yNorm: l(this.prevFace.yNorm, f.yNorm),
      eyeDistance: l(this.prevFace.eyeDistance, f.eyeDistance),
      eyeDistanceNorm: l(this.prevFace.eyeDistanceNorm, f.eyeDistanceNorm),
      yaw: l(this.prevFace.yaw, f.yaw), pitch: l(this.prevFace.pitch, f.pitch),
      roll: l(this.prevFace.roll, f.roll), mouthOpen: l(this.prevFace.mouthOpen, f.mouthOpen),
      confidence: f.confidence, gaze: f.gaze,
    };
    this.prevFace = s;
    return s;
  }

  _smoothBody(b) {
    if (!this.prevBody) { this.prevBody = this._cloneBody(b); return b; }
    const a = 0.25 + (1 - this.smoothing) * 0.5;
    const l = (p, n) => p + (n - p) * a;
    const ld = (pd, nd) => (!pd || !nd) ? nd : ({ x: l(pd.x, nd.x), y: l(pd.y, nd.y), z: l(pd.z, nd.z) });
    const p = this.prevBody;

    const s = {
      ...b,
      shoulderMidX: l(p.shoulderMidX, b.shoulderMidX),
      shoulderMidY: l(p.shoulderMidY, b.shoulderMidY),
      shoulderMidXNorm: l(p.shoulderMidXNorm, b.shoulderMidXNorm),
      shoulderMidYNorm: l(p.shoulderMidYNorm, b.shoulderMidYNorm),
      shoulderWidth: l(p.shoulderWidth, b.shoulderWidth),
      shoulderWidthNorm: l(p.shoulderWidthNorm, b.shoulderWidthNorm),
      shoulderTilt: l(p.shoulderTilt, b.shoulderTilt),
      hipTilt: l(p.hipTilt || 0, b.hipTilt || 0),
    };

    if (b.torso && p.torso) {
      s.torso = { ...b.torso, yaw: l(p.torso.yaw, b.torso.yaw), pitch: l(p.torso.pitch, b.torso.pitch), roll: l(p.torso.roll, b.torso.roll) };
    }

    if (b.rotations && p.rotations) {
      s.rotations = { ...b.rotations };
      for (const k of ["leftElbowAngle", "rightElbowAngle", "leftKneeAngle", "rightKneeAngle"]) {
        if (b.rotations[k] !== undefined && p.rotations[k] !== undefined) {
          s.rotations[k] = l(p.rotations[k], b.rotations[k]);
        }
      }
      for (const k of ["leftUpperArmDir", "leftLowerArmDir", "rightUpperArmDir", "rightLowerArmDir",
                        "leftUpperLegDir", "leftLowerLegDir", "rightUpperLegDir", "rightLowerLegDir"]) {
        if (b.rotations[k]) s.rotations[k] = ld(p.rotations[k], b.rotations[k]);
      }
    }

    this.prevBody = this._cloneBody(s);
    return s;
  }

  _cloneBody(b) {
    return {
      shoulderMidX: b.shoulderMidX, shoulderMidY: b.shoulderMidY,
      shoulderMidXNorm: b.shoulderMidXNorm, shoulderMidYNorm: b.shoulderMidYNorm,
      shoulderWidth: b.shoulderWidth, shoulderWidthNorm: b.shoulderWidthNorm,
      shoulderTilt: b.shoulderTilt, hipTilt: b.hipTilt,
      torso: b.torso ? { ...b.torso } : null,
      rotations: b.rotations ? { ...b.rotations } : null,
    };
  }
}