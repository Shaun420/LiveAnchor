import * as THREE from "three";
import { VRMUtils } from "@pixiv/three-vrm";
import { _euler } from "./constants.js";
import { loadVRM, measureModel } from "./loader.js";
import { findAllBones, captureRestPose } from "./bones.js";
import { driveHead, driveEyes, driveTorso, driveHips, driveLimbs, driveFingers } from "./drivers.js";
import { driveExpressions } from "./expressions.js";
import { computeTarget } from "./target.js";

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

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1, 2, 3);
    this.scene.add(dirLight);

    this.anchorRoot = new THREE.Group();
    this.scene.add(this.anchorRoot);
    this.modelRoot = new THREE.Group();
    this.anchorRoot.add(this.modelRoot);

    this.debugBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
    );
    this.anchorMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    this.scene.add(this.debugBox, this.anchorMarker);

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
    };

    this.state = { x: 0, y: 0, scale: 1, yaw: 0, pitch: 0, roll: 0, shoulderTilt: 0 };
    this.bones = {};
    this.rest = null;
    this.testMode = "off";
    this.currentMode = "none";

    this.debugLimbs = false;
    this._fc = 0;
    this._logInterval = 120;

    this.hasEyeBones = false;
    this.hasFingerBones = false;
    this.hasHipBone = false;
    this._loggedFeatures = false;
    this._lastModeLog = "";
  }

  get response() { return this.config.response; }
  set response(v) { this.config.response = v; }

  setSourceSize(w, h) {
    this.config.sourceWidth = Math.max(1, w);
    this.config.sourceHeight = Math.max(1, h);
  }

  async loadVRM(url) {
    console.log("[Avatar] Loading:", url);
    if (this.vrm) {
      this.modelRoot.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }

    this.vrm = await loadVRM(url);

    [this.modelRoot, this.anchorRoot].forEach((g) => {
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
      g.scale.setScalar(1);
    });

    this.modelRoot.add(this.vrm.scene);

    const m = measureModel(this.vrm, this.anchorRoot, this.modelRoot, this.scene);
    this.config.avatarEyeDistance = m.eyeDistance;
    this.config.avatarShoulderWidth = m.shoulderWidth;
    this.config.avatarShoulderToEyeRatio = m.shoulderToEyeRatio;

    this.bones = findAllBones(this.vrm);
    this.rest = captureRestPose(this.vrm, this.bones);

    this.hasEyeBones = !!(this.bones.leftEye && this.bones.rightEye);
    this.hasFingerBones = !!(this.bones.leftIndexProximal && this.bones.rightIndexProximal);
    this.hasHipBone = !!this.bones.hips;

    console.log("[Avatar] Features:",
      "eyes:", this.hasEyeBones,
      "| fingers:", this.hasFingerBones,
      "| hips:", this.hasHipBone
    );

    if (this.vrm.expressionManager) {
      const names = this.vrm.expressionManager.expressions.map((e) => e.expressionName);
      console.log("[Avatar] Expressions:", names.join(", "));
    }

    console.log("[Avatar] VRM loaded.");
  }

  update(data, dt = 1 / 60) {
    let face = data?.face || null;
    const body = data?.body || null;
    const hands = data?.hands || null;

    if (this.testMode === "center") {
      face = { xNorm: 0.5, yNorm: 0.5, eyeDistanceNorm: 0.15, yaw: 0, pitch: 0, roll: 0 };
    } else if (this.testMode === "spin") {
      const t = performance.now() * 0.001;
      face = {
        xNorm: 0.5, yNorm: 0.5, eyeDistanceNorm: 0.15,
        yaw: Math.sin(t) * 0.5, pitch: Math.sin(t * 0.7) * 0.15, roll: Math.sin(t * 0.5) * 0.1,
      };
    }

    if (face) {
      const tgt = computeTarget(face, body, this.camera, this.config);
      const a = 1 - Math.exp(-this.config.response * Math.min(dt, 0.1));
      for (const k of Object.keys(this.state)) {
        this.state[k] = THREE.MathUtils.lerp(this.state[k], tgt[k], a);
      }
    }

    // Position + scale
    this.anchorRoot.position.set(this.state.x, this.state.y, 0);
    this.anchorRoot.scale.setScalar(this.state.scale);
    this.anchorMarker.position.set(this.state.x, this.state.y, 0);

    const a = 1 - Math.exp(-this.config.response * Math.min(dt, 0.1));

    // Track mode changes
    if (body?.mode) {
      this.currentMode = body.mode;
      if (body.mode !== this._lastModeLog) {
        this._lastModeLog = body.mode;
        console.log(`[Avatar] Mode: ${body.mode} | arms:${body.hasLeftArm}/${body.hasRightArm} legs:${body.hasLeftLeg}/${body.hasRightLeg}`);
      }
    }

    // Head
    driveHead(this.bones, this.state, this.config.neckHeadSplit, a);

    // Eyes
    if (this.hasEyeBones && face?.gaze) {
      driveEyes(this.bones, face.gaze, a);
    }

    // Torso
    driveTorso(this.bones, body?.torso, this.state.shoulderTilt, a);

    // Hips
    if (this.hasHipBone && body?.hipRotation) {
      driveHips(this.bones, body.hipRotation, body.mode, a);
    }

    // Limbs
    const limbLog = this.debugLimbs && this._fc % this._logInterval === 0;
    driveLimbs(this.vrm, this.bones, this.rest, body, a, limbLog);
    this._fc++;

    // Fingers
    if (this.hasFingerBones && hands) {
      driveFingers(this.vrm, this.bones, this.rest, hands, a);
    }

    // One-time feature log
    if (!this._loggedFeatures && (hands || face?.gaze)) {
      this._loggedFeatures = true;
      console.log("[Avatar] Active:",
        "head:✓",
        `eyes:${face?.gaze ? "✓" : "✗"}`,
        `hands:${hands ? Object.keys(hands).join(",") : "✗"}`,
        `fingers:${this.hasFingerBones ? "✓" : "✗"}`,
        `hips:${this.hasHipBone ? "✓" : "✗"}`
      );
    }

    driveExpressions(this.vrm, data);
    if (this.vrm) this.vrm.update(Math.min(dt, 0.1));
  }

  render() {
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
    console.log("[Avatar] Resized:", w, "x", h);
  }

  setTestMode(m) { this.testMode = m; }
  toggleDebugBox(v) { this.debugBox.visible = v; }
  toggleAnchorMarker(v) { this.anchorMarker.visible = v; }

  diagnose() {
    console.log("=== FULL DIAGNOSTIC ===");
    console.log("VRM:", !!this.vrm, "| Mode:", this.currentMode);
    console.log("Eyes:", this.hasEyeBones, "| Fingers:", this.hasFingerBones, "| Hips:", this.hasHipBone);

    const limbBones = ["leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm",
      "leftUpperLeg", "leftLowerLeg", "rightUpperLeg", "rightLowerLeg"];
    for (const n of limbBones) {
      const b = this.bones[n];
      if (!b) { console.log(`  ${n}: MISSING`); continue; }
      _euler.setFromQuaternion(b.quaternion);
      console.log(`  ${n}: e°(${(_euler.x * 57.3).toFixed(1)},${(_euler.y * 57.3).toFixed(1)},${(_euler.z * 57.3).toFixed(1)})`);
    }

    const fingerBones = ["leftIndexProximal", "leftMiddleProximal", "rightIndexProximal"];
    for (const n of fingerBones) {
      console.log(`  ${n}: ${this.bones[n] ? "✓" : "MISSING"}`);
    }

    console.log("  hips:", this.bones.hips ? "✓" : "MISSING");
    console.log("  leftEye:", this.bones.leftEye ? "✓" : "MISSING");
    console.log("=======================");
  }
}