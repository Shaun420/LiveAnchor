import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

export class AvatarController {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 480;
    this.sizeMultiplier = 0.4;
    this.verticalOffset = 0.05;

    this.yawScaleCompensation = 0.9;
    this.minYawCos = 0.7;
    this.shoulderScaleWeight = 0.7;
    this.neckHeadSplit = 0.4;

    this.camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 2);
    this.camera.updateProjectionMatrix();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 2, 3);
    this.scene.add(dir);

    this.anchorRoot = new THREE.Group();
    this.scene.add(this.anchorRoot);

    this.modelRoot = new THREE.Group();
    this.anchorRoot.add(this.modelRoot);

    this.group = this.anchorRoot;

    this.debugBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
    );
    this.scene.add(this.debugBox);

    this.anchorMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    this.scene.add(this.anchorMarker);

    this.state = {
      x: 0,
      y: 0,
      scale: 1,
      yaw: 0,
      pitch: 0,
      roll: 0,
      shoulderTilt: 0,
    };

    this.avatarEyeDistance = 0.065;
    this.avatarShoulderWidth = 0.3;
    this.avatarShoulderToEyeRatio = 4.6;

    this.sourceWidth = 1280;
    this.sourceHeight = 720;
    this.response = 14;

    // All bones we drive
    this.bones = {};

    this.testMode = "off";
  }

  setSourceSize(w, h) {
    this.sourceWidth = Math.max(1, w);
    this.sourceHeight = Math.max(1, h);
  }

  async loadVRM(url) {
    console.log("[Avatar] Loading:", url);

    if (this.vrm) {
      this.modelRoot.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url, (event) => {
      if (event.total > 0) {
        console.log(
          `[Avatar] Loading ${Math.round((event.loaded / event.total) * 100)}%`
        );
      }
    });

    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("No VRM data found");

    this.vrm = vrm;
    if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);

    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });

    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.rotation.set(0, 0, 0);
    this.modelRoot.scale.setScalar(1);
    this.anchorRoot.position.set(0, 0, 0);
    this.anchorRoot.rotation.set(0, 0, 0);
    this.anchorRoot.scale.setScalar(1);

    this.modelRoot.add(vrm.scene);

    this._configureModelAnchor();
    this._findAllBones();
    this._logExpressions();

    console.log("[Avatar] VRM loaded.");
    this.debugSnapshot();
  }

  _configureModelAnchor() {
    if (!this.vrm) return;

    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.rotation.set(0, 0, 0);
    this.modelRoot.scale.setScalar(1);
    this.scene.updateMatrixWorld(true);

    const humanoid = this.vrm.humanoid;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Eyes
    const le = humanoid?.getNormalizedBoneNode("leftEye");
    const re = humanoid?.getNormalizedBoneNode("rightEye");
    let eyeDist;
    if (le && re) {
      const lp = new THREE.Vector3();
      const rp = new THREE.Vector3();
      le.getWorldPosition(lp);
      re.getWorldPosition(rp);
      eyeDist = lp.distanceTo(rp);
    } else {
      eyeDist = size.y * 0.065;
    }

    // Shoulders
    const lsb = humanoid?.getNormalizedBoneNode("leftUpperArm");
    const rsb = humanoid?.getNormalizedBoneNode("rightUpperArm");
    let shoulderCenter, shoulderWidth;
    if (lsb && rsb) {
      const ls = new THREE.Vector3();
      const rs = new THREE.Vector3();
      lsb.getWorldPosition(ls);
      rsb.getWorldPosition(rs);
      shoulderCenter = ls.clone().add(rs).multiplyScalar(0.5);
      shoulderWidth = ls.distanceTo(rs);
    } else {
      shoulderWidth = eyeDist * 4.5;
      shoulderCenter = new THREE.Vector3(
        center.x,
        center.y + size.y * 0.15,
        center.z
      );
    }

    this.avatarEyeDistance = Math.max(eyeDist, 0.001);
    this.avatarShoulderWidth = Math.max(shoulderWidth, 0.001);
    this.avatarShoulderToEyeRatio =
      this.avatarShoulderWidth / this.avatarEyeDistance;

    // Anchor at shoulder midpoint
    const shoulderLocal = this.anchorRoot.worldToLocal(
      shoulderCenter.clone()
    );
    this.modelRoot.position.set(
      -shoulderLocal.x,
      -shoulderLocal.y,
      -shoulderLocal.z
    );

    console.log(
      "[Avatar] Anchor at shoulders |",
      "eyeDist:",
      this.avatarEyeDistance.toFixed(4),
      "| shoulderW:",
      this.avatarShoulderWidth.toFixed(4)
    );
  }

  // -----------------------------------------------------------
  // Find ALL VRM bones
  // -----------------------------------------------------------
  _findAllBones() {
    if (!this.vrm?.humanoid) return;
    const h = this.vrm.humanoid;

    const boneNames = [
      "hips",
      "spine",
      "chest",
      "upperChest",
      "neck",
      "head",
      "leftShoulder",
      "rightShoulder",
      "leftUpperArm",
      "rightUpperArm",
      "leftLowerArm",
      "rightLowerArm",
      "leftHand",
      "rightHand",
      "leftUpperLeg",
      "rightUpperLeg",
      "leftLowerLeg",
      "rightLowerLeg",
      "leftFoot",
      "rightFoot",
    ];

    this.bones = {};
    for (const name of boneNames) {
      this.bones[name] = h.getNormalizedBoneNode(name);
    }

    const found = Object.entries(this.bones)
      .filter(([, v]) => v)
      .map(([k]) => k);
    console.log("[Avatar] Bones found:", found.join(", "));
  }

  _logExpressions() {
    if (!this.vrm?.expressionManager) return;
    const names = this.vrm.expressionManager.expressions.map(
      (e) => e.expressionName
    );
    console.log("[Avatar] Expressions:", names.join(", "));
  }

  // -----------------------------------------------------------
  // Apply position + scale only
  // -----------------------------------------------------------
  _applyState() {
    this.anchorRoot.position.set(this.state.x, this.state.y, 0);
    this.anchorRoot.scale.setScalar(this.state.scale);
    this.anchorMarker.position.set(this.state.x, this.state.y, 0);
  }

  // -----------------------------------------------------------
  // Apply head rotation to head + neck bones
  // -----------------------------------------------------------
  _applyHeadRotation(dt) {
    const alpha = 1 - Math.exp(-this.response * Math.min(dt, 0.1));

    const yaw = this.state.yaw || 0;
    const pitch = this.state.pitch || 0;
    const roll = -(this.state.roll || 0);

    const nf = this.neckHeadSplit;
    const hf = 1 - nf;

    if (this.bones.head) {
      const b = this.bones.head;
      b.rotation.y = THREE.MathUtils.lerp(b.rotation.y, yaw * hf, alpha);
      b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, pitch * hf, alpha);
      b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, roll * hf, alpha);
    }

    if (this.bones.neck) {
      const b = this.bones.neck;
      b.rotation.y = THREE.MathUtils.lerp(b.rotation.y, yaw * nf, alpha);
      b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, pitch * nf, alpha);
      b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, roll * nf, alpha);
    }
  }

  // -----------------------------------------------------------
  // Apply torso rotation to spine/chest
  // -----------------------------------------------------------
  _applyTorsoRotation(body, dt) {
    if (!body?.torso) return;

    const alpha = 1 - Math.exp(-this.response * Math.min(dt, 0.1));
    const t = body.torso;

    // Distribute torso rotation across spine chain
    const bones = [
      { bone: this.bones.spine, weight: 0.3 },
      { bone: this.bones.chest, weight: 0.3 },
      { bone: this.bones.upperChest, weight: 0.4 },
    ];

    for (const { bone, weight } of bones) {
      if (!bone) continue;

      const targetY = THREE.MathUtils.clamp(t.yaw * weight, -0.8, 0.8);
      const targetX = THREE.MathUtils.clamp(t.pitch * weight, -0.5, 0.5);
      const targetZ = THREE.MathUtils.clamp(
        -this.state.shoulderTilt * weight,
        -0.4,
        0.4
      );

      bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, targetY, alpha);
      bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, targetX, alpha);
      bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, targetZ, alpha);
    }
  }

  // -----------------------------------------------------------
  // Apply arm rotations using direction vectors
  // -----------------------------------------------------------
  _applyArmRotation(body, dt) {
    if (!body?.rotations || !body?.hasLeftArm && !body?.hasRightArm) return;

    const alpha = 1 - Math.exp(-this.response * Math.min(dt, 0.1));
    const rot = body.rotations;

    // Helper: convert a direction vector to bone rotation
    // MediaPipe 3D: X=right, Y=down, Z=toward camera
    // VRM T-pose: arms extend along X axis
    const dirToArmRotation = (dir, isLeft) => {
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      const nx = dir.x / len;
      const ny = dir.y / len;
      const nz = dir.z / len;

      // In T-pose, upper arm points along ±X
      // We need rotation to point it from ±X toward the target direction
      // Y rotation: forward/back swing
      const rotY = Math.atan2(nz, Math.abs(nx)) * (isLeft ? 1 : -1);
      // Z rotation: up/down swing (pitch)
      const rotZ = Math.atan2(-ny, Math.abs(nx)) * (isLeft ? -1 : 1);

      return {
        y: THREE.MathUtils.clamp(rotY, -Math.PI * 0.8, Math.PI * 0.8),
        z: THREE.MathUtils.clamp(rotZ, -Math.PI * 0.8, Math.PI * 0.8),
      };
    };

    // Left arm
    if (body.hasLeftArm && this.bones.leftUpperArm) {
      const r = dirToArmRotation(rot.leftUpperArmDir, true);
      const b = this.bones.leftUpperArm;
      b.rotation.y = THREE.MathUtils.lerp(b.rotation.y, r.y, alpha);
      b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, r.z, alpha);
    }

    if (body.hasLeftArm && this.bones.leftLowerArm) {
      // Elbow only bends on one axis
      const bend = Math.PI - rot.leftElbowAngle;
      const b = this.bones.leftLowerArm;
      b.rotation.y = THREE.MathUtils.lerp(
        b.rotation.y,
        THREE.MathUtils.clamp(bend, 0, Math.PI * 0.85),
        alpha
      );
    }

    // Right arm
    if (body.hasRightArm && this.bones.rightUpperArm) {
      const r = dirToArmRotation(rot.rightUpperArmDir, false);
      const b = this.bones.rightUpperArm;
      b.rotation.y = THREE.MathUtils.lerp(b.rotation.y, r.y, alpha);
      b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, r.z, alpha);
    }

    if (body.hasRightArm && this.bones.rightLowerArm) {
      const bend = Math.PI - rot.rightElbowAngle;
      const b = this.bones.rightLowerArm;
      b.rotation.y = THREE.MathUtils.lerp(
        b.rotation.y,
        -THREE.MathUtils.clamp(bend, 0, Math.PI * 0.85),
        alpha
      );
    }
  }

  // -----------------------------------------------------------
  // Apply leg rotations
  // -----------------------------------------------------------
  _applyLegRotation(body, dt) {
    if (!body?.rotations) return;

    const alpha = 1 - Math.exp(-this.response * Math.min(dt, 0.1));
    const rot = body.rotations;

    const dirToLegRotation = (dir) => {
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      const nx = dir.x / len;
      const ny = dir.y / len;
      const nz = dir.z / len;

      // In T-pose, legs point straight down (−Y)
      // X rotation: forward/back kick
      const rotX = Math.atan2(nz, -ny);
      // Z rotation: side spread
      const rotZ = Math.atan2(nx, -ny);

      return {
        x: THREE.MathUtils.clamp(rotX, -Math.PI * 0.6, Math.PI * 0.6),
        z: THREE.MathUtils.clamp(rotZ, -Math.PI * 0.3, Math.PI * 0.3),
      };
    };

    // Left leg
    if (body.hasLeftLeg && this.bones.leftUpperLeg) {
      const r = dirToLegRotation(rot.leftUpperLegDir);
      const b = this.bones.leftUpperLeg;
      b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, r.x, alpha);
      b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, r.z, alpha);
    }

    if (body.hasLeftLeg && this.bones.leftLowerLeg) {
      const bend = Math.PI - rot.leftKneeAngle;
      const b = this.bones.leftLowerLeg;
      b.rotation.x = THREE.MathUtils.lerp(
        b.rotation.x,
        THREE.MathUtils.clamp(bend, 0, Math.PI * 0.7),
        alpha
      );
    }

    // Right leg
    if (body.hasRightLeg && this.bones.rightUpperLeg) {
      const r = dirToLegRotation(rot.rightUpperLegDir);
      const b = this.bones.rightUpperLeg;
      b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, r.x, alpha);
      b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, r.z, alpha);
    }

    if (body.hasRightLeg && this.bones.rightLowerLeg) {
      const bend = Math.PI - rot.rightKneeAngle;
      const b = this.bones.rightLowerLeg;
      b.rotation.x = THREE.MathUtils.lerp(
        b.rotation.x,
        THREE.MathUtils.clamp(bend, 0, Math.PI * 0.7),
        alpha
      );
    }
  }

  // -----------------------------------------------------------
  // Main update
  // -----------------------------------------------------------
  update(trackingData, dt = 1 / 60) {
    let face = trackingData?.face || null;
    const body = trackingData?.body || null;

    if (this.testMode === "center") {
      face = {
        xNorm: 0.5,
        yNorm: 0.5,
        eyeDistanceNorm: 0.15,
        yaw: 0,
        pitch: 0,
        roll: 0,
      };
    }

    if (this.testMode === "spin") {
      const t = performance.now() * 0.001;
      face = {
        xNorm: 0.5,
        yNorm: 0.5,
        eyeDistanceNorm: 0.15,
        yaw: Math.sin(t) * 0.5,
        pitch: Math.sin(t * 0.7) * 0.15,
        roll: Math.sin(t * 0.5) * 0.1,
      };
    }

    if (face) {
      const target = this._getTarget(face, body);
      const alpha = 1 - Math.exp(-this.response * Math.min(dt, 0.1));

      this.state.x = THREE.MathUtils.lerp(this.state.x, target.x, alpha);
      this.state.y = THREE.MathUtils.lerp(this.state.y, target.y, alpha);
      this.state.scale = THREE.MathUtils.lerp(
        this.state.scale,
        target.scale,
        alpha
      );
      this.state.yaw = THREE.MathUtils.lerp(
        this.state.yaw,
        target.yaw,
        alpha
      );
      this.state.pitch = THREE.MathUtils.lerp(
        this.state.pitch,
        target.pitch,
        alpha
      );
      this.state.roll = THREE.MathUtils.lerp(
        this.state.roll,
        target.roll,
        alpha
      );
      this.state.shoulderTilt = THREE.MathUtils.lerp(
        this.state.shoulderTilt,
        target.shoulderTilt,
        alpha
      );
    }

    this._applyState();
    this._applyHeadRotation(dt);
    this._applyTorsoRotation(body, dt);
    this._applyArmRotation(body, dt);
    this._applyLegRotation(body, dt);

    // Expressions
    if (this.vrm?.expressionManager) {
      const em = this.vrm.expressionManager;
      const { blendshapes } = trackingData || {};

      const setExpr = (name, value) => {
        const expr = em.getExpression(name);
        if (expr) expr.weight = Math.max(0, Math.min(1, value));
      };

      if (blendshapes) {
        setExpr("aa", blendshapes.jawOpen || 0);
        setExpr(
          "ou",
          (blendshapes.mouthPucker || 0) +
            (blendshapes.mouthFunnel || 0) * 0.5
        );
        setExpr("ih", (blendshapes.jawOpen || 0) * 0.3);
        setExpr(
          "ee",
          ((blendshapes.mouthSmileLeft || 0) +
            (blendshapes.mouthSmileRight || 0)) *
            0.25
        );
        setExpr(
          "oh",
          (blendshapes.jawOpen || 0) * 0.5 +
            (blendshapes.mouthFunnel || 0) * 0.3
        );
        setExpr("blinkLeft", blendshapes.eyeBlinkLeft || 0);
        setExpr("blinkRight", blendshapes.eyeBlinkRight || 0);
      } else if (face) {
        setExpr("aa", Math.min(1, (face.mouthOpen || 0) * 5));
      }
    }

    if (this.vrm) this.vrm.update(Math.min(dt, 0.1));
  }

  // -----------------------------------------------------------
  // Target computation
  // -----------------------------------------------------------
  _getVisiblePlaneSize() {
    const d = Math.abs(this.camera.position.z);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const h = 2 * Math.tan(fov / 2) * d;
    return { width: h * this.camera.aspect, height: h };
  }

  _getTarget(face, body) {
    const frameW = face.frameWidth || this.sourceWidth;
    const frameH = face.frameHeight || this.sourceHeight;

    const eyeDistNorm =
      face.eyeDistanceNorm !== undefined
        ? face.eyeDistanceNorm
        : (face.eyeDistance || 0) / frameW;

    const plane = this._getVisiblePlaneSize();

    // Scale
    let scaleEye;
    const absYaw = Math.abs(face.yaw || 0);
    const yawCos = Math.max(this.minYawCos, Math.cos(absYaw));
    const corrected =
      eyeDistNorm / Math.pow(yawCos, this.yawScaleCompensation);
    scaleEye =
      (corrected * plane.width * this.sizeMultiplier) / this.avatarEyeDistance;

    let scaleShoulder = null;
    if (body && !body.synthesized && body.shoulderWidthNorm) {
      const sn = body.shoulderWidthNorm;
      const expected = eyeDistNorm * this.avatarShoulderToEyeRatio;
      const r = sn / (expected || 0.01);
      if (r > 0.4 && r < 2.5) {
        scaleShoulder =
          (sn * plane.width * this.sizeMultiplier) / this.avatarShoulderWidth;
      }
    }

    let scale;
    if (scaleShoulder !== null) {
      const w = this.shoulderScaleWeight;
      scale = scaleShoulder * w + scaleEye * (1 - w);
    } else {
      scale = scaleEye;
    }
    scale = THREE.MathUtils.clamp(scale, 0.05, 20);

    // Position
    let x, y;
    if (body && !body.synthesized && body.shoulderMidXNorm !== undefined) {
      x = (body.shoulderMidXNorm - 0.5) * plane.width;
      y = (0.5 - body.shoulderMidYNorm) * plane.height;
    } else {
      const xn = face.xNorm !== undefined ? face.xNorm : face.x / frameW;
      const yn = face.yNorm !== undefined ? face.yNorm : face.y / frameH;
      x = (xn - 0.5) * plane.width;
      const eyeY = (0.5 - yn) * plane.height;
      const off = eyeDistNorm * 2.5;
      y = eyeY - off * plane.height * this.sizeMultiplier;
    }

    let shoulderTilt = 0;
    if (body && !body.synthesized) {
      shoulderTilt = body.shoulderTilt || 0;
    }

    return {
      x,
      y,
      scale,
      yaw: face.yaw || 0,
      pitch: face.pitch || 0,
      roll: face.roll || 0,
      shoulderTilt,
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    console.log("[Avatar] Resized:", w, "x", h);
  }

  render() {
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  setTestMode(mode) {
    this.testMode = mode;
    console.log("[Avatar] Test mode:", mode);
  }

  toggleDebugBox(v) {
    this.debugBox.visible = v;
  }

  toggleAnchorMarker(v) {
    this.anchorMarker.visible = v;
  }

  debugSnapshot() {
    this.scene.updateMatrixWorld(true);
    const rect = this.canvas.getBoundingClientRect();
    const pm = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(pm);
    let wb = this.vrm
      ? new THREE.Box3().setFromObject(this.vrm.scene)
      : null;

    const data = {
      hasVRM: !!this.vrm,
      canvas: { w: rect.width, h: rect.height },
      anchor: this.anchorRoot.position.toArray(),
      scale: this.anchorRoot.scale.x,
      eyeDist: this.avatarEyeDistance,
      shoulderW: this.avatarShoulderWidth,
      bones: Object.fromEntries(
        Object.entries(this.bones).map(([k, v]) => [k, !!v])
      ),
      state: { ...this.state },
      inFrustum: wb ? frustum.intersectsBox(wb) : false,
    };
    console.log("[Avatar debug]", data);
    return data;
  }
}