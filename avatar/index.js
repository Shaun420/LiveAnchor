import * as THREE from "three";
import { VRMUtils } from "@pixiv/three-vrm";
import { loadVRM, measureModel } from "./loader.js";
import { findAllBones, captureRestPose } from "./bones.js";
import { driveHead, driveEyes, driveTorso, driveHips, driveLimbs, driveFingers, lerpBone } from "./drivers.js";
import { driveExpressions } from "./expressions.js";
import { computeTarget } from "./target.js";
import { solveArmIK, applyFingerPose, GESTURE_POSES, GRIP_POSE, captureAnchors } from "./overrides.js";
import { PropManager } from "./props.js";
import { applyLiftedPose } from "./lifting.js";

export class AvatarController {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 480;

    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
    this.camera.position.set(0, 0, 2);

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._onContextLost = (e) => {
      e.preventDefault();
      console.error("[Avatar] WebGL context lost — pausing render.");
      this._contextLost = true;
    };
    this._onContextRestored = () => {
      console.log("[Avatar] WebGL context restored.");
      this._contextLost = false;
    };
    this.renderer.domElement.addEventListener("webglcontextlost", this._onContextLost, false);
    this.renderer.domElement.addEventListener("webglcontextrestored", this._onContextRestored, false);
    this._contextLost = false;

    this.props = new PropManager();

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1, 2, 3);
    this.scene.add(dirLight);

    this.anchorRoot = new THREE.Group();
    this.scene.add(this.anchorRoot);
    this.modelRoot = new THREE.Group();
    this.anchorRoot.add(this.modelRoot);

    this.config = {
      sizeMultiplier: 0.4,
      verticalOffset: 0.15,
      yawScaleCompensation: 0.9,
      minYawCos: 0.7,
      shoulderScaleWeight: 0.7,
      neckHeadSplit: 0.4,
      response: 14,
      sourceWidth: 1280,
      sourceHeight: 720,
      avatarEyeDistance: 0.065,
      avatarShoulderWidth: 0.3,
      avatarShoulderToEyeRatio: 4.6,
      mirrored: true,
    };

    this.state = { x: 0, y: 0, scale: 1, yaw: 0, pitch: 0, roll: 0, shoulderTilt: 0 };
    this.bones = {};
    this.rest = null;
    this.currentMode = "none";
    this._modeCandidate = null;
    this._modeStreak = 0;

    this.hasEyeBones = false;
    this.hasFingerBones = false;
    this.hasHipBone = false;

    this.handOverrides = { left: null, right: null };
    this.activeGestures = { left: null, right: null };
    this._gestureTimers = new Map();
    this.currentEmotion = null;
    this.emotionIntensity = 1.0;
  }

  setSourceSize(w, h) {
    this.config.sourceWidth = Math.max(1, w);
    this.config.sourceHeight = Math.max(1, h);
  }

  async loadVRM(url) {
    if (this.vrm) {
      this.modelRoot.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }

    this.vrm = await loadVRM(url);
    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.rotation.set(0, 0, 0);
    this.modelRoot.scale.setScalar(1);
    this.anchorRoot.position.set(0, 0, 0);
    this.anchorRoot.rotation.set(0, 0, 0);
    this.anchorRoot.scale.setScalar(1);

    this.modelRoot.add(this.vrm.scene);

    const m = measureModel(this.vrm, this.anchorRoot, this.modelRoot, this.scene);
    this.config.avatarEyeDistance = m.eyeDistance;
    this.config.avatarShoulderWidth = m.shoulderWidth;
    this.config.avatarShoulderToEyeRatio = m.shoulderToEyeRatio;

    this.bones = findAllBones(this.vrm);
    this.rest = captureRestPose(this.vrm, this.bones);
    captureAnchors(this);

    this.hasEyeBones = !!(this.bones.leftEye && this.bones.rightEye);
    this.hasFingerBones = !!(this.bones.leftIndexProximal && this.bones.rightIndexProximal);
    this.hasHipBone = !!this.bones.hips;
  }

  recaptureRest() {
    if (!this.vrm) return null;
    this.rest = captureRestPose(this.vrm, this.bones);
    captureAnchors(this);
    return this.rest;
  }

  setEmotion(emotion, intensity = 1.0) {
    this.currentEmotion = emotion;
    this.emotionIntensity = intensity;
    const em = this.vrm?.expressionManager;
    if (!em) return;

    ["happy", "angry", "sad", "relaxed", "surprised"].forEach((name) => {
      if (em.getExpression(name)) {
        em.setValue(name, 0.0);
      }
    });

    const map = { joy: "happy", anger: "angry", sorrow: "sad", surprise: "surprised", focus: "relaxed" };
    const target = map[emotion];
    if (target && em.getExpression(target)) {
      em.setValue(target, intensity);
    }
  }

  triggerGesture(gesture, hand) {
    const hands = hand === "both" ? ["left", "right"] : [hand];
    for (const h of hands) {
      this.activeGestures[h] = gesture;
      clearTimeout(this._gestureTimers.get(h));
      this._gestureTimers.set(h, setTimeout(() => {
        this.activeGestures[h] = null;
        this._gestureTimers.delete(h);
      }, 3000));
    }
  }

  setHandIKTarget(hand, target) {
    this.handOverrides[hand] = (target === "release") ? null : target;
  }

  spawnProp(name, hand) {
    this.props.spawn(name, hand, this.bones);
  }

  _sync() {
    if (this.vrm) this.vrm.scene.updateMatrixWorld(true);
  }

  update(data, dt = 1 / 60) {
    if (this._contextLost) return;

    const face = data?.face || null;
    const body = data?.body || null;
    const hands = data?.hands || null;

    const a = 1 - Math.exp(-this.config.response * Math.min(dt, 0.1));

    if (face) {
      const tgt = computeTarget(face, body, this.camera, this.config);
      for (const k of Object.keys(this.state)) {
        this.state[k] = THREE.MathUtils.lerp(this.state[k], tgt[k], a);
      }
    }

    this.anchorRoot.position.set(this.state.x, this.state.y, 0);
    this.anchorRoot.scale.setScalar(this.state.scale);

    const newMode = body?.mode || "none";
    if (newMode !== this.currentMode) {
      this._modeStreak = this._modeCandidate === newMode ? this._modeStreak + 1 : 1;
      this._modeCandidate = newMode;
      if (this._modeStreak >= 12) {
        this.currentMode = newMode;
        this._modeStreak = 0;
        this._modeCandidate = null;
      }
    } else {
      this._modeStreak = 0;
      this._modeCandidate = null;
    }

    if (!this.vrm) return;

    driveHead(this.bones, this.state, this.config.neckHeadSplit, a);
    if (this.hasEyeBones && face?.gaze) driveEyes(this.bones, face.gaze, a);
    driveTorso(this.bones, body?.torso, this.state.shoulderTilt, a);
    if (this.hasHipBone && body?.hipRotation) driveHips(this.bones, body.hipRotation, body.mode, a);
    this._sync();

    driveLimbs(this.vrm, this.bones, this.rest, body, a, false);
    this._sync();

    if (this.hasFingerBones && hands) {
      driveFingers(this.vrm, this.bones, this.rest, hands, a);
    }
    this._sync();

    this._applySemanticOverrides(a);

    if (body?.liftedJoints17) {
      applyLiftedPose(this, body.liftedJoints17, a);
    }

    driveExpressions(this.vrm, data);
    this.vrm.update(Math.min(dt, 0.1));
  }

  render() {
    if (this._contextLost) return;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _applySemanticOverrides(alpha) {
    for (const side of ["left", "right"]) {
      const ik = this.handOverrides[side];
      const ges = this.activeGestures[side];
      const gripping = this.props.isHolding(side) || (ik === "chest" || ik === "hip");

      const anchor = this.rest?.anchors?.[side]?.[ik];
      if (ik && anchor) {
        solveArmIK(this, side, anchor, alpha);
      }

      if (gripping) {
        applyFingerPose(this.bones, side, GRIP_POSE, lerpBone, alpha);
      } else if (ges) {
        applyFingerPose(this.bones, side, GESTURE_POSES[ges] || GESTURE_POSES.open_palm, lerpBone, alpha);
      }
    }
  }

  dispose() {
    this.renderer.domElement.removeEventListener("webglcontextlost", this._onContextLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this._onContextRestored);
    for (const t of this._gestureTimers.values()) clearTimeout(t);
    this._gestureTimers.clear();
    this.props?.despawn?.("left");
    this.props?.despawn?.("right");
    if (this.vrm) {
      this.modelRoot.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
