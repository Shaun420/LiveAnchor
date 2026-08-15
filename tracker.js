import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs";

const IDX = {
  NOSE: 1,
  LEFT_EYE_OUTER: 33,
  RIGHT_EYE_OUTER: 263,
  CHIN: 152,
  FOREHEAD: 10,
  UPPER_LIP: 13,
  LOWER_LIP: 14,
  LEFT_EAR: 234,
  RIGHT_EAR: 454,
};

// MediaPipe Pose landmark indices
const POSE = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};

export class Tracker {
  constructor() {
    this.faceLandmarker = null;
    this.poseLandmarker = null;
    this.ready = false;

    this.calibration = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };

    this.enableBody = true;
    this.enableBg = false;
    this.smoothing = 0.5;

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
      blendshapes: null,
    };

    // --- Face ---
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

    // --- Pose ---
    if (this.enableBody) {
      const poseResults = this.poseLandmarker.detectForVideo(video, timestamp);

      if (poseResults.landmarks && poseResults.landmarks.length > 0) {
        const poseLandmarks = poseResults.landmarks[0];
        const poseWorldLandmarks =
          poseResults.worldLandmarks && poseResults.worldLandmarks.length > 0
            ? poseResults.worldLandmarks[0]
            : null;

        result.body = this._extractFullBody(
          poseLandmarks,
          poseWorldLandmarks,
          video,
          result.face
        );
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

  // -------------------------------------------------------
  // Face extraction (unchanged from before)
  // -------------------------------------------------------
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

    const dx = rightEye.x - leftEye.x;
    const dy = rightEye.y - leftEye.y;
    const roll = Math.atan2(dy, dx);

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

  // -------------------------------------------------------
  // Full body extraction with joint rotations
  // -------------------------------------------------------
  _extractFullBody(poseLandmarks, poseWorldLandmarks, video, face) {
    const w = video.videoWidth;
    const h = video.videoHeight;

    // 2D positions (for screen overlay / positioning)
    const get2d = (idx) => ({
      x: poseLandmarks[idx].x * w,
      y: poseLandmarks[idx].y * h,
      visibility: poseLandmarks[idx].visibility || 0,
    });

    // 3D world positions (for rotation computation)
    // These are in meters, centered around the hip
    const get3d = (idx) => {
      if (!poseWorldLandmarks) return { x: 0, y: 0, z: 0 };
      const lm = poseWorldLandmarks[idx];
      return { x: lm.x, y: lm.y, z: lm.z };
    };

    // --- 2D landmarks ---
    const joints2d = {
      nose: get2d(POSE.NOSE),
      leftShoulder: get2d(POSE.LEFT_SHOULDER),
      rightShoulder: get2d(POSE.RIGHT_SHOULDER),
      leftElbow: get2d(POSE.LEFT_ELBOW),
      rightElbow: get2d(POSE.RIGHT_ELBOW),
      leftWrist: get2d(POSE.LEFT_WRIST),
      rightWrist: get2d(POSE.RIGHT_WRIST),
      leftHip: get2d(POSE.LEFT_HIP),
      rightHip: get2d(POSE.RIGHT_HIP),
      leftKnee: get2d(POSE.LEFT_KNEE),
      rightKnee: get2d(POSE.RIGHT_KNEE),
      leftAnkle: get2d(POSE.LEFT_ANKLE),
      rightAnkle: get2d(POSE.RIGHT_ANKLE),
      leftIndex: get2d(POSE.LEFT_INDEX),
      rightIndex: get2d(POSE.RIGHT_INDEX),
    };

    // --- 3D world landmarks ---
    const joints3d = {
      nose: get3d(POSE.NOSE),
      leftShoulder: get3d(POSE.LEFT_SHOULDER),
      rightShoulder: get3d(POSE.RIGHT_SHOULDER),
      leftElbow: get3d(POSE.LEFT_ELBOW),
      rightElbow: get3d(POSE.RIGHT_ELBOW),
      leftWrist: get3d(POSE.LEFT_WRIST),
      rightWrist: get3d(POSE.RIGHT_WRIST),
      leftHip: get3d(POSE.LEFT_HIP),
      rightHip: get3d(POSE.RIGHT_HIP),
      leftKnee: get3d(POSE.LEFT_KNEE),
      rightKnee: get3d(POSE.RIGHT_KNEE),
      leftAnkle: get3d(POSE.LEFT_ANKLE),
      rightAnkle: get3d(POSE.RIGHT_ANKLE),
    };

    // --- Shoulder metrics (2D) ---
    const ls = joints2d.leftShoulder;
    const rs = joints2d.rightShoulder;
    const dx = ls.x - rs.x;
    const dy = ls.y - rs.y;
    const shoulderWidth = Math.hypot(dx, dy);
    const shoulderTilt = Math.atan2(dy, dx);
    const shoulderMidX = (ls.x + rs.x) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;

    // --- Hip metrics (2D) ---
    const lh = joints2d.leftHip;
    const rh = joints2d.rightHip;
    const hipMidX = (lh.x + rh.x) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    const hipDx = lh.x - rh.x;
    const hipDy = lh.y - rh.y;
    const hipTilt = Math.atan2(hipDy, hipDx);

    // --- Compute joint ROTATIONS from 3D world landmarks ---
    const rotations = this._computeJointRotations(joints3d);

    // --- Torso rotation from 3D ---
    const torso = this._computeTorsoRotation(joints3d);

    // --- Visibility check ---
    const minVis = 0.5;
    const hasShoulders =
      ls.visibility > minVis && rs.visibility > minVis;
    const hasHips =
      lh.visibility > minVis && rh.visibility > minVis;
    const hasLeftArm =
      joints2d.leftElbow.visibility > minVis &&
      joints2d.leftWrist.visibility > minVis;
    const hasRightArm =
      joints2d.rightElbow.visibility > minVis &&
      joints2d.rightWrist.visibility > minVis;
    const hasLeftLeg =
      joints2d.leftKnee.visibility > minVis &&
      joints2d.leftAnkle.visibility > minVis;
    const hasRightLeg =
      joints2d.rightKnee.visibility > minVis &&
      joints2d.rightAnkle.visibility > minVis;

    return {
      // 2D positions
      joints2d,

      // 3D world positions
      joints3d,

      // Computed rotations for each limb
      rotations,

      // Torso orientation
      torso,

      // Shoulder data (for positioning & scale)
      leftShoulder: ls,
      rightShoulder: rs,
      shoulderMidX,
      shoulderMidY,
      shoulderMidXNorm: shoulderMidX / w,
      shoulderMidYNorm: shoulderMidY / h,
      shoulderWidth,
      shoulderWidthNorm: shoulderWidth / w,
      shoulderTilt,

      // Hip data
      hipMidX,
      hipMidY,
      hipTilt,

      // Visibility flags
      hasShoulders,
      hasHips,
      hasLeftArm,
      hasRightArm,
      hasLeftLeg,
      hasRightLeg,

      synthesized: false,
    };
  }

  // -------------------------------------------------------
  // Compute rotation angles between connected limbs
  //
  // These are angles in 3D space between parent→joint
  // and joint→child segments
  // -------------------------------------------------------
  _computeJointRotations(j) {
    const angle3d = (a, b, c) => {
      // Angle at point b, between segments ba and bc
      const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
      const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
      const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
      const magBA = Math.hypot(ba.x, ba.y, ba.z) || 1;
      const magBC = Math.hypot(bc.x, bc.y, bc.z) || 1;
      return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC))));
    };

    // Direction vector from a to b
    const dir = (a, b) => ({
      x: b.x - a.x,
      y: b.y - a.y,
      z: b.z - a.z,
    });

    // Compute limb directions for IK-style rotation
    const leftUpperArmDir = dir(j.leftShoulder, j.leftElbow);
    const leftLowerArmDir = dir(j.leftElbow, j.leftWrist);
    const rightUpperArmDir = dir(j.rightShoulder, j.rightElbow);
    const rightLowerArmDir = dir(j.rightElbow, j.rightWrist);

    const leftUpperLegDir = dir(j.leftHip, j.leftKnee);
    const leftLowerLegDir = dir(j.leftKnee, j.leftAnkle);
    const rightUpperLegDir = dir(j.rightHip, j.rightKnee);
    const rightLowerLegDir = dir(j.rightKnee, j.rightAnkle);

    return {
      // Arm bend angles (0 = straight, π = fully bent)
      leftElbowAngle: angle3d(j.leftShoulder, j.leftElbow, j.leftWrist),
      rightElbowAngle: angle3d(j.rightShoulder, j.rightElbow, j.rightWrist),

      // Leg bend angles
      leftKneeAngle: angle3d(j.leftHip, j.leftKnee, j.leftAnkle),
      rightKneeAngle: angle3d(j.rightHip, j.rightKnee, j.rightAnkle),

      // Limb direction vectors (for full IK)
      leftUpperArmDir,
      leftLowerArmDir,
      rightUpperArmDir,
      rightLowerArmDir,
      leftUpperLegDir,
      leftLowerLegDir,
      rightUpperLegDir,
      rightLowerLegDir,
    };
  }

  // -------------------------------------------------------
  // Compute torso orientation from hips + shoulders
  // -------------------------------------------------------
  _computeTorsoRotation(j) {
    // Shoulder midpoint
    const sMid = {
      x: (j.leftShoulder.x + j.rightShoulder.x) / 2,
      y: (j.leftShoulder.y + j.rightShoulder.y) / 2,
      z: (j.leftShoulder.z + j.rightShoulder.z) / 2,
    };

    // Hip midpoint
    const hMid = {
      x: (j.leftHip.x + j.rightHip.x) / 2,
      y: (j.leftHip.y + j.rightHip.y) / 2,
      z: (j.leftHip.z + j.rightHip.z) / 2,
    };

    // Spine direction: hip → shoulder (up vector of torso)
    const spineDir = {
      x: sMid.x - hMid.x,
      y: sMid.y - hMid.y,
      z: sMid.z - hMid.z,
    };
    const spineLen = Math.hypot(spineDir.x, spineDir.y, spineDir.z) || 1;
    spineDir.x /= spineLen;
    spineDir.y /= spineLen;
    spineDir.z /= spineLen;

    // Shoulder lateral: right → left (in MediaPipe world coords, X is right)
    const shoulderLateral = {
      x: j.leftShoulder.x - j.rightShoulder.x,
      y: j.leftShoulder.y - j.rightShoulder.y,
      z: j.leftShoulder.z - j.rightShoulder.z,
    };
    const latLen = Math.hypot(
      shoulderLateral.x,
      shoulderLateral.y,
      shoulderLateral.z
    ) || 1;
    shoulderLateral.x /= latLen;
    shoulderLateral.y /= latLen;
    shoulderLateral.z /= latLen;

    // Torso yaw: rotation around vertical axis
    // Use the shoulder lateral's X/Z to determine facing direction
    const torsoYaw = Math.atan2(shoulderLateral.z, shoulderLateral.x);

    // Torso pitch: forward/backward lean
    // spineDir.z > 0 means leaning forward
    const torsoPitch = Math.asin(
      Math.max(-1, Math.min(1, spineDir.z))
    );

    // Torso roll: side-to-side lean
    // spineDir.x > 0 means leaning to the right
    const torsoRoll = Math.asin(
      Math.max(-1, Math.min(1, -spineDir.x))
    );

    return {
      yaw: torsoYaw,
      pitch: torsoPitch,
      roll: torsoRoll,
      spineDir,
      shoulderLateral,
    };
  }

  // -------------------------------------------------------
  // Smoothing
  // -------------------------------------------------------
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
      eyeDistanceNorm: lerp(
        this.prevFace.eyeDistanceNorm,
        face.eyeDistanceNorm
      ),
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
      this.prevBody = this._cloneBodyForSmoothing(body);
      return body;
    }

    const alpha = 0.25 + (1 - this.smoothing) * 0.5;
    const lerp = (a, b) => a + (b - a) * alpha;

    const prev = this.prevBody;

    // Smooth key metrics
    const smoothed = {
      ...body,
      shoulderMidX: lerp(prev.shoulderMidX, body.shoulderMidX),
      shoulderMidY: lerp(prev.shoulderMidY, body.shoulderMidY),
      shoulderMidXNorm: lerp(prev.shoulderMidXNorm, body.shoulderMidXNorm),
      shoulderMidYNorm: lerp(prev.shoulderMidYNorm, body.shoulderMidYNorm),
      shoulderWidth: lerp(prev.shoulderWidth, body.shoulderWidth),
      shoulderWidthNorm: lerp(prev.shoulderWidthNorm, body.shoulderWidthNorm),
      shoulderTilt: lerp(prev.shoulderTilt, body.shoulderTilt),
      hipTilt: lerp(prev.hipTilt || 0, body.hipTilt || 0),
    };

    // Smooth torso rotation
    if (body.torso && prev.torso) {
      smoothed.torso = {
        ...body.torso,
        yaw: lerp(prev.torso.yaw, body.torso.yaw),
        pitch: lerp(prev.torso.pitch, body.torso.pitch),
        roll: lerp(prev.torso.roll, body.torso.roll),
      };
    }

    // Smooth joint rotations
    if (body.rotations && prev.rotations) {
      smoothed.rotations = {
        ...body.rotations,
        leftElbowAngle: lerp(
          prev.rotations.leftElbowAngle,
          body.rotations.leftElbowAngle
        ),
        rightElbowAngle: lerp(
          prev.rotations.rightElbowAngle,
          body.rotations.rightElbowAngle
        ),
        leftKneeAngle: lerp(
          prev.rotations.leftKneeAngle,
          body.rotations.leftKneeAngle
        ),
        rightKneeAngle: lerp(
          prev.rotations.rightKneeAngle,
          body.rotations.rightKneeAngle
        ),
      };

      // Smooth direction vectors
      const smoothDir = (prevDir, newDir) => {
        if (!prevDir || !newDir) return newDir;
        return {
          x: lerp(prevDir.x, newDir.x),
          y: lerp(prevDir.y, newDir.y),
          z: lerp(prevDir.z, newDir.z),
        };
      };

      smoothed.rotations.leftUpperArmDir = smoothDir(
        prev.rotations.leftUpperArmDir,
        body.rotations.leftUpperArmDir
      );
      smoothed.rotations.leftLowerArmDir = smoothDir(
        prev.rotations.leftLowerArmDir,
        body.rotations.leftLowerArmDir
      );
      smoothed.rotations.rightUpperArmDir = smoothDir(
        prev.rotations.rightUpperArmDir,
        body.rotations.rightUpperArmDir
      );
      smoothed.rotations.rightLowerArmDir = smoothDir(
        prev.rotations.rightLowerArmDir,
        body.rotations.rightLowerArmDir
      );
      smoothed.rotations.leftUpperLegDir = smoothDir(
        prev.rotations.leftUpperLegDir,
        body.rotations.leftUpperLegDir
      );
      smoothed.rotations.leftLowerLegDir = smoothDir(
        prev.rotations.leftLowerLegDir,
        body.rotations.leftLowerLegDir
      );
      smoothed.rotations.rightUpperLegDir = smoothDir(
        prev.rotations.rightUpperLegDir,
        body.rotations.rightUpperLegDir
      );
      smoothed.rotations.rightLowerLegDir = smoothDir(
        prev.rotations.rightLowerLegDir,
        body.rotations.rightLowerLegDir
      );
    }

    this.prevBody = this._cloneBodyForSmoothing(smoothed);
    return smoothed;
  }

  _cloneBodyForSmoothing(body) {
    return {
      shoulderMidX: body.shoulderMidX,
      shoulderMidY: body.shoulderMidY,
      shoulderMidXNorm: body.shoulderMidXNorm,
      shoulderMidYNorm: body.shoulderMidYNorm,
      shoulderWidth: body.shoulderWidth,
      shoulderWidthNorm: body.shoulderWidthNorm,
      shoulderTilt: body.shoulderTilt,
      hipTilt: body.hipTilt,
      torso: body.torso ? { ...body.torso } : null,
      rotations: body.rotations ? { ...body.rotations } : null,
    };
  }
}