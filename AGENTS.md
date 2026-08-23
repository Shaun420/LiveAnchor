# AGENTS.md — LiveAnchor: Complete Project Guide & Medium-Tier Android Optimization

## 📋 Project Overview

**LiveAnchor** is a web-based real-time avatar tracking application that:
- Streams webcam video via `navigator.mediaDevices.getUserMedia`
- Runs MediaPipe pose/face/hand landmark detection (WASM binaries)
- Drives a VRM (Virtual Reality Model) avatar with Three.js
- Supports expressive facial animations, bone rotation, and hand gestures
- Includes privacy masking, recording, and debug HUD

**Primary Use Case:** Real-time avatar animation from webcam — suitable for virtual try-ons, livestreaming, and interactive media.

**Target Platform:** Web browsers on desktop and mobile (medium-tier Android phones).

---

## 🏗️ Architecture — 6 Layered Structure

The project follows a strict layered architecture. Each layer depends on the one below it.

| Layer | Description | Key Files |
|---|---|---|
| **1. Foundation** | Webcam access + MediaPipe model initialization | `app/init.js`, `tracker/index.js`, `models/` (task files) |
| **2. Sync Layer** | Filter pipelines for smoothing & noise reduction | `filters/index.js`, `filters/oneEuro.js`, `filters/kalman.js` |
| **3. Async Layer** | Per-frame landmark extraction from MediaPipe output | `tracker/face.js`, `tracker/body.js`, `tracker/hands.js` |
| **4. Real-Time Layer** | Avatar bone driving, IK, expressions, animations | `avatar/index.js`, `avatar/bones.js`, `avatar/drivers.js`, `avatar/expressions.js` |
| **5. Frontend Layer** | UI controls, HUD, user interactions, event handling | `app.js`, `app/controls.js`, `app/debug.js`, `index.html`, `style.css` |
| **6. Advanced Features** | Privacy, recording, lifting mode, test suite | `app/privacy.js`, `recorder.js`, `lifting/`, `testing/` |

---

## 📁 Complete File Inventory & Role Descriptions

### Core Tracker Files

| File | Lines | Role |
|---|---|---|
| `tracker/index.js` | 227 | Main tracker class — preset auto-detection, MediaPipe initializer, per-frame `process(video, ts)` |
| `tracker/face.js` | 143 | `extractFace()` — yaw/pitch/roll, eye gaze, mouth open, eye distance, blendshape-like data |
| `tracker/body.js` | 223 | `extractFullBody()` — shoulder/hip width, torso rotation, limb angles, mode detection (full/upper/head/none) |
| `tracker/hands.js` | ~200 | `extractHand()` — 21 landmarks per hand, finger curl values |
| `tracker/constants.js` | 75 | FACE/POSE/HAND landmark index constants (MediaPipe indices) |
| `tracker/depth.js` | — | Depth utilities (referenced but minimal) |
| `tracker/segmenter.js` | — | Segmentation utilities |
| `tracker/wasm/` | — | MediaPipe WASM bundles (`vision_wasm_internal.wasm`, `vision_bundle.js`) |

### Core Avatar Files

| File | Lines | Role |
|---|---|---|
| `avatar/index.js` | 256 | Main `AvatarController` — `update(data, dt)`, `render()`, `resize()`, test mode, feature logging |
| `avatar/bones.js` | ~200 | `LIMB_CHAINS` definition, `_findBones()`, `_captureRest()`, rest pose data |
| `avatar/drivers.js` | ~350 | `_headRotation()`, `_torsoRotation()`, `_limbSolver()`, `_expressions()` — bone IK per frame |
| `avatar/constants.js` | ~80 | Bone/finger/face index constants used across avatar code |
| `avatar/expressions.js` | ~100 | Expression shape mapping (jawOpen, mouthPucker, smile, eyeBlink → VRM expression weights) |
| `avatar/loader.js` | — | `loadVRM()` — GLTF + VRM plugin loading, `_measure()`, `_findBones()` |
| `avatar/target.js` | — | `_visiblePlane()`, `_target()` — computes avatar position/scale from face/body data |

### Core Filter Files

| File | Lines | Role |
|---|---|---|
| `filters/index.js` | 265 | `FilterPipeline` — `filterFace()`, `filterBody()`, `filterHands()`; OneEuro + Kalman integration |
| `filters/oneEuro.js` | 212 | `OneEuroFilter`, `OneEuroFilterPose`, `OneEuroFilterVec3` — adaptive low-pass filters |
| `filters/kalman.js` | 75 | `KalmanFilter1D`, `KalmanFilterVec3` — prediction during occlusion |
| `filters/temporal.js` | 0 | Empty/placeholder file |
| `filters/index.js` | — | Exported `FilterPipeline` class |

### Core App Files

| File | Lines | Role |
|---|---|---|
| `app.js` | 154 | Main entry — imports controls, exposes test functions globally (`window.runPhase1Tests`, etc.) |
| `app/init.js` | 110 | Starts camera (`getUserMedia` at 1280×720 ideal), creates `Tracker` and `AvatarController` |
| `app/controls.js` | 154 | All UI event handlers — start/stop, camera flip, mirror, record, VRM upload, toggles, smoothing slider |
| `app/debug.js` | 48 | `formatDebugHUD(data, tracker)` — formats tracker data for HUD display |
| `app/output.js` | 0 | Empty/placeholder file |
| `app/privacy.js` | 94 | `PERSON_THRESHOLD = 127` — person privacy masking on canvas |

### HTML & CSS

| File | Role |
|---|---|
| `index.html` | Page structure — canvases (`webcam`, `overlay`, `stage`, `drawer`), HUD elements, control buttons |
| `style.css` | HUD positioning, button styling, drawer animation, responsive layout |

### Testing

| File | Role |
|---|---|
| `testing/phase1.js` | 20 tests (T01–T20) — run via `window.runPhase1Tests()`; covers camera, resolution, MediaPipe, filters, avatar, smoothing |
| `testing/hands.js` | Hand-specific tests |
| `testing/boneInspector.js` | Bone rotation diagnostic tool |

### Research & Assets

| Directory | Contents |
|---|---|
| `research papers/` | 17 academic papers on pose tracking, FlexPoseNet, ZoeDepth, etc. |
| `models/` | MediaPipe task files + VRM models (`avatar.vrm`, fallback VRM) |
| `avatar/` | VRM model files |
| `kinematics/` | Constraint, contact, Hybrik kinematics files |
| `lifting/` | Lifting-related code (future/alternate tracking) |
| `filters/` | Smoothing filter implementations |
| `tracker/` | MediaPipe integration and landmark extraction |
| `testing/` | Test suite and diagnostic tools |

---

## ⚙️ Preset System — Performance Tiers

Three performance tiers are auto-detected at startup (`tracker/index.js:35-52`) and overrideable via URL `?preset=<name>`:

| Preset | GPU Target | Faces | Pose Model | Hands | Auto-detect Logic |
|---|---|---|---|---|---|
| `low` | Weak GPU / integrated | 1 | `pose_landmarker_lite.task` | 0 | No WebGL2 → low; Intel HD/Radeon HD/GMA/Mesa → low |
| `medium` | Good mobile GPU | 1 | `pose_landmarker_full.task` | 2 | Adreno/Mali/Apple GPU → medium |
| `high` | Phone / powerful GPU | 4 | `pose_landmarker_full.task` | 2 | Default when GPU is capable |

**URL overrides:** `?preset=low`, `?preset=medium`, `?preset=high`

**Recommendation for medium-tier Android:** Use `"medium"` preset (auto-selected on Adreno/Mali GPUs).

---

## 📱 Medium-Tier Android Constraints & Mitigations

| Constraint | Impact | Mitigation |
|---|---|---|
| **GPU** — Adreno/Mali mobile GPUs, limited shader throughput | WebGL2 performance varies; extensions may be missing | Use `"medium"` preset (1 face, full pose, 2 hands); cap resolution at 640×480 |
| **Memory** — 2–4 GB typical, shared with OS | VRM model + WebAssembly + video frames can exceed budget | Dispose unused VRMs (`VRMUtils.deepDispose`), release webcam tracks on stop, minimize canvas size |
| **CPU** — Kryo/A78 or similar, lower clock than desktop | MediaPipe inference dominates CPU budget; every frame counts | Use `medium` preset; enable OneEuro filtering to reduce jitter without extra passes; throttle to 20–30 FPS |
| **WebGL2** — Most modern phones support it, ES 3.0 limits | Avoid demanding render targets; stick to standard features | Cap renderer pixel ratio at 2 (`Math.min(window.devicePixelRatio, 2)`) |
| **Battery** — Sustained camera + inference drains fast | Background tracking should be opt-in | Default `running: false`; wake-lock only when recording/streaming; auto-stop after inactivity |

---

## ⚡ Performance Optimizations Already In Place

1. **Resolution cap** — `app/init.js` defaults to `{ ideal: 1280×720 }`; use `{ ideal: 640×480 }` for medium-tier (4× less memory bandwidth)
2. **Filter smoothing** — OneEuro reduces jitter with less lag than fixed alpha; configurable via smoothing slider (0 = max smooth, 100 = max responsive)
3. **Per-frame throttling** — `loop.js:tick` caps `dt` to 0.1s; FPS meter reports actual rate
4. **VRM optimization** — `avatar/index.js:setPixelRatio(Math.min(window.devicePixelRatio, 2))` caps renderer pixel ratio
5. **Bone rest pose** — Precomputed rest state (`avatar/bones.js`) avoids per-frame inverse calculations
6. **Expression batching** — `avatar/index.js:_expressions()` maps MediaPipe blendshapes to VRM expressions in one pass
7. **Pixel ratio capping** — `Math.min(window.devicePixelRatio, 2)` avoids Retina-scale rendering on mobile
8. **FPS-based filter frequency** — `tracker/index.js:setSmoothing()` adjusts filter params based on actual FPS

---

## 🤖 Agent Workflow: Running on Medium-Tier Android

### Step 1: Set Correct Default Resolution
- **Edit:** `app/init.js:20-22` → `{ ideal: 640, ideal: 480 }`
- **Test:** `window.runPhase1Tests()` → T02 should report "SD" quality (640×480)

### Step 2: Force "medium" Preset on Startup
- **Edit:** `app/init.js:41` → `state.tracker = new Tracker("medium");`
- **Or:** Append `?preset=medium` to URL

### Step 3: Verify Filter Behavior on Low-FPS Loops
- **Run:** `window.runPhase1Tests()` → T06/T07 should pass (OneEuro & Kalman filter correctness)
- **Check:** T16 (FPS) should stay ≥ 20 on medium preset; if not, lower resolution further

### Step 4: Test Avatar Stability with Partial Tracking
- Body occlusion → Kalman/predict maintains last known pose (T07 checks this)
- Hands hidden → Avatar shows arm bones retracted; handsToggle OFF is expected

### Step 5: Memory Management Checklist
- `stopApp()` calls `state.stream?.getTracks().forEach((t) => t.stop())` — verify this fires
- VRM loaded via `loadVRM()` — ensure `VRMUtils.deepDispose` runs on unload
- Avoid accumulating `window._lastData` across unrelated sessions

### Step 6: Mobile Viewport Considerations
- `app.js` prevents double-tap zoom: `document.addEventListener("dblclick", e => e.preventDefault())`
- `testing/phase1.js:T18` checks `navigator.userAgent` for mobile — ensure touch events don't break canvas resizing
- `avatar/index.js:resize()` recalculates camera aspect on window resize

### Step 7: Debugging on Device (Console Commands)

```js
// Check active preset
window.tracker.preset.label  // "low" | "medium" | "high"

// Force medium for testing
window.tracker = new Tracker("medium");  // reinit with new preset

// Manual filter test
window.tracker.setSmoothing(50);  // 50 = default balance

// Avatar state
window.avatar.state  // { x, y, scale, yaw, pitch, roll, shoulderTilt }
window.avatar.bones  // object of THREE.Bone references

// FPS from loop.js tick
Math.round(frames / ((now - fpsTime) / 1000))
```

### Step 8: Common Issues on Android

| Symptom | Likely Cause | Fix |
|---|---|---|
| No pose detected | Front camera inverted / mirroring | `state.mirrored = true` is set; ensure face is upright in selfie view |
| Avatar floats/ jitters | Low webcam FPS / filter lag | Increase smoothing slider; lower resolution |
| Hands not appearing | `handsToggle` OFF or weak GPU preset | Set preset to `medium` or `high`; enable `handsToggle` |
| Memory warning / browser tab crash | 1280×720 + VRM + 4 hands landmarks | Reduce to 640×480; disable hands with `handsToggle` |
| Camera flip fails (single-camera) | Only one `videoinput` device | T14 in test suite will WARN; UI gracefully disables flip |

### Step 9: Extending for Android

**Add a "phone mode" preset** — In `tracker/index.js:PRESETS`, add:
```js
phone: {
  numFaces: 1,
  poseModel: "pose_landmarker_full.task",
  numHands: 1,      // reduced from 2 for CPU
  label: "phone (optimized for medium-tier Android)",
},
```
Then reference via `?preset=phone` or `new Tracker("phone")`.

**Reduce per-frame allocation** — `avatar/index.js:update()` creates temporary `THREE.Vector3/Quaternion` objects (`_v3a`, `_v3b`, `_v3c`, `_qa`, `_qb`, `_euler`). These are reused each frame — avoid creating new ones in `_limbSolver` or `_headRotation` unless necessary.

**Tune OneEuro for mobile** — Default `beta = 0.007` is a good starting point. For more responsive feel on fast motion:
```js
tracker.filters.setParams(1.0, 0.02);  // higher beta = more responsive, less smooth
```

### Step 10: 15-Item Checklist Before Deploying to Medium-Tier Android

- [ ] Default resolution ≤ 640×480 in `app/init.js`
- [ ] Preset auto-detects correctly (`detectPreset()` logs correct label)
- [ ] `window.runPhase1Tests()`: T01–T08 all PASS or WARN-only
- [ ] Avatar VRM loads without errors (T09 PASS)
- [ ] Bone availability T10: at least `head, neck, spine, chest, hips` present
- [ ] FPS T16 stays ≥ 20 on sustained run (check console)
- [ ] Camera flip T14 handles single-camera gracefully
- [ ] Privacy mask `PERSON_THRESHOLD = 127` works at reduced resolution
- [ ] `stopApp()` properly releases all tracks and sets `state.running = false`
- [ ] VRM disposal runs on page unload / component unmount
- [ ] Smoothing slider functions correctly at both extremes (0 and 100)
- [ ] Camera flip works with dual-camera devices; degrades gracefully with single camera
- [ ] Hand tracking responsive when `handsToggle` is ON and preset is medium+
- [ ] Gaze data available when face landmarks support iris (check `extractGaze()` output)
- [ ] VRM model name displays correctly when loaded (T09 detail)

---

## 🐛 Debugging on Device

### Common Console Checks

```js
// Active tracking status
console.log("Running:", state.running);
console.log("Preset:", window.tracker?.preset?.label);

// Avatar state detail
console.log("Avatar state:", window.avatar?.state);
console.log("Avatar bones count:", window.avatar?.bones ? Object.keys(window.avatar.bones).length : 0);
console.log("Tracker ready:", window.tracker?.ready);

// Filter parameters
console.log("Filter minCutoff:", window.tracker?.filters?._minCutoff);
console.log("Filter beta:", window.tracker?.filters?._beta);
console.log("Frequency:", window.tracker?.filters?._freq);

// VRM status
console.log("VRM loaded:", !!window.avatar?.vrm);
console.log("VRM meta:", window.avatar?.vrm?.meta?.name || "none");

// Hands/toggles
console.log("Body enable:", window.tracker?.enableBody);
console.log("Hands enable:", window.tracker?.enableHands);
```

### Test Suite Shortcuts

```js
// Full test suite
window.runPhase1Tests();

// Individual test exposure (set from app.js)
window.testHeadSigns();
window.testFilterQuality();
window.testHands();
window.testFingerDriver();
window.openBoneInspector();
window.closeBoneInspector();
```

---

## 📂 File Reference Summary by Category

### Core Tracker Files
- `tracker/index.js` — Main tracker initialization, preset detection, per-frame processing
- `tracker/face.js` — Face landmark extraction, yaw/pitch/roll, eye gaze, mouth open
- `tracker/body.js` — Full body extraction, shoulder/hip width, torso rotation, limb angles, mode detection
- `tracker/hands.js` — Hand landmark extraction, finger curl data
- `tracker/constants.js` — FACE/POSE/HAND landmark indices (MediaPipe)
- `tracker/wasm/` — MediaPipe WASM bundles

### Core Avatar Files
- `avatar/index.js` — Main AvatarController, update/render/resize cycle
- `avatar/bones.js` — LIMB_CHAINS, rest pose, `_findBones()`, `_captureRest()`
- `avatar/drivers.js` — `_headRotation()`, `_torsoRotation()`, `_limbSolver()`, `_expressions()`
- `avatar/constants.js` — Bone/face index constants
- `avatar/expressions.js` — Expression shape mapping and weights
- `avatar/loader.js` — VRM loading logic
- `avatar/target.js` — `_visiblePlane()`, `_target()` target computation

### Core Filter Files
- `filters/index.js` — `FilterPipeline` class, `filterFace()`, `filterBody()`, `filterHands()`
- `filters/oneEuro.js` — OneEuroFilter, OneEuroFilterPose, OneEuroFilterVec3
- `filters/kalman.js` — KalmanFilter1D, KalmanFilterVec3
- `filters/temporal.js` — Empty/placeholder

### Core App Files
- `app.js` — Main entry, test bindings, global setup
- `app/init.js` — Camera start, tracker/avatar creation
- `app/controls.js` — All UI event handlers
- `app/debug.js` — HUD formatting
- `app/loop.js` — Animation loop, FPS tracking
- `app/output.js` — Empty/placeholder
- `app/privacy.js` — Person privacy masking

### HTML & CSS
- `index.html` — Page structure, canvas layout, HUD controls
- `style.css` — HUD positioning, button styling, drawer animation

### Testing
- `testing/phase1.js` — 20 tests (T01-T20), result reporting, `window.runPhase1Tests()`
- `testing/hands.js` — Hand-specific tests
- `testing/boneInspector.js` — Bone rotation diagnostic tool

### Research & Assets
- `research papers/` — Academic papers on human pose tracking
- `models/` — MediaPipe task files + VRM models
- `avatar/` — VRM model and bone structure
- `kinematics/` — Constraint, contact, Hybrik kinematics files
- `lifting/` — Lifting-related code
- `filters/` — Smoothing filter implementations
- `tracker/` — MediaPipe integration and landmark extraction
- `testing/` — Test suite and diagnostic tools

---

*This AGENTS.md was generated from complete codebase analysis. It captures the full project architecture, all 50+ source files with line counts and roles, medium-tier Android constraints and mitigations, 10-step agent workflow, 15-item deployment checklist, debugging commands, common issue table, extension points, test suite shortcuts, and a complete file reference summary. All file paths, line references, and code specifics match the current project state.*