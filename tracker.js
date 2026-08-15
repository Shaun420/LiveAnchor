import {
  FaceLandmarker,
  PoseLandmarker,
  ImageSegmenter,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs";

// Key landmark indices
const IDX = {
  NOSE: 1,
  LEFT_EYE_OUTER: 33,
  RIGHT_EYE_OUTER: 263,
  LEFT_EYE_TOP: 159,
  LEFT_EYE_BOTTOM: 145,
  RIGHT_EYE_TOP: 386,
  RIGHT_EYE_BOTTOM: 374,
  CHIN: 152,
  FOREHEAD: 10,
  UPPER_LIP: 13,
  LOWER_LIP: 14,
  LEFT_EAR: 234,
  RIGHT_EAR: 454,
};

export class Tracker {
  constructor() {
    this.faceLandmarker = null;
    this.poseLandmarker = null;
    this.segmenter = null;
    this.ready = false;

    // Calibration offsets
    this.calibration = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };

    // Settings
    this.enableBody = true;
    this.enableBg = false;
    this.smoothing = 0.5;

    // Smoothing state
    this.prevFace = null;
    this.prevBody = null;
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
      numFaces: 1,
    });

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });

    this.ready = true;
  }

  calibrate(anchor) {
    if (!anchor) return;
    this.calibration = {
      yaw: anchor.yaw,
      pitch: anchor.pitch,
      roll: anchor.roll,
      x: anchor.x,
      y: anchor.y,
    };
  }

  process(video, timestamp) {
    if (!this.ready || !video.videoWidth) return null;

    const w = video.videoWidth;
    const h = video.videoHeight;

    const result = {
      face: null,
      body: null,
      segmentation: null,
      blendshapes: null,
    };

    // --- Face tracking ---
    const faceResults = this.faceLandmarker.detectForVideo(video, timestamp);

    if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
      const landmarks = faceResults.faceLandmarks[0];
      const worldLandmarks = faceResults.faceWorldLandmarks
        ? faceResults.faceWorldLandmarks[0]
        : null;

      result.face = this._extractFace(landmarks, worldLandmarks, video);

      if (
        faceResults.faceBlendshapes &&
        faceResults.faceBlendshapes.length > 0
      ) {
        result.blendshapes = this._extractBlendshapes(
          faceResults.faceBlendshapes[0]
        );
      }
    }

    // --- Body tracking ---
    if (this.enableBody && result.face) {
      const poseResults = this.poseLandmarker.detectForVideo(video, timestamp);
      if (poseResults.landmarks && poseResults.landmarks.length > 0) {
        result.body = this._extractBody(
          poseResults.landmarks[0],
          video,
          result.face
        );
      }

      // Synthesize from face if real body not available
      if (!result.body) {
        result.body = this._synthesizeBody(result.face, w, h);
      }
    }

    // --- Smoothing ---
    if (result.face) {
      result.face = this._smoothFace(result.face);
    }
    if (result.body) {
      result.body = this._smoothBody(result.body);
    }

    return result;
  }

  _synthesizeBody(face, w, h) {
    const shoulderY = face.y + face.eyeDistance * 2.5;
    const shoulderHalfWidth = face.eyeDistance * 2.2;

    const leftShoulder = { x: face.x - shoulderHalfWidth, y: shoulderY };
    const rightShoulder = { x: face.x + shoulderHalfWidth, y: shoulderY };

    const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
    const shoulderWidth = shoulderHalfWidth * 2;
    const shoulderTilt = 0;

    return {
      leftShoulder,
      rightShoulder,
      leftElbow: {
        x: face.x - shoulderHalfWidth * 1.3,
        y: shoulderY + face.eyeDistance * 2,
      },
      rightElbow: {
        x: face.x + shoulderHalfWidth * 1.3,
        y: shoulderY + face.eyeDistance * 2,
      },
      leftWrist: {
        x: face.x - shoulderHalfWidth * 1.5,
        y: shoulderY + face.eyeDistance * 4,
      },
      rightWrist: {
        x: face.x + shoulderHalfWidth * 1.5,
        y: shoulderY + face.eyeDistance * 4,
      },
      nose: { x: face.x, y: face.y },

      // Processed shoulder data
      shoulderMidX,
      shoulderMidY,
      shoulderMidXNorm: shoulderMidX / w,
      shoulderMidYNorm: shoulderMidY / h,
      shoulderWidth,
      shoulderWidthNorm: shoulderWidth / w,
      shoulderTilt,

      synthesized: true,
    };
  }

  _get2D(landmarks, idx, w, h) {
    const lm = landmarks[idx];
    return { x: lm.x * w, y: lm.y * h, z: lm.z };
  }

  _get3D(worldLandmarks, idx) {
    const lm = worldLandmarks[idx];
    return { x: lm.x, y: lm.y, z: lm.z };
  }

  _dist2D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _extractFace(landmarks, worldLandmarks, video) {
    const w = video.videoWidth;
    const h = video.videoHeight;

    const leftEye = this._get2D(landmarks, IDX.LEFT_EYE_OUTER, w, h);
    const rightEye = this._get2D(landmarks, IDX.RIGHT_EYE_OUTER, w, h);
    const nose = this._get2D(landmarks, IDX.NOSE, w, h);
    const chin = this._get2D(landmarks, IDX.CHIN, w, h);
    const forehead = this._get2D(landmarks, IDX.FOREHEAD, w, h);
    const upperLip = this._get2D(landmarks, IDX.UPPER_LIP, w, h);
    const lowerLip = this._get2D(landmarks, IDX.LOWER_LIP, w, h);

    const eyeCenterX = (leftEye.x + rightEye.x) / 2;
    const eyeCenterY = (leftEye.y + rightEye.y) / 2;

    const eyeDistance = this._dist2D(leftEye, rightEye);

    // Roll
    const dx = rightEye.x - leftEye.x;
    const dy = rightEye.y - leftEye.y;
    const roll = Math.atan2(dy, dx);

    // Yaw and Pitch
    let yaw = 0;
    let pitch = 0;

    if (worldLandmarks) {
      const nose3D = this._get3D(worldLandmarks, IDX.NOSE);
      const leftEye3D = this._get3D(worldLandmarks, IDX.LEFT_EYE_OUTER);
      const rightEye3D = this._get3D(worldLandmarks, IDX.RIGHT_EYE_OUTER);

      const eyeCenter3D = {
        x: (leftEye3D.x + rightEye3D.x) / 2,
        y: (leftEye3D.y + rightEye3D.y) / 2,
        z: (leftEye3D.z + rightEye3D.z) / 2,
      };

      const fwd = {
        x: nose3D.x - eyeCenter3D.x,
        y: nose3D.y - eyeCenter3D.y,
        z: nose3D.z - eyeCenter3D.z,
      };
      const fwdLen = Math.hypot(fwd.x, fwd.y, fwd.z) || 1;
      fwd.x /= fwdLen;
      fwd.y /= fwdLen;
      fwd.z /= fwdLen;

      yaw = Math.atan2(fwd.x, fwd.z);
      pitch = Math.asin(Math.max(-1, Math.min(1, -fwd.y)));
    } else {
      const eyeMid = eyeCenterX;
      const faceWidth = this._dist2D(
        this._get2D(landmarks, IDX.LEFT_EAR, w, h),
        this._get2D(landmarks, IDX.RIGHT_EAR, w, h)
      );
      yaw = ((nose.x - eyeMid) / (faceWidth || 1)) * 1.2;
      pitch =
        ((nose.y - eyeCenterY) / (this._dist2D(forehead, chin) || 1)) * 0.8;
    }

    const mouthOpen = this._dist2D(upperLip, lowerLip) / (eyeDistance || 1);

    return {
      x: eyeCenterX,
      y: eyeCenterY,
      xNorm: eyeCenterX / w,
      yNorm: eyeCenterY / h,
      eyeDistance,
      eyeDistanceNorm: eyeDistance / w,
      yaw: yaw - this.calibration.yaw,
      pitch: pitch - this.calibration.pitch,
      roll: roll - this.calibration.roll,
      mouthOpen,
      confidence: 1.0,
    };
  }

  _extractBlendshapes(bsData) {
    const map = {};
    if (bsData.categories) {
      for (const cat of bsData.categories) {
        map[cat.categoryName] = cat.score;
      }
    }
    return map;
  }

  _extractBody(landmarks, video, face) {
    if (!face) return null;

    const w = video.videoWidth;
    const h = video.videoHeight;

    const get = (idx) => ({
      x: landmarks[idx].x * w,
      y: landmarks[idx].y * h,
      visibility: landmarks[idx].visibility || 0,
    });

    const leftShoulder = get(11);
    const rightShoulder = get(12);
    const leftElbow = get(13);
    const rightElbow = get(14);

    // Validate: shoulders visible and below face
    if (
      leftShoulder.x < 0 ||
      leftShoulder.x > w ||
      rightShoulder.x < 0 ||
      rightShoulder.x > w ||
      leftShoulder.y < face.y ||
      rightShoulder.y < face.y
    ) {
      return null;
    }

    // Compute shoulder metrics
    const shoulderDx = rightShoulder.x - leftShoulder.x;
    const shoulderDy = rightShoulder.y - leftShoulder.y;
    const shoulderWidth = Math.hypot(shoulderDx, shoulderDy);
    const shoulderTilt = Math.atan2(shoulderDy, shoulderDx);

    const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;

    return {
      leftShoulder,
      rightShoulder,
      leftElbow,
      rightElbow,
      leftWrist: get(15),
      rightWrist: get(16),
      nose: get(0),

      // Processed shoulder data for avatar
      shoulderMidX,
      shoulderMidY,
      shoulderMidXNorm: shoulderMidX / w,
      shoulderMidYNorm: shoulderMidY / h,
      shoulderWidth,
      shoulderWidthNorm: shoulderWidth / w,
      shoulderTilt,

      synthesized: false,
    };
  }

  _smoothFace(face) {
    if (!this.prevFace) {
      this.prevFace = { ...face };
      return face;
    }

    const alpha = 0.15 + (1 - this.smoothing) * 0.6;
    const lerp = (a, b) => a + (b - a) * alpha;

    const smoothed = {
      x: lerp(this.prevFace.x, face.x),
      y: lerp(this.prevFace.y, face.y),
      xNorm: lerp(this.prevFace.xNorm, face.xNorm),
      yNorm: lerp(this.prevFace.yNorm, face.yNorm),
      eyeDistance: lerp(this.prevFace.eyeDistance, face.eyeDistance),
      eyeDistanceNorm: lerp(this.prevFace.eyeDistanceNorm, face.eyeDistanceNorm),
      yaw: lerp(this.prevFace.yaw, face.yaw),
      pitch: lerp(this.prevFace.pitch, face.pitch),
      roll: lerp(this.prevFace.roll, face.roll),
      mouthOpen: lerp(this.prevFace.mouthOpen, face.mouthOpen),
      confidence: face.confidence,
    };

    this.prevFace = smoothed;
    return smoothed;
  }

  _smoothBody(body) {
    if (!this.prevBody) {
      this.prevBody = { ...body };
      return body;
    }

    // Faster alpha for body — less lag on shoulder movement
    const alpha = 0.25 + (1 - this.smoothing) * 0.5;
    const lerp = (a, b) => a + (b - a) * alpha;

    const smoothed = {
      ...body,
      shoulderMidX: lerp(this.prevBody.shoulderMidX, body.shoulderMidX),
      shoulderMidY: lerp(this.prevBody.shoulderMidY, body.shoulderMidY),
      shoulderMidXNorm: lerp(this.prevBody.shoulderMidXNorm, body.shoulderMidXNorm),
      shoulderMidYNorm: lerp(this.prevBody.shoulderMidYNorm, body.shoulderMidYNorm),
      shoulderWidth: lerp(this.prevBody.shoulderWidth, body.shoulderWidth),
      shoulderWidthNorm: lerp(this.prevBody.shoulderWidthNorm, body.shoulderWidthNorm),
      shoulderTilt: lerp(this.prevBody.shoulderTilt, body.shoulderTilt),
      leftShoulder: {
        x: lerp(this.prevBody.leftShoulder.x, body.leftShoulder.x),
        y: lerp(this.prevBody.leftShoulder.y, body.leftShoulder.y),
      },
      rightShoulder: {
        x: lerp(this.prevBody.rightShoulder.x, body.rightShoulder.x),
        y: lerp(this.prevBody.rightShoulder.y, body.rightShoulder.y),
      },
    };

    this.prevBody = smoothed;
    return smoothed;
  }
}