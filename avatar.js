import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  VRMLoaderPlugin,
  VRMUtils,
} from "@pixiv/three-vrm";

export class AvatarController {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 480;

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

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 2, 3);
    this.scene.add(dir);

    // anchorRoot is positioned/rotated/scaled by the tracker.
    this.anchorRoot = new THREE.Group();
    this.anchorRoot.rotation.order = "YXZ";
    this.scene.add(this.anchorRoot);

    // modelRoot offsets the VRM so its eye midpoint is at local (0, 0, 0).
    this.modelRoot = new THREE.Group();
    this.anchorRoot.add(this.modelRoot);

    // Keep `group` as an alias for compatibility with existing code.
    this.group = this.anchorRoot;

    // --- Debug box at world origin (0, 0, 0) ---
    const debugGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const debugMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      wireframe: true,
    });
    this.debugBox = new THREE.Mesh(debugGeo, debugMat);
    this.scene.add(this.debugBox);

    // --- Anchor point marker ---
    this.anchorMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    this.scene.add(this.anchorMarker);

    // Default state
    this.state = {
      x: 0,
      y: 0,
      scale: 1,
      yaw: 0,
      pitch: 0,
      roll: 0,
    };

    // The avatar's natural eye distance (in avatar units).
    this.avatarEyeDistance = 0.065;

    // Source frame size (video resolution).
    this.sourceWidth = 1280;
    this.sourceHeight = 720;

    // Smoothing speed (higher = faster).
    this.response = 14;

    // Test mode: "off" | "center" | "spin".
    this.testMode = "off";
  }

  // -----------------------------------------------------------
  // Source / Canvas size
  // -----------------------------------------------------------
  setSourceSize(width, height) {
    this.sourceWidth = Math.max(1, width);
    this.sourceHeight = Math.max(1, height);
  }

  // -----------------------------------------------------------
  // Load VRM
  // -----------------------------------------------------------
  async loadVRM(url) {
    console.log("[Avatar] Loading:", url);

    if (this.vrm) {
      this.modelRoot.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await loader.loadAsync(
      url,
      (event) => {
        if (event.total > 0) {
          const percent = Math.round((event.loaded / event.total) * 100);
          console.log(`[Avatar] Loading ${percent}%`);
        }
      }
    );

    const vrm = gltf.userData.vrm;
    if (!vrm) {
      throw new Error("No VRM data was found in the file.");
    }

    this.vrm = vrm;

    if (vrm.meta?.metaVersion === "0") {
      VRMUtils.rotateVRM0(vrm);
    }

    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });

    // Reset transforms
    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.rotation.set(0, 0, 0);
    this.modelRoot.scale.setScalar(1);
    this.anchorRoot.position.set(0, 0, 0);
    this.anchorRoot.rotation.set(0, 0, 0);
    this.anchorRoot.scale.setScalar(1);

    this.modelRoot.add(vrm.scene);

    // Compute eye anchor and natural eye distance
    this._configureModelAnchor();

    // Build a list of available expression names
    this._logAvailableExpressions();

    console.log("[Avatar] VRM fully loaded & framed.");
    this.debugSnapshot();
  }

  // -----------------------------------------------------------
  // Configure anchor: move the model so its eyes are at origin
  // -----------------------------------------------------------
  _configureModelAnchor() {
    if (!this.vrm) return;

    this.scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const humanoid = this.vrm.humanoid;
    const leftEye = humanoid?.getNormalizedBoneNode("leftEye");
    const rightEye = humanoid?.getNormalizedBoneNode("rightEye");

    let eyeCenterWorld;
    let avatarEyeDistance;

    if (leftEye && rightEye) {
      const lp = new THREE.Vector3();
      const rp = new THREE.Vector3();
      leftEye.getWorldPosition(lp);
      rightEye.getWorldPosition(rp);
      eyeCenterWorld = lp.clone().add(rp).multiplyScalar(0.5);
      avatarEyeDistance = lp.distanceTo(rp);
      console.log("[Avatar] Using eye bones as anchor");
    } else {
      // Fallback: use top-center of bounding box.
      eyeCenterWorld = new THREE.Vector3(
        center.x,
        box.max.y - size.y * 0.12,
        center.z
      );
      avatarEyeDistance = size.y * 0.065;
      console.warn(
        "[Avatar] No eye bones found; using estimated eye position."
      );
    }

    const eyeCenterLocal = this.anchorRoot.worldToLocal(
      eyeCenterWorld.clone()
    );
    this.modelRoot.position.copy(eyeCenterLocal).multiplyScalar(-1);

    this.avatarEyeDistance = Math.max(avatarEyeDistance, 0.001);

    this.scene.updateMatrixWorld(true);

    console.log("[Avatar] Model dimensions:", {
      width: size.x,
      height: size.y,
      depth: size.z,
      avatarEyeDistance: this.avatarEyeDistance,
      modelOffset: this.modelRoot.position.toArray(),
    });
  }

  _logAvailableExpressions() {
    if (!this.vrm?.expressionManager) return;
    const names = [];
    for (const expr of this.vrm.expressionManager.expressions) {
      names.push(expr.expressionName);
    }
    console.log("[Avatar] Available expressions:", names.join(", "));
  }

  // -----------------------------------------------------------
  // Apply state to anchorRoot
  // -----------------------------------------------------------
  _applyState() {
    this.anchorRoot.position.set(this.state.x, this.state.y, 0);
    this.anchorRoot.scale.setScalar(this.state.scale);
    this.anchorRoot.rotation.set(
      this.state.pitch,
      this.state.yaw,
      -this.state.roll,
      "YXZ"
    );

    this.anchorMarker.position.set(this.state.x, this.state.y, 0);
  }

  // -----------------------------------------------------------
  // Main update loop
  // -----------------------------------------------------------
  update(trackingData, dt = 1 / 60) {
    let face = trackingData?.face || null;

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
      const time = performance.now() * 0.001;
      face = {
        xNorm: 0.5,
        yNorm: 0.5,
        eyeDistanceNorm: 0.15,
        yaw: Math.sin(time) * 0.5,
        pitch: Math.sin(time * 0.7) * 0.15,
        roll: Math.sin(time * 0.5) * 0.1,
      };
    }

    if (face) {
      const target = this._getFaceTarget(face);
      const alpha = 1 - Math.exp(-this.response * Math.min(dt, 0.1));

      this.state.x = THREE.MathUtils.lerp(this.state.x, target.x, alpha);
      this.state.y = THREE.MathUtils.lerp(this.state.y, target.y, alpha);
      this.state.scale = THREE.MathUtils.lerp(
        this.state.scale,
        target.scale,
        alpha
      );
      this.state.yaw = THREE.MathUtils.lerp(this.state.yaw, target.yaw, alpha);
      this.state.pitch = THREE.MathUtils.lerp(
        this.state.pitch,
        target.pitch,
        alpha
      );
      this.state.roll = THREE.MathUtils.lerp(this.state.roll, target.roll, alpha);
    }

    this._applyState();

    // --- Expressions (inlined) ---
    if (this.vrm?.expressionManager) {
      const em = this.vrm.expressionManager;
      const { blendshapes } = trackingData || {};

      const setExpr = (name, value) => {
        const expr = em.getExpression(name);
        if (expr) {
          expr.weight = Math.max(0, Math.min(1, value));
        }
      };

      if (blendshapes) {
        const jawOpen = blendshapes.jawOpen || 0;
        const mouthFunnel = blendshapes.mouthFunnel || 0;
        const mouthPucker = blendshapes.mouthPucker || 0;
        const mouthSmile =
          ((blendshapes.mouthSmileLeft || 0) +
            (blendshapes.mouthSmileRight || 0)) /
          2;

        setExpr("aa", jawOpen);
        setExpr("ou", mouthPucker + mouthFunnel * 0.5);
        setExpr("ih", jawOpen * 0.3);
        setExpr("ee", mouthSmile * 0.5);
        setExpr("oh", jawOpen * 0.5 + mouthFunnel * 0.3);
        setExpr("blinkLeft", blendshapes.eyeBlinkLeft || 0);
        setExpr("blinkRight", blendshapes.eyeBlinkRight || 0);
      } else if (face) {
        setExpr("aa", Math.min(1, face.mouthOpen * 5));
      }
    }

    if (this.vrm) {
      this.vrm.update(Math.min(dt, 0.1));
    }
  }

  // -----------------------------------------------------------
  // Convert tracked face to anchor target (FIXED)
  // -----------------------------------------------------------
  _getVisiblePlaneSize() {
    const distance = Math.abs(this.camera.position.z);
    const fovRadians = THREE.MathUtils.degToRad(this.camera.fov);
    const height = 2 * Math.tan(fovRadians / 2) * distance;
    const width = height * this.camera.aspect;
    return { width, height };
  }

  _getFaceTarget(face) {
    const frameW = face.frameWidth || this.sourceWidth;
    const frameH = face.frameHeight || this.sourceHeight;

    const xNorm = face.xNorm !== undefined ? face.xNorm : face.x / frameW;
    const yNorm = face.yNorm !== undefined ? face.yNorm : face.y / frameH;
    const eyeDistanceNorm =
      face.eyeDistanceNorm !== undefined
        ? face.eyeDistanceNorm
        : face.eyeDistance / frameW;

    const plane = this._getVisiblePlaneSize();

    // MediaPipe X is in the unmirrored frame.
    // The canvas is mirrored with CSS, so we flip X to match.
    const x = (0.5 - xNorm) * plane.width;

    // Image Y goes down, Three.js Y goes up
    const y = (0.5 - yNorm) * plane.height;

    const desiredEyeDistanceWorld = eyeDistanceNorm * plane.width;
    const scale = THREE.MathUtils.clamp(
      desiredEyeDistanceWorld / this.avatarEyeDistance,
      0.05,
      20
    );

    return {
      x,
      y,
      scale,
      yaw: face.yaw || 0,
      pitch: face.pitch || 0,
      roll: face.roll || 0,
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // false = don't change CSS size
    this.renderer.setSize(width, height, false);

    console.log("[Avatar] Resized:", {
      cssWidth: width,
      cssHeight: height,
      bufferWidth: this.canvas.width,
      bufferHeight: this.canvas.height,
    });
  }

  // -----------------------------------------------------------
  // Render
  // -----------------------------------------------------------
  render() {
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  // -----------------------------------------------------------
  // Debug
  // -----------------------------------------------------------
  setTestMode(mode) {
    if (!["off", "center", "spin"].includes(mode)) {
      throw new Error(`Unknown test mode: ${mode}`);
    }
    this.testMode = mode;
    console.log("[Avatar] Test mode:", mode);
  }

  toggleDebugBox(visible) {
    this.debugBox.visible = visible;
  }

  toggleAnchorMarker(visible) {
    this.anchorMarker.visible = visible;
  }

  debugSnapshot() {
    this.scene.updateMatrixWorld(true);

    const rect = this.canvas.getBoundingClientRect();

    const projectionMatrix = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      projectionMatrix
    );

    let worldBox = null;
    if (this.vrm) {
      worldBox = new THREE.Box3().setFromObject(this.vrm.scene);
    }

    const anchorNdc = this.anchorRoot.position
      .clone()
      .project(this.camera);

    const data = {
      hasVRM: Boolean(this.vrm),
      canvasCSS: { width: rect.width, height: rect.height },
      canvasBuffer: {
        width: this.canvas.width,
        height: this.canvas.height,
      },
      cameraAspect: this.camera.aspect,
      anchorPosition: this.anchorRoot.position.toArray(),
      anchorScale: this.anchorRoot.scale.x,
      anchorNDC: anchorNdc.toArray(),
      avatarEyeDistance: this.avatarEyeDistance,
      modelVisible: this.vrm?.scene.visible,
      modelInsideFrustum: worldBox
        ? frustum.intersectsBox(worldBox)
        : false,
      worldBoxMin: worldBox?.min.toArray(),
      worldBoxMax: worldBox?.max.toArray(),
      state: { ...this.state },
      testMode: this.testMode,
      renderCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };

    console.log("[Avatar debug]", data);
    return data;
  }
}