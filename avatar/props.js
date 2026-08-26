// avatar/props.js
import * as THREE from "three";

export class PropManager {
  constructor() { this.held = { left: null, right: null }; }

  spawn(name, hand, bones) {
    this.despawn(hand); // replace existing

    const mesh = this._buildMesh(name);
    const handBone = bones[`${hand}Hand`];
    if (!handBone) return;

    // Place in front of the palm using the baked hand basis (fwd/norm)
    handBone.add(mesh);
    mesh.position.set(0.02, -0.03, -0.05); // hand-local grip offset
    mesh.rotation.set(-Math.PI / 2, 0, 0);

    this.held[hand] = mesh;
    console.log(`[Props] Spawned '${name}' in ${hand} hand`);
  }

  despawn(hand) {
    const m = this.held[hand];
    if (m) {
      m.parent?.remove(m);
      m.geometry?.dispose();
      m.material?.dispose();
      this.held[hand] = null;
    }
  }

  isHolding(hand) { return !!this.held[hand]; }

  _buildMesh(name) {
    let geo;
    const key = (name || "").toLowerCase();
    if (key.includes("cup") || key.includes("mug") || key.includes("bottle")) {
      geo = new THREE.CylinderGeometry(0.032, 0.028, 0.11, 16);
    } else if (key.includes("phone")) {
      geo = new THREE.BoxGeometry(0.07, 0.012, 0.14);
    } else if (key.includes("sword") || key.includes("wand")) {
      geo = new THREE.CylinderGeometry(0.008, 0.012, 0.6, 8);
    } else {
      geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x88aaff, roughness: 0.6 });
    return new THREE.Mesh(geo, mat);
  }
}