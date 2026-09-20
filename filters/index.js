import { OneEuroFilterPose, OneEuroFilter, OneEuroFilterVec3 } from "./oneEuro.js";

export class FilterPipeline {
  constructor() {
    this._minCutoff = 1.0;
    this._beta = 0.007;
    this._freq = 30;

    this.faceRotation = new OneEuroFilterPose({ freq: this._freq, minCutoff: 1.5, beta: 0.01 });
    this.facePosition = new OneEuroFilterPose({ freq: this._freq, minCutoff: 1.0, beta: 0.005 });
    this.gaze = new OneEuroFilterPose({ freq: this._freq, minCutoff: 3.0, beta: 0.1 });
    this.expression = new OneEuroFilterPose({ freq: this._freq, minCutoff: 2.0, beta: 0.02 });
    this.bodyPosition = new OneEuroFilterPose({ freq: this._freq, minCutoff: 0.8, beta: 0.003 });
    this.bodyRotation = new OneEuroFilterPose({ freq: this._freq, minCutoff: 1.0, beta: 0.007 });

    this._jointFilters = new Map();
    this._fingerFilters = new Map();
    this._handVecFilters = new Map();
    this._lastJoint = {};
  }

  setFrequency(hz) {
    this._freq = Math.max(1, hz);
  }

  setSmoothing(sliderValue) {
    const t = sliderValue / 100;
    this._minCutoff = 0.3 + t * 3.7;
    this._beta = 0.001 + t * 0.049;

    this.faceRotation.setParams(this._minCutoff * 1.5, this._beta * 1.5);
    this.facePosition.setParams(this._minCutoff, this._beta * 0.7);
    this.bodyPosition.setParams(this._minCutoff * 0.8, this._beta * 0.5);
    this.bodyRotation.setParams(this._minCutoff, this._beta);
    this.expression.setParams(this._minCutoff * 2.0, this._beta * 2.0);
  }

  filterFace(face, ts) {
    if (!face) return null;
    const rot = this.faceRotation.filter({ yaw: face.yaw, pitch: face.pitch, roll: face.roll }, ts);
    const pos = this.facePosition.filter({
      x: face.x, y: face.y, xNorm: face.xNorm, yNorm: face.yNorm,
      eyeDistance: face.eyeDistance, eyeDistanceNorm: face.eyeDistanceNorm,
    }, ts);
    const expr = this.expression.filter({ mouthOpen: face.mouthOpen }, ts);
    let gaze = face.gaze;
    if (gaze) {
      gaze = this.gaze.filter({
        leftX: gaze.leftX, leftY: gaze.leftY, rightX: gaze.rightX, rightY: gaze.rightY,
      }, ts);
    }
    return { ...face, ...rot, ...pos, ...expr, gaze };
  }

  filterBody(body, ts) {
    if (!body) return null;
    const pos = this.bodyPosition.filter({
      shoulderMidX: body.shoulderMidX, shoulderMidY: body.shoulderMidY,
      shoulderMidXNorm: body.shoulderMidXNorm, shoulderMidYNorm: body.shoulderMidYNorm,
      shoulderWidth: body.shoulderWidth, shoulderWidthNorm: body.shoulderWidthNorm,
      shoulderTilt: body.shoulderTilt, hipTilt: body.hipTilt || 0,
    }, ts);

    let torso = body.torso;
    if (torso) {
      const ft = this.bodyRotation.filter({
        torsoYaw: torso.yaw, torsoPitch: torso.pitch, torsoRoll: torso.roll,
      }, ts);
      torso = { ...torso, yaw: ft.torsoYaw, pitch: ft.torsoPitch, roll: ft.torsoRoll };
    }

    let joints3d = body.joints3d;
    if (joints3d) {
      joints3d = {};
      for (const [name, joint] of Object.entries(body.joints3d)) {
        joints3d[name] = this._filterJoint(name, joint, body, ts);
      }
    }
    return { ...body, ...pos, torso, joints3d };
  }

  _filterJoint(name, joint, body, ts) {
    let f = this._jointFilters.get(name);
    if (!f) {
      f = new OneEuroFilterPose({ freq: this._freq, minCutoff: this._minCutoff, beta: this._beta });
      this._jointFilters.set(name, f);
    }
    const j2d = body.joints2d?.[name];
    if (!j2d || j2d.visibility > 0.3) {
      const out = f.filter({ x: joint.x, y: joint.y, z: joint.z }, ts);
      this._lastJoint[name] = out;
      return out;
    }
    const last = this._lastJoint[name];
    return last ? { x: last.x * 0.98, y: last.y * 0.98, z: last.z * 0.98 } : null;
  }

  filterHands(hands, ts) {
    if (!hands) return null;
    const result = {};

    for (const [side, hand] of Object.entries(hands)) {
      const filteredFingers = {};

      for (const [fingerName, fData] of Object.entries(hand.fingers || {})) {
        const prefix = `${side}_${fingerName}`;
        if (!this._fingerFilters.has(`${prefix}_curl`)) {
          this._fingerFilters.set(`${prefix}_curl`, new OneEuroFilter(this._freq, 2.5, 0.03));
          this._fingerFilters.set(`${prefix}_mcp`, new OneEuroFilter(this._freq, 2.5, 0.03));
          this._fingerFilters.set(`${prefix}_pip`, new OneEuroFilter(this._freq, 2.5, 0.03));
          this._fingerFilters.set(`${prefix}_opp`, new OneEuroFilter(this._freq, 2.0, 0.02));
        }

        filteredFingers[fingerName] = {
          ...fData,
          curl: this._fingerFilters.get(`${prefix}_curl`).filter(fData.curl ?? 0, ts),
          mcp: fData.mcp !== undefined ? this._fingerFilters.get(`${prefix}_mcp`).filter(fData.mcp, ts) : undefined,
          pip: fData.pip !== undefined ? this._fingerFilters.get(`${prefix}_pip`).filter(fData.pip, ts) : undefined,
          opposition: fData.opposition !== undefined ? this._fingerFilters.get(`${prefix}_opp`).filter(fData.opposition, ts) : undefined,
        };
      }

      const fwdKey = `${side}_fwd`;
      const normKey = `${side}_norm`;
      if (!this._handVecFilters.has(fwdKey)) {
        this._handVecFilters.set(fwdKey, new OneEuroFilterVec3(this._freq, 2.0, 0.02));
        this._handVecFilters.set(normKey, new OneEuroFilterVec3(this._freq, 2.0, 0.02));
      }

      const rawFwd = hand.handForward ? this._handVecFilters.get(fwdKey).filter(hand.handForward, ts) : null;
      const rawNorm = hand.palmNormal ? this._handVecFilters.get(normKey).filter(hand.palmNormal, ts) : null;

      let handForward = rawFwd;
      if (handForward) {
        const l = Math.hypot(handForward.x, handForward.y, handForward.z) || 1;
        handForward = { x: handForward.x / l, y: handForward.y / l, z: handForward.z / l };
      }

      let palmNormal = rawNorm;
      if (palmNormal) {
        const l = Math.hypot(palmNormal.x, palmNormal.y, palmNormal.z) || 1;
        palmNormal = { x: palmNormal.x / l, y: palmNormal.y / l, z: palmNormal.z / l };
      }

      result[side] = { ...hand, handForward, palmNormal, fingers: filteredFingers };
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
    for (const f of this._fingerFilters.values()) f.reset();
    for (const f of this._handVecFilters.values()) f.reset();
  }
}
