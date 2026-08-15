import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs";

import { extractFace, extractBlendshapes } from "./face.js";
import { extractFullBody, logRawPose } from "./body.js";

export class Tracker {
  constructor() {
    this.faceLandmarker = null;
    this.poseLandmarker = null;
    this.ready = false;

    this.calibration = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    this.enableBody = true;
    this.enableBg = false;
    this.smoothing = 0.5;
    this.visibilityThreshold = 0.3;

    this.prevFace = null;
    this.prevBody = null;
    this._loggedRaw = false;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
    );

    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1,
    });

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });

    this.ready = true;
    console.log("[Tracker] Initialized");
  }

  calibrate(anchor) {
    if (!anchor) return;
    this.calibration = { yaw: anchor.yaw, pitch: anchor.pitch, roll: anchor.roll, x: anchor.x, y: anchor.y };
  }

  process(video, timestamp) {
    if (!this.ready || !video.videoWidth) return null;

    const result = { face: null, body: null, blendshapes: null };

    // Face
    const faceRes = this.faceLandmarker.detectForVideo(video, timestamp);
    if (faceRes.faceLandmarks?.length > 0) {
      result.face = extractFace(
        faceRes.faceLandmarks[0],
        faceRes.faceWorldLandmarks?.[0] || null,
        video,
        this.calibration
      );
      if (faceRes.faceBlendshapes?.length > 0) {
        result.blendshapes = extractBlendshapes(faceRes.faceBlendshapes[0]);
      }
    }

    // Pose
    if (this.enableBody) {
      const poseRes = this.poseLandmarker.detectForVideo(video, timestamp);
      if (poseRes.landmarks?.length > 0) {
        const pl = poseRes.landmarks[0];
        const pwl = poseRes.worldLandmarks?.length > 0 ? poseRes.worldLandmarks[0] : null;

        if (!this._loggedRaw) {
          this._loggedRaw = true;
          logRawPose(pl, pwl);
        }

        result.body = extractFullBody(pl, pwl, video, this.visibilityThreshold);
      }
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
      confidence: f.confidence,
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
        s.rotations[k] = l(p.rotations[k], b.rotations[k]);
      }
      for (const k of ["leftUpperArmDir", "leftLowerArmDir", "rightUpperArmDir", "rightLowerArmDir",
                        "leftUpperLegDir", "leftLowerLegDir", "rightUpperLegDir", "rightLowerLegDir"]) {
        s.rotations[k] = ld(p.rotations[k], b.rotations[k]);
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