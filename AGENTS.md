# AGENTS.md — LiveAnchor: Complete Project Guide (God-Tier Edition)

## 📋 Project Overview

**LiveAnchor** is a web-based real-time avatar tracking application that combines **local computer vision** with **cloud-based multimodal AI** to deliver a production-grade VTuber pipeline in the browser:

- Streams webcam video via `navigator.mediaDevices.getUserMedia`
- Runs MediaPipe pose/face/hand landmark detection (WASM binaries) at 60 FPS
- Drives a VRM (Virtual Reality Model) avatar with Three.js + `@pixiv/three-vrm`
- **NEW:** Streams 1 FPS video heartbeats to **Gemini Robotics ER-2 Streaming API** via WebSocket for semantic hand/gesture overrides
- Supports expressive facial animations, anatomically-correct finger curling, 2-bone IK, and procedural prop grips
- Includes privacy masking, recording, diagnostic HUD, and automated test suite

**Primary Use Case:** Real-time avatar animation from webcam — suitable for VTubing, virtual try-ons, livestreaming, and interactive media.

**Target Platform:** Web browsers on desktop and mobile (medium-tier Android phones).

---

## 🏗️ Architecture — 7 Layered Structure

The project now follows a **7-layer architecture**. The new Layer 6 (AI Director) sits above the Real-Time Layer and provides semantic overrides.

| Layer | Description | Key Files |
|---|---|---|
| **1. Foundation** | Webcam access + MediaPipe model initialization | `app/init.js`, `tracker/index.js`, `models/` |
| **2. Sync Layer** | Filter pipelines for smoothing & noise reduction | `filters/index.js`, `filters/oneEuro.js`, `filters/kalman.js` |
| **3. Async Layer** | Per-frame landmark extraction from MediaPipe output | `tracker/face.js`, `tracker/body.js`, `tracker/hands.js` |
| **4. Real-Time Layer** | Avatar bone driving, IK, expressions, animations | `avatar/index.js`, `avatar/drivers.js`, `avatar/expressions.js`, `avatar/overrides.js`, `avatar/props.js` |
| **5. Frontend Layer** | UI controls, HUD, user interactions | `app.js`, `app/controls.js`, `app/debug.js`, `index.html`, `style.css` |
| **6. AI Director Layer** 🆕 | Gemini Live WebSocket client, semantic overrides, hand occlusion recovery | `app/gemini-client.js`, `app/gemini-live-throttler.js`, `app/profiler.js` |
| **7. Advanced Features** | Privacy, recording, lifting mode, test suite | `app/privacy.js`, `recorder.js`, `lifting/`, `testing/` |

---

## 📁 Complete File Inventory & Role Descriptions

### 🆕 AI Director Layer (Gemini Live API)

| File | Lines | Role |
|---|---|---|
| `app/gemini-client.js` | ~220 | WebSocket client for Gemini ER-2 Streaming API. Handles setup, heartbeats, tool calls (`set_emotion`, `spawn_prop`, `trigger_gesture`, `set_hand_ik_target`, `ack`). Auto-reconnects on drops. |
| `app/gemini-live-throttler.js` | ~45 | 1 FPS JPEG throttler. Draws webcam frames to offscreen canvas, converts to base64, fires `onHeartbeat` callback. Disposes cleanly on camera flip. |
| `app/profiler.js` | ~80 | Diagnostic HUD overlay. Tracks FPS, inference latency, GPU memory, and Gemini connection status (🔴 Offline / 🟢 Live). |

### Core Tracker Files

| File | Lines | Role |
|---|---|---|
| `tracker/index.js` | 227 | Main tracker class — preset auto-detection, MediaPipe initializer, WebGL probe with context cleanup (`WEBGL_lose_context`) |
| `tracker/face.js` | ~180 | `extractFace()` — yaw/pitch/roll, **de-crossed eye gaze** (dead zone + outward bias), mouth open, blendshapes |
| `tracker/body.js` | 223 | `extractFullBody()` — shoulder/hip width, torso rotation, limb angles, mode detection |
| `tracker/hands.js` | ~200 | `extractHand()` — 21 landmarks per hand, finger curl values |
| `tracker/constants.js` | 75 | FACE/POSE/HAND landmark index constants |
| `tracker/wasm/` | — | MediaPipe WASM bundles |

### Core Avatar Files

| File | Lines | Role |
|---|---|---|
| `avatar/index.js` | ~330 | Main `AvatarController` — semantic override state machine (`handOverrides`, `activeGestures`), `setEmotion()`, `triggerGesture()`, `setHandIKTarget()`, `spawnProp()`, WebGL context loss handling |
| `avatar/bones.js` | ~200 | `findAllBones()`, `captureRestPose()`, rest pose data |
| `avatar/drivers.js` | ~400 | `driveHead()`, `driveEyes()` (with anatomical yaw/pitch limits), `driveTorso()`, `driveHips()`, `driveLimbs()`, `driveFingers()` (with anatomically-correct per-joint curl limits) |
| `avatar/overrides.js` 🆕 | ~120 | **NEW:** Analytic 2-bone IK solver, gesture pose library (`peace_sign`, `thumbs_up`, `pointing`, `open_palm`, `rock_on`), procedural grip pose, IK anchor table |
| `avatar/props.js` 🆕 | ~80 | **NEW:** `PropManager` class — spawns/despawns 3D props, attaches to hand bones with grip offsets, tracks held state |
| `avatar/expressions.js` | ~100 | Expression shape mapping |
| `avatar/gaze.js` 🆕 | ~60 | **NEW:** `EyeGazeSolver` class — normalized iris offsets, dead zone (microsaccade filter), de-crossing bias (cancels screen convergence) |
| `avatar/loader.js` | ~80 | `loadVRM()`, `measureModel()` |
| `avatar/target.js` | ~80 | `_visiblePlane()`, `computeTarget()` |
| `avatar/constants.js` | ~80 | Bone/finger/face index constants |

### Core Filter Files

| File | Lines | Role |
|---|---|---|
| `filters/index.js` | 265 | `FilterPipeline` — `filterFace()`, `filterBody()`, `filterHands()` |
| `filters/oneEuro.js` | 212 | `OneEuroFilter`, `OneEuroFilterPose`, `OneEuroFilterVec3` |
| `filters/kalman.js` | 75 | `KalmanFilter1D`, `KalmanFilterVec3` |

### Core App Files

| File | Lines | Role |
|---|---|---|
| `app.js` | 154 | Main entry — imports controls, exposes test functions |
| `app/init.js` | ~170 | Starts camera, creates `Tracker` and `AvatarController`, **initializes Gemini client + throttler + profiler**, wires all semantic override callbacks |
| `app/controls.js` | 154 | All UI event handlers |
| `app/loop.js` | ~100 | Animation loop, FPS tracking |
| `app/debug.js` | 48 | `formatDebugHUD()` |
| `app/privacy.js` | 94 | Person privacy masking |

### Testing

| File | Role |
|---|---|
| `testing/phase1.js` | 20 tests (T01–T20) — full test suite |
| `testing/hands.js` | Hand-specific tests |
| `testing/boneInspector.js` | Bone rotation diagnostic tool |
| `testing/gaze.js` 🆕 | **NEW:** Mock pipeline test for `EyeGazeSolver` — feeds synthetic landmarks, validates dead zone, clamping, de-crossing bias |

### Research & Assets

| Directory | Contents |
|---|---|
| `research papers/` | 17 academic papers on pose tracking, FlexPoseNet, ZoeDepth |
| `models/` | MediaPipe task files + VRM models (`avatar.vrm`, `miku_skeleton.json` baked data) |
| `avatar/` | VRM model files |
| `kinematics/` | Constraint, contact, Hybrik kinematics files |
| `lifting/` | Lifting-related code |
| `filters/` | Smoothing filter implementations |
| `tracker/` | MediaPipe integration |
| `testing/` | Test suite |

---

## 🤖 AI Director Architecture (Layer 6)

The AI Director uses a **hybrid architecture** that divides labor by latency and capability:

| Component | Responsibility | Latency |
|---|---|---|
| **MediaPipe (Local)** | Frame-by-frame joint coordinates (face, body, hands) | 16ms (60 FPS) |
| **Gemini ER-2 (Cloud)** | Semantic intent (occlusions, gestures, prop interactions) | 200–800ms (1 FPS) |

### The Heartbeat Pattern

Every second, the throttler sends a JPEG frame + text prompt to Gemini:

```javascript
{
  clientContent: {
    turns: [{ role: "user", parts: [
      { inlineData: { data: base64Jpeg, mimeType: "image/jpeg" } },
      { text: "[HEARTBEAT] Observe the user's hands..." }
    ]}],
    turnComplete: true
  }
}
```

Gemini responds with **tool calls** that override local tracking when needed:

| Tool | Trigger Condition | Local Action |
|---|---|---|
| `trigger_gesture` | Clear hand sign detected | Applies pre-baked pose (`peace_sign`, `thumbs_up`, etc.) for 3 seconds |
| `set_hand_ik_target` | Hand occluded / behind back / holding object | Switches to analytic 2-bone IK targeting body anchor (`hip`, `chest`, `mouth`, `behind_back`, `chin`, `release`) |
| `spawn_prop` | User holding real-world object | Attaches 3D prop mesh to hand bone + activates procedural grip |
| `ack` | No action needed | Silent acknowledgment, MediaPipe continues |

### Token Budget (Gemini ER-2)

| Metric | Value |
|---|---|
| Video input rate | 1 FPS JPEG (~3.5k image tokens/frame) |
| Text heartbeat | ~2.4k tokens/beat |
| Session limit | 2 minutes (video+audio) → auto-reconnect required |
| Recommended `mediaResolution` | `MEDIA_RESOLUTION_LOW` (saves ~60% tokens) |

---

## ⚙️ Preset System — Performance Tiers

Three performance tiers are auto-detected at startup:

| Preset | GPU Target | Faces | Pose Model | Hands | Auto-detect Logic |
|---|---|---|---|---|---|
| `low` | Weak GPU / integrated | 1 | `pose_landmarker_lite.task` | 0 | No WebGL2 → low; Intel HD/GMA/Mesa → low |
| `medium` | Good mobile GPU | 1 | `pose_landmarker_full.task` | 2 | Adreno/Mali/Apple GPU → medium |
| `high` | Phone / powerful GPU | 4 | `pose_landmarker_full.task` | 2 | Default when GPU is capable |

**NEW:** GPU probe now calls `WEBGL_lose_context` immediately after detection to prevent context exhaustion.

---

## 📱 Medium-Tier Android Constraints & Mitigations

| Constraint | Impact | Mitigation |
|---|---|---|
| **GPU** — Adreno/Mali mobile GPUs | WebGL2 performance varies | Use `"medium"` preset; cap resolution at 640×480 |
| **Memory** — 2–4 GB typical | VRM + WASM + WebGL contexts can exceed budget | `VRMUtils.deepDispose` on unload; `loseContext` on HMR; throttle 1 FPS to Gemini |
| **CPU** — Kryo/A78 | MediaPipe dominates CPU budget | OneEuro filtering reduces jitter without extra passes |
| **WebGL Contexts** — Limited to ~16 per process | Hot-reload leaks contexts → `kGpuService` crash | Probe releases context; HMR `dispose()` handler added |
| **Battery** — Sustained inference drains fast | Gemini WebSocket adds network overhead | 1 FPS heartbeat only; `MEDIA_RESOLUTION_LOW` reduces token cost |

---

## ⚡ Performance Optimizations

### Local Pipeline
1. **Resolution cap** — `{ ideal: 640×480 }` for medium-tier
2. **Filter smoothing** — OneEuro adaptive low-pass
3. **Per-frame throttling** — `loop.js:tick` caps `dt` to 0.1s
4. **VRM pixel ratio** — `Math.min(window.devicePixelRatio, 2)`
5. **Bone rest pose** — Precomputed, avoids per-frame inverse calculations
6. **Expression batching** — Single pass through blendshapes
7. **Reusable temp objects** — `_v3a`, `_v3b`, `_qa`, `_qb`, `_euler` in `avatar/constants.js`
8. **WebGL context hygiene** — Probe releases context; HMR cleanup

### AI Director Pipeline
9. **1 FPS heartbeat** — Only 1 frame/second sent to Gemini (vs 60 FPS local)
10. **`MEDIA_RESOLUTION_LOW`** — Reduces image token cost by ~60%
11. **`pendingTurn` lock** — Prevents heartbeat from interrupting in-flight model responses
12. **Auto-reconnect** — Restores session after 2-minute limit or network drop
13. **Semantic-only AI** — Local models handle face/body; AI only handles hard cases (occlusions, gestures)

---

## 🧪 Test Suite

### Running Tests
```js
window.runPhase1Tests();      // Full 20-test suite
window.testHeadSigns();      // Calibrate head sign directions
window.testFilterQuality();  // Measure filter jitter
window.testHands();          // Hand tracking accuracy
window.testFingerDriver();   // Force fist to test bone rotation
window.testGaze();           // 🆕 Validate EyeGazeSolver
window.openBoneInspector();  // Live bone rotation tool
```

### Test Coverage
- **T01–T08:** Camera, resolution, MediaPipe init, filters, avatar load, bones, smoothing
- **T09–T14:** VRM meta, bone availability, FPS, camera flip, privacy mask
- **T15–T20:** Advanced features, expression mapping, gesture detection

---

## 🐛 Debugging on Device

### Common Console Checks

```js
// Local tracking
console.log("Running:", state.running);
console.log("Preset:", window.tracker?.preset?.label);
console.log("Avatar state:", window.avatar?.state);
console.log("FPS:", Math.round(frames / ((now - fpsTime) / 1000)));

// AI Director
console.log("Gemini connected:", state.geminiClient?.isConnected);
console.log("Hand overrides:", window.avatar?.handOverrides);
console.log("Active gestures:", window.avatar?.activeGestures);
console.log("Held props:", window.avatar?.props?.held);

// Gaze solver
console.log("De-cross bias:", 0.12);
console.log("Dead zone:", 0.04);

// WebGL health
const gl = document.querySelector('canvas')?.getContext('webgl2');
console.log("WebGL contexts lost:", gl?.isContextLost());
```

### Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| `kGpuService` / WebGL creation failed | Context exhaustion from HMR | Restart browser; add `loseContext` to probe |
| Avatar looks crosseyed | Raw iris landmarks mapped directly | Use `EyeGazeSolver` with de-crossing bias |
| Eyes jitter nervously | Microsaccades amplified | Increase `GAZE_DEAD_ZONE` to 0.05 |
| Fingers don't close | Sign bug or PIP under-bent | Use anatomical `FINGER_JOINT_LIMITS` [1.55, 1.85, 0.85] |
| Gemini never responds | Heartbeat missing `turnComplete: true` | Use `clientContent` (not `realtimeInput`) with `turnComplete` |
| Gemini silent when idle | ER-2 only emits turns when action needed | Normal behavior; `ack` tool reduces noise |
| `hand.handForward is not iterable` | Tracker returns `{x,y,z}` object, not array | Use `toVector3()` helper |

---

## 📋 Deployment Checklist (Medium-Tier Android)

- [ ] Default resolution ≤ 640×480
- [ ] Preset auto-detects correctly
- [ ] `window.runPhase1Tests()` all PASS/WARN-only
- [ ] Avatar VRM loads without errors
- [ ] FPS ≥ 20 on sustained run
- [ ] Camera flip handles single-camera gracefully
- [ ] `stopApp()` releases all tracks + Gemini client
- [ ] VRM disposal runs on unload
- [ ] WebGL context probe releases context
- [ ] HMR cleanup disposes tracker + avatar
- [ ] Gemini WebSocket connects + receives `setupComplete`
- [ ] 1 FPS heartbeat fires (check network tab)
- [ ] Tool calls (`set_hand_ik_target`, `trigger_gesture`) fire on occlusion/gestures
- [ ] `EyeGazeSolver` reduces crosseyed look
- [ ] Diagnostic HUD shows Gemini status (🟢 Live)

---

## 🔐 Security Notes

- **API key exposure:** `VITE_GEMINI_API_KEY` is embedded in client bundle. For production, use [ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens) via a backend proxy.
- **Privacy mask:** `PERSON_THRESHOLD = 127` in `app/privacy.js` masks detected persons on the canvas overlay.
- **CORS:** MediaPipe WASM files served from `/tracker/wasm/`; ensure CORS headers allow same-origin.

---

## 🚀 Extension Points

### Adding New Semantic Tools
1. Add `functionDeclaration` to `gemini-client.js` setup payload
2. Add callback to `GeminiLiveClient` constructor
3. Wire callback in `app/init.js`
4. Add state + method to `AvatarController`
5. Apply in `_applySemanticOverrides()` after `driveLimbs`/`driveFingers`

### Adding New Gestures
1. Add enum value to `trigger_gesture` parameters
2. Add pose to `GESTURE_POSES` in `avatar/overrides.js`
3. Add to heartbeat prompt text

### Adding New IK Anchors
1. Add enum value to `set_hand_ik_target` parameters
2. Add model-space coordinate to `ANCHORS` in `avatar/overrides.js`
3. Add case to `applySemanticIK()` switch

### Adding New Props
1. Extend `_buildMesh()` in `avatar/props.js` with geometry for new prop names
2. Gemini will auto-detect and spawn via `spawn_prop`
