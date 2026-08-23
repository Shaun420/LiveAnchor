import { OneEuroFilterPose, OneEuroFilter } from "./oneEuro.js";
import { KalmanFilterVec3 } from "./kalman.js";

// ============================================================
// FilterPipeline
//
// Manages all filters for face, body, and hands.
// Replaces all the manual lerp() calls in tracker/index.js.
//
// Usage:
//   const pipeline = new FilterPipeline();
//   pipeline.setFrequency(30); // call when FPS is known
//
//   // Each frame:
//   const filteredFace = pipeline.filterFace(rawFace, ts);
//   const filteredBody = pipeline.filterBody(rawBody, ts);
// ============================================================

export class FilterPipeline {
  constructor() {
    // Default params: tune via setSmoothing()
    this._minCutoff = 1.0;
    this._beta = 0.007;
    this._freq = 30;

    // Face rotation filter (yaw, pitch, roll)
    this.faceRotation = new OneEuroFilterPose({
      freq: this._freq,
      minCutoff: 1.5, // face needs slightly more responsiveness
      beta: 0.01,
    });

    // Face position filter (xNorm, yNorm, eyeDistance)
    this.facePosition = new OneEuroFilterPose({
      freq: this._freq,
      minCutoff: 1.0,
      beta: 0.005,
    });

    // Gaze filter (very responsive — eyes move fast)
    this.gaze = new OneEuroFilterPose({
      freq: this._freq,
      minCutoff: 3.0,
      beta: 0.1,
    });

    // Mouth / expression filter
    this.expression = new OneEuroFilterPose({
      freq: this._freq,
      minCutoff: 2.0,
      beta: 0.02,
    });

    // Body position filter
    this.bodyPosition = new OneEuroFilterPose({
      freq: this._freq,
      minCutoff: 0.8,
      beta: 0.003,
    });

    // Body rotation filter (torso, hips)
    this.bodyRotation = new OneEuroFilterPose({
      freq: this._freq,
      minCutoff: 1.0,
      beta: 0.007,
    });

    // Per-joint 3D position filters (body limbs)
    this._jointFilters = new Map();

    // Finger curl filters
    this._fingerFilters = new Map();

    // Kalman for occluded joints
    this._kalmanJoints = new Map();
  }

  setFrequency(hz) {
    this._freq = hz;
  }

  /**
   * Map slider value (0-100) to filter parameters
   * 0   = maximum smoothing (slow response)
   * 100 = minimum smoothing (instant response)
   */
  setSmoothing(sliderValue) {
    // sliderValue 0..100
    // minCutoff: 0.3 (very smooth) to 4.0 (very responsive)
    // beta:      0.001 to 0.05
    const t = sliderValue / 100;
    this._minCutoff = 0.3 + t * 3.7;
    this._beta = 0.001 + t * 0.049;

    this.faceRotation.setParams(this._minCutoff * 1.5, this._beta * 1.5);
    this.facePosition.setParams(this._minCutoff, this._beta * 0.7);
    this.bodyPosition.setParams(this._minCutoff * 0.8, this._beta * 0.5);
    this.bodyRotation.setParams(this._minCutoff, this._beta);
    this.expression.setParams(this._minCutoff * 2.0, this._beta * 2.0);
  }

  // ── Face ──────────────────────────────────────────────────

  filterFace(face, ts) {
    if (!face) return null;

    const rot = this.faceRotation.filter({
      yaw: face.yaw,
      pitch: face.pitch,
      roll: face.roll,
    }, ts);

    const pos = this.facePosition.filter({
      x: face.x,
      y: face.y,
      xNorm: face.xNorm,
      yNorm: face.yNorm,
      eyeDistance: face.eyeDistance,
      eyeDistanceNorm: face.eyeDistanceNorm,
    }, ts);

    const expr = this.expression.filter({
      mouthOpen: face.mouthOpen,
    }, ts);

    let gaze = face.gaze;
    if (gaze) {
      gaze = this.gaze.filter({
        leftX: gaze.leftX,
        leftY: gaze.leftY,
        rightX: gaze.rightX,
        rightY: gaze.rightY,
      }, ts);
    }

    return {
      ...face,
      ...rot,
      ...pos,
      ...expr,
      gaze,
    };
  }

  // ── Body ──────────────────────────────────────────────────

  filterBody(body, ts) {
    if (!body) return null;

    const pos = this.bodyPosition.filter({
      shoulderMidX: body.shoulderMidX,
      shoulderMidY: body.shoulderMidY,
      shoulderMidXNorm: body.shoulderMidXNorm,
      shoulderMidYNorm: body.shoulderMidYNorm,
      shoulderWidth: body.shoulderWidth,
      shoulderWidthNorm: body.shoulderWidthNorm,
      shoulderTilt: body.shoulderTilt,
      hipTilt: body.hipTilt || 0,
    }, ts);

    let torso = body.torso;
    if (torso) {
      torso = {
        ...torso,
        ...this.bodyRotation.filter({
          torsoYaw: torso.yaw,
          torsoPitch: torso.pitch,
          torsoRoll: torso.roll,
        }, ts),
      };
      torso.yaw = torso.torsoYaw;
      torso.pitch = torso.torsoPitch;
      torso.roll = torso.torsoRoll;
    }

    // Filter per joint
    let joints3d = body.joints3d;
    if (joints3d) {
      joints3d = {};
      for (const [name, joint] of Object.entries(body.joints3d)) {
        joints3d[name] = this._filterJoint(name, joint, body, ts);
      }
    }

    return {
      ...body,
      ...pos,
      torso,
      joints3d,
    };
  }

  _filterJoint(name, joint, body, ts) {
    // Get or create filter pair for this joint
    if (!this._jointFilters.has(name)) {
      this._jointFilters.set(name, new OneEuroFilterPose({
        freq: this._freq,
        minCutoff: this._minCutoff,
        beta: this._beta,
      }));
      this._kalmanJoints.set(name, new KalmanFilterVec3(0.01, 0.0001));
    }

    const oeFilter = this._jointFilters.get(name);
    const kalman = this._kalmanJoints.get(name);

    // Check visibility
    const j2d = body.joints2d?.[name];
    const isVisible = !j2d || j2d.visibility > 0.3;

    if (isVisible) {
      // Joint visible: filter with OneEuro + feed Kalman
      const filtered = oeFilter.filter({
        x: joint.x, y: joint.y, z: joint.z,
      }, ts);
      kalman.filter(filtered); // keep Kalman state warm
      return filtered;
    } else {
      // Joint occluded: use Kalman prediction
      return kalman.predict();
    }
  }

  // ── Hands ─────────────────────────────────────────────────

  filterHands(hands, ts) {
    if (!hands) return null;

    const result = {};

    for (const [side, hand] of Object.entries(hands)) {
      const filteredFingers = {};

      for (const [fingerName, finger] of Object.entries(hand.fingers)) {
        const key = `${side}_${fingerName}`;
        if (!this._fingerFilters.has(key)) {
          this._fingerFilters.set(key, new OneEuroFilter(
            this._freq,
            2.0, // fingers need more responsiveness
            0.03
          ));
        }
        filteredFingers[fingerName] = {
          ...finger,
          curl: this._fingerFilters.get(key).filter(finger.curl, ts),
        };
      }

      result[side] = { ...hand, fingers: filteredFingers };
    }

    return result;
  }

  reset() {
    this.faceRotation.reset();
    this.facePosition.reset();
    this.gaze.reset();
    this.expression.reset();
    this.bodyPosition.reset();
    this.bodyRotation.reset();
    for (const f of this._jointFilters.values()) f.reset();
    for (const f of this._kalmanJoints.values()) f.reset();
    for (const f of this._fingerFilters.values()) f.reset();
  }
}