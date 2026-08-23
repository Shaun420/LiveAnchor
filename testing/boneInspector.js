import * as THREE from "three";

// ============================================================
// Live Bone Inspector
//
// Usage: window.openBoneInspector()
//
// Shows a floating panel with:
//  - Bone selector dropdown
//  - X/Y/Z rotation sliders (-180° to +180°)
//  - Live readout of current rotation
//  - Reset button
//  - Auto-rotate mode for finding axes
// ============================================================

let inspectorPanel = null;
let inspectorInterval = null;
let currentBone = null;
let autoRotateAxis = null;
let autoRotateTime = 0;

const SLIDER_MIN = -180;
const SLIDER_MAX = 180;

export function openBoneInspector() {
  const avatar = window.avatar;
  if (!avatar?.bones) {
    console.error("[BoneInspector] No avatar loaded");
    return;
  }

  // Remove existing panel
  if (inspectorPanel) {
    inspectorPanel.remove();
    if (inspectorInterval) clearInterval(inspectorInterval);
  }

  // Build panel
  inspectorPanel = document.createElement("div");
  inspectorPanel.id = "bone-inspector";
  inspectorPanel.innerHTML = `
    <style>
      #bone-inspector {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        background: rgba(17, 17, 24, 0.95);
        border: 1px solid #333;
        border-radius: 12px;
        padding: 16px;
        width: 320px;
        max-height: 90vh;
        overflow-y: auto;
        font-family: monospace;
        font-size: 12px;
        color: #ddd;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      #bone-inspector h3 {
        margin: 0 0 10px;
        color: #7c3aed;
        font-size: 14px;
      }
      #bone-inspector select {
        width: 100%;
        padding: 6px;
        background: #222;
        color: #fff;
        border: 1px solid #444;
        border-radius: 6px;
        margin-bottom: 10px;
        font-size: 12px;
      }
      #bone-inspector .axis-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      #bone-inspector .axis-label {
        width: 16px;
        font-weight: bold;
      }
      #bone-inspector .axis-label.x { color: #f44; }
      #bone-inspector .axis-label.y { color: #4f4; }
      #bone-inspector .axis-label.z { color: #44f; }
      #bone-inspector input[type="range"] {
        flex: 1;
        accent-color: #7c3aed;
      }
      #bone-inspector .val {
        width: 50px;
        text-align: right;
        font-size: 11px;
        color: #aaa;
      }
      #bone-inspector .btn-row {
        display: flex;
        gap: 6px;
        margin-top: 8px;
        flex-wrap: wrap;
      }
      #bone-inspector button {
        padding: 6px 10px;
        background: #333;
        border: 1px solid #555;
        border-radius: 6px;
        color: #ddd;
        cursor: pointer;
        font-size: 11px;
      }
      #bone-inspector button:hover { background: #444; }
      #bone-inspector button.active { background: #7c3aed; border-color: #7c3aed; }
      #bone-inspector .info {
        margin-top: 10px;
        padding: 8px;
        background: #1a1a24;
        border-radius: 6px;
        font-size: 11px;
        color: #888;
        white-space: pre-wrap;
      }
      #bone-inspector .close-btn {
        position: absolute;
        top: 8px;
        right: 12px;
        background: none;
        border: none;
        color: #888;
        font-size: 18px;
        cursor: pointer;
      }
      #bone-inspector .preset-row {
        display: flex;
        gap: 4px;
        margin-top: 6px;
        flex-wrap: wrap;
      }
      #bone-inspector .preset-btn {
        padding: 3px 8px;
        font-size: 10px;
        background: #1a1a24;
      }
    </style>

    <button class="close-btn" id="bi-close">×</button>
    <h3>🦴 Bone Inspector</h3>

    <select id="bi-bone-select"></select>

    <div class="axis-row">
      <span class="axis-label x">X</span>
      <input type="range" id="bi-x" min="${SLIDER_MIN}" max="${SLIDER_MAX}" value="0" step="1" />
      <span class="val" id="bi-x-val">0°</span>
    </div>
    <div class="axis-row">
      <span class="axis-label y">Y</span>
      <input type="range" id="bi-y" min="${SLIDER_MIN}" max="${SLIDER_MAX}" value="0" step="1" />
      <span class="val" id="bi-y-val">0°</span>
    </div>
    <div class="axis-row">
      <span class="axis-label z">Z</span>
      <input type="range" id="bi-z" min="${SLIDER_MIN}" max="${SLIDER_MAX}" value="0" step="1" />
      <span class="val" id="bi-z-val">0°</span>
    </div>

    <div class="btn-row">
      <button id="bi-reset">Reset</button>
      <button id="bi-reset-all">Reset All</button>
      <button id="bi-auto-x">Auto X</button>
      <button id="bi-auto-y">Auto Y</button>
      <button id="bi-auto-z">Auto Z</button>
      <button id="bi-auto-stop">Stop</button>
    </div>

    <div class="preset-row">
      <button class="preset-btn" data-preset="fist">✊ Fist</button>
      <button class="preset-btn" data-preset="open">🖐 Open</button>
      <button class="preset-btn" data-preset="point">👆 Point</button>
      <button class="preset-btn" data-preset="peace">✌ Peace</button>
      <button class="preset-btn" data-preset="tpose">🏋 T-Pose</button>
      <button class="preset-btn" data-preset="arms-down">🧍 Arms Down</button>
    </div>

    <div class="info" id="bi-info">Select a bone to inspect</div>
  `;

  document.body.appendChild(inspectorPanel);

  const select = document.getElementById("bi-bone-select");
  const bones = avatar.bones;

  // Group bones by category
  const categories = {
    "── Head ──": ["head", "neck", "leftEye", "rightEye"],
    "── Torso ──": ["hips", "spine", "chest", "upperChest"],
    "── Left Arm ──": ["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"],
    "── Right Arm ──": ["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"],
    "── Left Leg ──": ["leftUpperLeg", "leftLowerLeg", "leftFoot"],
    "── Right Leg ──": ["rightUpperLeg", "rightLowerLeg", "rightFoot"],
    "── Left Fingers ──": [
      "leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal",
      "leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal",
      "leftMiddleProximal", "leftMiddleIntermediate", "leftMiddleDistal",
      "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
      "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
    ],
    "── Right Fingers ──": [
      "rightThumbMetacarpal", "rightThumbProximal", "rightThumbDistal",
      "rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal",
      "rightMiddleProximal", "rightMiddleIntermediate", "rightMiddleDistal",
      "rightRingProximal", "rightRingIntermediate", "rightRingDistal",
      "rightLittleProximal", "rightLittleIntermediate", "rightLittleDistal",
    ],
  };

  for (const [label, boneNames] of Object.entries(categories)) {
    const optGroup = document.createElement("optgroup");
    optGroup.label = label;

    for (const name of boneNames) {
      if (!bones[name]) continue;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      optGroup.appendChild(opt);
    }

    if (optGroup.children.length > 0) {
      select.appendChild(optGroup);
    }
  }

  const sliderX = document.getElementById("bi-x");
  const sliderY = document.getElementById("bi-y");
  const sliderZ = document.getElementById("bi-z");
  const valX = document.getElementById("bi-x-val");
  const valY = document.getElementById("bi-y-val");
  const valZ = document.getElementById("bi-z-val");
  const info = document.getElementById("bi-info");

  function selectBone(name) {
    currentBone = bones[name];
    if (!currentBone) return;

    const r = currentBone.rotation;
    sliderX.value = Math.round(r.x * 57.3);
    sliderY.value = Math.round(r.y * 57.3);
    sliderZ.value = Math.round(r.z * 57.3);
    updateLabels();
    updateInfo(name);
  }

  function updateLabels() {
    valX.textContent = sliderX.value + "°";
    valY.textContent = sliderY.value + "°";
    valZ.textContent = sliderZ.value + "°";
  }

  function applySliders() {
    if (!currentBone) return;
    currentBone.rotation.x = parseInt(sliderX.value) / 57.3;
    currentBone.rotation.y = parseInt(sliderY.value) / 57.3;
    currentBone.rotation.z = parseInt(sliderZ.value) / 57.3;
    updateLabels();
  }

  function updateInfo(name) {
    if (!currentBone) return;

    const r = currentBone.rotation;
    const q = currentBone.quaternion;
    const wp = new THREE.Vector3();
    currentBone.getWorldPosition(wp);

    let text = `Bone: ${name}\n`;
    text += `Local Euler: (${(r.x*57.3).toFixed(1)}°, ${(r.y*57.3).toFixed(1)}°, ${(r.z*57.3).toFixed(1)}°)\n`;
    text += `Quat: (${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}, ${q.w.toFixed(3)})\n`;
    text += `World Pos: (${wp.x.toFixed(3)}, ${wp.y.toFixed(3)}, ${wp.z.toFixed(3)})\n`;
    text += `Parent: ${currentBone.parent?.name || "none"}\n`;
    text += `Children: ${currentBone.children.length}`;

    info.textContent = text;
  }

  select.addEventListener("change", () => selectBone(select.value));

  for (const slider of [sliderX, sliderY, sliderZ]) {
    slider.addEventListener("input", applySliders);
  }

  document.getElementById("bi-reset").addEventListener("click", () => {
    sliderX.value = 0;
    sliderY.value = 0;
    sliderZ.value = 0;
    applySliders();
  });

  document.getElementById("bi-reset-all").addEventListener("click", () => {
    for (const bone of Object.values(bones)) {
      if (bone) bone.rotation.set(0, 0, 0);
    }
    sliderX.value = 0;
    sliderY.value = 0;
    sliderZ.value = 0;
    updateLabels();
    console.log("[BoneInspector] All bones reset to 0");
  });

  function startAutoRotate(axis) {
    stopAutoRotate();
    autoRotateAxis = axis;
    autoRotateTime = 0;

    inspectorInterval = setInterval(() => {
      if (!currentBone) return;
      autoRotateTime += 0.05;
      const angle = Math.sin(autoRotateTime) * 90;

      if (axis === "x") sliderX.value = Math.round(angle);
      if (axis === "y") sliderY.value = Math.round(angle);
      if (axis === "z") sliderZ.value = Math.round(angle);

      applySliders();
      updateInfo(select.value);
    }, 33);

    document.querySelectorAll("#bone-inspector .btn-row button").forEach(b => b.classList.remove("active"));
    document.getElementById(`bi-auto-${axis}`)?.classList.add("active");
  }

  function stopAutoRotate() {
    if (inspectorInterval) {
      clearInterval(inspectorInterval);
      inspectorInterval = null;
    }
    autoRotateAxis = null;
    document.querySelectorAll("#bone-inspector .btn-row button").forEach(b => b.classList.remove("active"));
  }

  document.getElementById("bi-auto-x").addEventListener("click", () => startAutoRotate("x"));
  document.getElementById("bi-auto-y").addEventListener("click", () => startAutoRotate("y"));
  document.getElementById("bi-auto-z").addEventListener("click", () => startAutoRotate("z"));
  document.getElementById("bi-auto-stop").addEventListener("click", stopAutoRotate);

  const presets = {
    fist: () => {
      const curlAmount = -1.4; // ~80°
      const fingerBones = [
        "IndexProximal", "IndexIntermediate", "IndexDistal",
        "MiddleProximal", "MiddleIntermediate", "MiddleDistal",
        "RingProximal", "RingIntermediate", "RingDistal",
        "LittleProximal", "LittleIntermediate", "LittleDistal",
      ];
      for (const side of ["left", "right"]) {
        for (const fb of fingerBones) {
          const bone = bones[side + fb];
          if (bone) {
            bone.rotation.set(0, 0, side === "left" ? curlAmount : -curlAmount);
          }
        }
        const t1 = bones[side + "ThumbMetacarpal"];
        const t2 = bones[side + "ThumbProximal"];
        const t3 = bones[side + "ThumbDistal"];
        const sign = side === "left" ? -1 : 1;
        if (t1) t1.rotation.set(0, -0.5 * sign, -0.8 * sign);
        if (t2) t2.rotation.set(0, 0, -0.6 * sign);
        if (t3) t3.rotation.set(0, 0, -0.4 * sign);
      }
      console.log("[Preset] Fist — curled all fingers Z-axis");
    },

    open: () => {
      const fingerNames = [
        "ThumbMetacarpal", "ThumbProximal", "ThumbDistal",
        "IndexProximal", "IndexIntermediate", "IndexDistal",
        "MiddleProximal", "MiddleIntermediate", "MiddleDistal",
        "RingProximal", "RingIntermediate", "RingDistal",
        "LittleProximal", "LittleIntermediate", "LittleDistal",
      ];
      for (const side of ["left", "right"]) {
        for (const fn of fingerNames) {
          const bone = bones[side + fn];
          if (bone) bone.rotation.set(0, 0, 0);
        }
      }
      console.log("[Preset] Open hand — all fingers to 0");
    },

    point: () => {
      presets.fist();
      for (const side of ["left", "right"]) {
        for (const seg of ["Proximal", "Intermediate", "Distal"]) {
          const bone = bones[side + "Index" + seg];
          if (bone) bone.rotation.set(0, 0, 0);
        }
      }
      console.log("[Preset] Point — index extended, rest curled");
    },

    peace: () => {
      presets.fist();
      for (const side of ["left", "right"]) {
        for (const finger of ["Index", "Middle"]) {
          for (const seg of ["Proximal", "Intermediate", "Distal"]) {
            const bone = bones[side + finger + seg];
            if (bone) bone.rotation.set(0, 0, 0);
          }
        }
      }
      console.log("[Preset] Peace — index + middle extended");
    },

    tpose: () => {
      for (const bone of Object.values(bones)) {
        if (bone) bone.rotation.set(0, 0, 0);
      }
      console.log("[Preset] T-Pose — all bones reset");
    },

    "arms-down": () => {
      presets.tpose();
      if (bones.leftUpperArm) bones.leftUpperArm.rotation.set(0, 0, 1.2);
      if (bones.rightUpperArm) bones.rightUpperArm.rotation.set(0, 0, -1.2);
      if (bones.leftLowerArm) bones.leftLowerArm.rotation.set(0, 0, 0.3);
      if (bones.rightLowerArm) bones.rightLowerArm.rotation.set(0, 0, -0.3);
      console.log("[Preset] Arms down — rotated upper arms Z");
    },
  };

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (presets[preset]) {
        presets[preset]();
        if (currentBone) {
          sliderX.value = Math.round(currentBone.rotation.x * 57.3);
          sliderY.value = Math.round(currentBone.rotation.y * 57.3);
          sliderZ.value = Math.round(currentBone.rotation.z * 57.3);
          updateLabels();
        }
      }
    });
  });

  document.getElementById("bi-close").addEventListener("click", () => {
    stopAutoRotate();
    inspectorPanel.remove();
    inspectorPanel = null;
    console.log("[BoneInspector] Closed");
  });

  if (select.options.length > 0) {
    select.selectedIndex = 0;
    selectBone(select.value);
  }

  // Live info update loop
  inspectorInterval = setInterval(() => {
    if (currentBone && select.value) {
      updateInfo(select.value);
    }
  }, 200);

  console.log("[BoneInspector] Opened — statically imported THREE.");
}

export function closeBoneInspector() {
  if (inspectorInterval) clearInterval(inspectorInterval);
  if (inspectorPanel) inspectorPanel.remove();
  inspectorPanel = null;
  inspectorInterval = null;
  console.log("[BoneInspector] Closed");
}