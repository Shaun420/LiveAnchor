import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.5.5/lib/three-vrm.module.min.js";

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(
      35,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 5);

    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(0, 0, 5);
    this.scene.add(directional);

    this.avatarGroup = new THREE.Group();
    this.scene.add(this.avatarGroup);

    this.vrm = null;
    this.target = { x: 0, y: 0, scale: 1.0, roll: 0, mouthOpen: 0 };
    this.smoothed = { x: 0, y: 0, scale: 1.0, roll: 0, mouthOpen: 0 };
  }

  async loadVRM(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url);
    this.vrm = gltf.userData.vrm;
    VRMUtils.rotateVRM0(this.vrm);

    this.vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    this.avatarGroup.add(this.vrm.scene);

    // Center the model
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    this.vrm.scene.position.sub(center);
  }

  setAnchor(anchor) {
    if (!anchor) return;

    const fov = (this.camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * Math.tan(fov / 2) * this.camera.position.z;
    const visibleWidth = visibleHeight * this.camera.aspect;

    const nx = (anchor.x / this.canvas.clientWidth) - 0.5;
    const ny = (anchor.y / this.canvas.clientHeight) - 0.5;

    this.target.x = -nx * visibleWidth;
    this.target.y = -ny * visibleHeight;
    this.target.scale = anchor.eyeDistance / 80.0;
    this.target.roll = (anchor.roll * Math.PI) / 180;
    this.target.mouthOpen = anchor.mouthOpen;
  }

  update() {
    const lerp = (a, b, t) => a + (b - a) * t;
    const t = 0.25;

    this.smoothed.x = lerp(this.smoothed.x, this.target.x, t);
    this.smoothed.y = lerp(this.smoothed.y, this.target.y, t);
    this.smoothed.scale = lerp(this.smoothed.scale, this.target.scale, t);
    this.smoothed.roll = lerp(this.smoothed.roll, this.target.roll, t);
    this.smoothed.mouthOpen = lerp(this.smoothed.mouthOpen, this.target.mouthOpen, t);

    this.avatarGroup.position.set(this.smoothed.x, this.smoothed.y, 0);
    this.avatarGroup.scale.setScalar(this.smoothed.scale);
    this.avatarGroup.rotation.z = -this.smoothed.roll;

    if (this.vrm) {
      this.vrm.update(0.016);

      // Apply mouth open
      const mouth = this.vrm.expressionManager.getExpression("aa");
      if (mouth) {
        const value = Math.min(1, this.smoothed.mouthOpen * 6.0);
        mouth.weight = value;
      }
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  }
}