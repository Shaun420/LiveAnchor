import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

// MediaPipe "left" = person's left = screen-right in selfie view
// VRM "left" = character's left = screen-left when facing viewer
// Since display is CSS-mirrored, MP left maps to VRM left (no swap needed)
// BUT MP coordinates have X increasing rightward (person's left = +X)
// and VRM has X increasing rightward too, so we just flip X for mirror
const LIMB_CHAINS = [
  // VRM bone          → child bone         → [MP parent, MP child]
  { bone: "leftUpperArm",  child: "leftLowerArm",  mp: ["leftShoulder",  "leftElbow"]  },
  { bone: "leftLowerArm",  child: "leftHand",       mp: ["leftElbow",     "leftWrist"]  },
  { bone: "rightUpperArm", child: "rightLowerArm",  mp: ["rightShoulder", "rightElbow"] },
  { bone: "rightLowerArm", child: "rightHand",      mp: ["rightElbow",    "rightWrist"] },
  { bone: "leftUpperLeg",  child: "leftLowerLeg",   mp: ["leftHip",       "leftKnee"]   },
  { bone: "leftLowerLeg",  child: "leftFoot",       mp: ["leftKnee",      "leftAnkle"]  },
  { bone: "rightUpperLeg", child: "rightLowerLeg",   mp: ["rightHip",      "rightKnee"]  },
  { bone: "rightLowerLeg", child: "rightFoot",       mp: ["rightKnee",     "rightAnkle"] },
];

// Reusable THREE objects to avoid per-frame allocation
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _euler = new THREE.Euler();

export class AvatarController {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;

    // Scene
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

    // Hierarchy: scene → anchorRoot (pos+scale) → modelRoot (offset) → vrm
    this.anchorRoot = new THREE.Group();
    this.scene.add(this.anchorRoot);
    this.modelRoot = new THREE.Group();
    this.anchorRoot.add(this.modelRoot);

    // Debug markers
    this.debugBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
    );
    this.anchorMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    this.scene.add(this.debugBox, this.anchorMarker);

    // Config
    this.sizeMultiplier = 0.4;
    this.verticalOffset = 0.05;
    this.yawScaleCompensation = 0.9;
    this.minYawCos = 0.7;
    this.shoulderScaleWeight = 0.7;
    this.neckHeadSplit = 0.4;
    this.response = 14;
    this.sourceWidth = 1280;
    this.sourceHeight = 720;
    this.testMode = "off";

    // Avatar measurements
    this.avatarEyeDistance = 0.065;
    this.avatarShoulderWidth = 0.3;
    this.avatarShoulderToEyeRatio = 4.6;

    // Bones + rest pose
    this.bones = {};
    this.rest = null;

    // Smoothed state
    this.state = { x: 0, y: 0, scale: 1, yaw: 0, pitch: 0, roll: 0, shoulderTilt: 0 };

    // Debug
    this.debugLimbs = true;
    this._fc = 0;
    this._logInterval = 120;
  }

  setSourceSize(w, h) {
    this.sourceWidth = Math.max(1, w);
    this.sourceHeight = Math.max(1, h);
  }

  // ======================== VRM Loading ========================

  async loadVRM(url) {
    console.log("[Avatar] Loading:", url);
    if (this.vrm) {
      this.modelRoot.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }

    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));

    const gltf = await loader.loadAsync(url, (e) => {
      if (e.total > 0) console.log(`[Avatar] Loading ${Math.round(e.loaded / e.total * 100)}%`);
    });

    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("No VRM data found");
    this.vrm = vrm;

    if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      if (o.isMesh) o.castShadow = o.receiveShadow = false;
    });

    // Reset all transforms
    [this.modelRoot, this.anchorRoot].forEach((g) => {
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
      g.scale.setScalar(1);
    });

    this.modelRoot.add(vrm.scene);
    this._measure();
    this._findBones();
    this._captureRest();
    this._logExpressions();
    console.log("[Avatar] VRM loaded.");
    this.debugSnapshot();
  }

  // ======================== Model Setup ========================

  _measure() {
    if (!this.vrm) return;
    this.modelRoot.position.set(0, 0, 0);
    this.scene.updateMatrixWorld(true);

    const humanoid = this.vrm.humanoid;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const size = box.getSize(_v3a);
    const center = box.getCenter(_v3b);

    // Eye distance
    const le = humanoid?.getNormalizedBoneNode("leftEye");
    const re = humanoid?.getNormalizedBoneNode("rightEye");
    if (le && re) {
      le.getWorldPosition(_v3a);
      re.getWorldPosition(_v3b);
      this.avatarEyeDistance = Math.max(_v3a.distanceTo(_v3b), 0.001);
    } else {
      this.avatarEyeDistance = size.y * 0.065;
    }

    // Shoulder width + center
    const lsb = humanoid?.getNormalizedBoneNode("leftUpperArm");
    const rsb = humanoid?.getNormalizedBoneNode("rightUpperArm");
    let shoulderCenter;
    if (lsb && rsb) {
      lsb.getWorldPosition(_v3a);
      rsb.getWorldPosition(_v3b);
      shoulderCenter = _v3a.clone().add(_v3b).multiplyScalar(0.5);
      this.avatarShoulderWidth = Math.max(_v3a.distanceTo(_v3b), 0.001);
    } else {
      this.avatarShoulderWidth = this.avatarEyeDistance * 4.5;
      shoulderCenter = new THREE.Vector3(center.x, center.y + size.y * 0.15, center.z);
    }

    this.avatarShoulderToEyeRatio = this.avatarShoulderWidth / this.avatarEyeDistance;

    // Anchor at shoulder midpoint
    const local = this.anchorRoot.worldToLocal(shoulderCenter.clone());
    this.modelRoot.position.set(-local.x, -local.y, -local.z);

    console.log(`[Avatar] eyeDist:${this.avatarEyeDistance.toFixed(4)} shoulderW:${this.avatarShoulderWidth.toFixed(4)}`);
  }

  _findBones() {
    if (!this.vrm?.humanoid) return;
    const h = this.vrm.humanoid;
    const names = [
      "hips", "spine", "chest", "upperChest", "neck", "head",
      "leftShoulder", "rightShoulder",
      "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm",
      "leftHand", "rightHand",
      "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg",
      "leftFoot", "rightFoot",
    ];
    this.bones = {};
    names.forEach((n) => (this.bones[n] = h.getNormalizedBoneNode(n)));
    console.log("[Avatar] Bones:", names.filter((n) => this.bones[n]).join(", "));
  }

  _captureRest() {
    if (!this.vrm) return;
    this.vrm.scene.updateMatrixWorld(true);
    this.rest = {};

    for (const chain of LIMB_CHAINS) {
      const b = this.bones[chain.bone];
      const c = this.bones[chain.child];
      if (!b || !c) continue;

      b.getWorldPosition(_v3a);
      c.getWorldPosition(_v3b);
      const dir = _v3b.clone().sub(_v3a);
      if (dir.lengthSq() < 1e-8) continue;
      dir.normalize();

      const quat = new THREE.Quaternion();
      b.getWorldQuaternion(quat);
      this.rest[chain.bone] = { dir, quat };
    }
    console.log("[Avatar] Rest:", Object.keys(this.rest).join(", "));
  }

  _logExpressions() {
    if (!this.vrm?.expressionManager) return;
    const names = this.vrm.expressionManager.expressions.map((e) => e.expressionName);
    console.log("[Avatar] Expressions:", names.join(", "));
  }

  // ======================== Per-frame Update ========================

  update(data, dt = 1 / 60) {
    let face = data?.face || null;
    const body = data?.body || null;

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
      const tgt = this._target(face, body);
      const a = 1 - Math.exp(-this.response * Math.min(dt, 0.1));
      for (const k of Object.keys(this.state)) {
        this.state[k] = THREE.MathUtils.lerp(this.state[k], tgt[k], a);
      }
    }

    // Apply transforms
    this.anchorRoot.position.set(this.state.x, this.state.y, 0);
    this.anchorRoot.scale.setScalar(this.state.scale);
    this.anchorMarker.position.set(this.state.x, this.state.y, 0);

    this._headRotation(dt);
    this._torsoRotation(body, dt);
    this._limbSolver(body, dt);
    this._expressions(data);

    if (this.vrm) this.vrm.update(Math.min(dt, 0.1));
  }

  // ======================== Target Computation ========================

  _visiblePlane() {
    const d = Math.abs(this.camera.position.z);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const h = 2 * Math.tan(fov / 2) * d;
    return { w: h * this.camera.aspect, h };
  }

  _target(face, body) {
    const fw = face.frameWidth || this.sourceWidth;
    const fh = face.frameHeight || this.sourceHeight;
    const eyeN = face.eyeDistanceNorm ?? (face.eyeDistance || 0) / fw;
    const plane = this._visiblePlane();

    // Scale: blend shoulder + eye
    const absYaw = Math.abs(face.yaw || 0);
    const yawCos = Math.max(this.minYawCos, Math.cos(absYaw));
    const corrected = eyeN / Math.pow(yawCos, this.yawScaleCompensation);
    let scaleEye = (corrected * plane.w * this.sizeMultiplier) / this.avatarEyeDistance;
    let scale = scaleEye;

    if (body && !body.synthesized && body.shoulderWidthNorm) {
      const sn = body.shoulderWidthNorm;
      const expected = eyeN * this.avatarShoulderToEyeRatio;
      const r = sn / (expected || 0.01);
      if (r > 0.4 && r < 2.5) {
        const scaleSh = (sn * plane.w * this.sizeMultiplier) / this.avatarShoulderWidth;
        const sw = this.shoulderScaleWeight;
        scale = scaleSh * sw + scaleEye * (1 - sw);
      }
    }
    scale = THREE.MathUtils.clamp(scale, 0.05, 20);

    // Position
    let x, y;
    if (body && !body.synthesized && body.shoulderMidXNorm !== undefined) {
      x = (body.shoulderMidXNorm - 0.5) * plane.w;
      y = (0.5 - body.shoulderMidYNorm) * plane.h;
    } else {
      const xn = face.xNorm ?? face.x / fw;
      const yn = face.yNorm ?? face.y / fh;
      x = (xn - 0.5) * plane.w;
      y = (0.5 - yn) * plane.h - eyeN * 2.5 * plane.h * this.sizeMultiplier;
    }

    return {
      x, y, scale,
      yaw: face.yaw || 0,
      pitch: face.pitch || 0,
      roll: face.roll || 0,
      shoulderTilt: body && !body.synthesized ? (body.shoulderTilt || 0) : 0,
    };
  }

  // ======================== Bone Drivers ========================

  _lerpBone(bone, axis, target, alpha) {
    if (!bone) return;
    bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], target, alpha);
  }

  _headRotation(dt) {
    const a = 1 - Math.exp(-this.response * Math.min(dt, 0.1));
    const { yaw, pitch, roll } = this.state;
    const nf = this.neckHeadSplit;

    // Head gets (1-nf) share, neck gets nf share
    this._lerpBone(this.bones.head, "y", yaw * (1 - nf), a);
    this._lerpBone(this.bones.head, "x", pitch * (1 - nf), a);
    this._lerpBone(this.bones.head, "z", -roll * (1 - nf), a);

    this._lerpBone(this.bones.neck, "y", yaw * nf, a);
    this._lerpBone(this.bones.neck, "x", pitch * nf, a);
    this._lerpBone(this.bones.neck, "z", -roll * nf, a);
  }

  _torsoRotation(body, dt) {
    if (!body?.torso) return;
    const a = 1 - Math.exp(-this.response * Math.min(dt, 0.1));
    const t = body.torso;
    const tilt = this.state.shoulderTilt;

    const chain = [
      [this.bones.spine, 0.3],
      [this.bones.chest, 0.3],
      [this.bones.upperChest, 0.4],
    ];

    for (const [bone, w] of chain) {
      if (!bone) continue;
      this._lerpBone(bone, "y", THREE.MathUtils.clamp(t.yaw * w, -0.8, 0.8), a);
      this._lerpBone(bone, "x", THREE.MathUtils.clamp(t.pitch * w, -0.5, 0.5), a);
      this._lerpBone(bone, "z", THREE.MathUtils.clamp(-tilt * w, -0.4, 0.4), a);
    }
  }

  _limbSolver(body, dt) {
    const log = this.debugLimbs && this._fc % this._logInterval === 0;

    if (!body?.joints3d || !this.rest || !this.vrm) {
      if (log) console.log("[Limbs] SKIP:", !body ? "no body" : !body.joints3d ? "no joints3d" : "no rest/vrm");
      this._fc++;
      return;
    }

    this.vrm.scene.updateMatrixWorld(true);
    const a = 1 - Math.exp(-this.response * Math.min(dt, 0.1));
    const j = body.joints3d;

    // MediaPipe world: X=right, Y=down, Z=toward camera
    // Three/VRM:       X=right, Y=up,   Z=toward viewer
    // NO X flip — MP "left" already matches VRM "left" in mirrored display
    const toVRM = (p) => _v3a.set(p.x, -p.y, -p.z);

    const vis = {
      leftUpperArm: body.hasLeftArm, leftLowerArm: body.hasLeftArm,
      rightUpperArm: body.hasRightArm, rightLowerArm: body.hasRightArm,
      leftUpperLeg: body.hasLeftLeg, leftLowerLeg: body.hasLeftLeg,
      rightUpperLeg: body.hasRightLeg, rightLowerLeg: body.hasRightLeg,
    };

    let applied = 0, skipV = 0;

    if (log) {
      console.log(`[Limbs] f:${this._fc} ws:${body.worldSpace} LA:${vis.leftUpperArm} RA:${vis.rightUpperArm} LL:${vis.leftUpperLeg} RL:${vis.rightUpperLeg}`);
    }

    for (const chain of LIMB_CHAINS) {
      if (!vis[chain.bone]) { skipV++; continue; }

      const bone = this.bones[chain.bone];
      const rest = this.rest[chain.bone];
      if (!bone || !rest) continue;

      const pa = j[chain.mp[0]];
      const pb = j[chain.mp[1]];
      if (!pa || !pb) continue;

      // Compute target direction in VRM world space
      const worldA = toVRM(pa).clone();
      const worldB = toVRM(pb);
      const target = _v3c.copy(worldB).sub(worldA);
      if (target.lengthSq() < 1e-8) continue;
      target.normalize();

      // Rotation: rest.dir → target
      _qa.setFromUnitVectors(rest.dir, target);

      // Desired world orientation = delta * restQuat
      _qb.copy(rest.quat);
      _qa.multiply(_qb);

      // Convert world → local
      bone.parent.getWorldQuaternion(_qb);
      _qb.invert().multiply(_qa);

      if (log && (chain.bone === "leftUpperArm" || chain.bone === "rightUpperArm")) {
        _euler.setFromQuaternion(_qb);
        console.log(`  ${chain.bone}: target(${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)}) rest(${rest.dir.x.toFixed(2)},${rest.dir.y.toFixed(2)},${rest.dir.z.toFixed(2)}) euler°(${(_euler.x*57.3).toFixed(0)},${(_euler.y*57.3).toFixed(0)},${(_euler.z*57.3).toFixed(0)})`);
      }

      bone.quaternion.slerp(_qb, a);
      applied++;
    }

    if (log) console.log(`[Limbs] applied:${applied} skipVis:${skipV}`);
    this._fc++;
  }

  // ======================== Expressions ========================

  _expressions(data) {
    if (!this.vrm?.expressionManager) return;
    const em = this.vrm.expressionManager;
    const bs = data?.blendshapes;
    const face = data?.face;

    const set = (name, val) => {
      const e = em.getExpression(name);
      if (e) e.weight = THREE.MathUtils.clamp(val, 0, 1);
    };

    if (bs) {
      set("aa", bs.jawOpen || 0);
      set("ou", (bs.mouthPucker || 0) + (bs.mouthFunnel || 0) * 0.5);
      set("ih", (bs.jawOpen || 0) * 0.3);
      set("ee", ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) * 0.25);
      set("oh", (bs.jawOpen || 0) * 0.5 + (bs.mouthFunnel || 0) * 0.3);
      set("blinkLeft", bs.eyeBlinkLeft || 0);
      set("blinkRight", bs.eyeBlinkRight || 0);
    } else if (face) {
      set("aa", Math.min(1, (face.mouthOpen || 0) * 5));
    }
  }

  // ======================== Render / Resize ========================

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

  // ======================== Debug ========================

  setTestMode(m) { this.testMode = m; }
  toggleDebugBox(v) { this.debugBox.visible = v; }
  toggleAnchorMarker(v) { this.anchorMarker.visible = v; }

  diagnoseLimbs() {
    console.log("=== LIMB DIAGNOSTIC ===");
    console.log("VRM:", !!this.vrm, "| Rest:", !!this.rest);
    if (this.rest) console.log("Rest bones:", Object.keys(this.rest));

    const list = ["leftUpperArm","leftLowerArm","rightUpperArm","rightLowerArm",
      "leftUpperLeg","leftLowerLeg","rightUpperLeg","rightLowerLeg"];

    for (const n of list) {
      const b = this.bones[n];
      if (!b) { console.log(`${n}: MISSING`); continue; }
      const q = b.quaternion;
      _euler.setFromQuaternion(q);
      console.log(`${n}: e°(${(_euler.x*57.3).toFixed(1)},${(_euler.y*57.3).toFixed(1)},${(_euler.z*57.3).toFixed(1)})`);
      if (this.rest?.[n]) {
        const d = this.rest[n].dir;
        console.log(`  rest: (${d.x.toFixed(3)},${d.y.toFixed(3)},${d.z.toFixed(3)})`);
      }
    }
    console.log("=======================");
  }

  debugBodyData(body) {
    if (!body) { console.log("body: null"); return; }
    console.log("=== BODY DATA ===");
    console.log(`synth:${body.synthesized} world:${body.worldSpace}`);
    console.log(`vis: sh:${body.hasShoulders} arms:${body.hasLeftArm}/${body.hasRightArm} legs:${body.hasLeftLeg}/${body.hasRightLeg}`);
    if (body.joints3d) {
      const f = (p) => `(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)})`;
      ["leftShoulder","leftElbow","leftWrist","rightShoulder","rightElbow","rightWrist",
       "leftHip","leftKnee","leftAnkle","rightHip","rightKnee","rightAnkle"].forEach((k) => {
        if (body.joints3d[k]) console.log(`  ${k}: ${f(body.joints3d[k])}`);
      });
    }
    if (body.torso) console.log(`torso: Y:${(body.torso.yaw*57.3).toFixed(1)}° P:${(body.torso.pitch*57.3).toFixed(1)}° R:${(body.torso.roll*57.3).toFixed(1)}°`);
    console.log("=================");
  }

  debugSnapshot() {
    this.scene.updateMatrixWorld(true);
    const pm = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(pm);
    const wb = this.vrm ? new THREE.Box3().setFromObject(this.vrm.scene) : null;
    console.log("[Avatar debug]", {
      hasVRM: !!this.vrm,
      eyeDist: this.avatarEyeDistance,
      shoulderW: this.avatarShoulderWidth,
      restBones: this.rest ? Object.keys(this.rest) : [],
      state: { ...this.state },
      inFrustum: wb ? frustum.intersectsBox(wb) : false,
    });
  }
}