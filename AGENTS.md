# AGENTS.md — LiveAnchor: Complete Project Guide (God-Tier Edition)

## 📋 Project Overview

**LiveAnchor** is a web-based real-time avatar tracking application that combines **local computer vision** with **cloud-based multimodal AI** to deliver a production-grade VTuber pipeline in the browser:

- Streams webcam video via `navigator.mediaDevices.getUserMedia`
- Runs MediaPipe pose/face/hand landmark detection (WASM binaries) at 60 FPS
- Drives a VRM (Virtual Reality Model) avatar with Three.js + `@pixiv/three-vrm`
- **Cloud AI Director:** Streams 1 FPS video heartbeats to **Gemini Robotics ER-2 Streaming API** via WebSocket for semantic hand/gesture/prop overrides
- **ONNX 3D Lifting:** Non-blocking Web Worker pose lifting (`MobileHumanPose` / `VideoPose3D`)
- Supports expressive facial animations, de-crossed eye gaze solver, anatomically-correct finger curling, 2-bone IK, and procedural prop grips
- Includes privacy masking, recording, diagnostic HUD, standalone testing app, and automated test suite

**Primary Use Case:** Real-time avatar animation from webcam — suitable for VTubing, virtual try-ons, livestreaming, and interactive media.

**Target Platform:** Web browsers on desktop and mobile (medium-tier Android phones).

---

## 🏗️ Architecture — 7 Layered Structure

The project follows a **7-layer architecture** separating high-frequency local reflexes (60 FPS) from cloud semantic guidance (1 FPS):

| Layer | Description | Key Files |
|---|---|---|
| **1. Foundation** | Webcam access + MediaPipe model initialization | `app/init.js`, `tracker/index.js`, `models/` |
| **2. Sync Layer** | Filter pipelines for smoothing & noise reduction | `filters/index.js`, `filters/oneEuro.js`, `filters/kalman.js` |
| **3. Async Layer** | Per-frame landmark extraction from MediaPipe output | `tracker/face.js`, `tracker/body.js`, `tracker/hands.js` |
| **4. Real-Time Layer** | Avatar bone driving, IK, expressions, 3D lifting, animations | `avatar/index.js`, `avatar/drivers.js`, `avatar/expressions.js`, `avatar/overrides.js`, `avatar/lifting.js`, `avatar/props.js` |
| **5. Frontend Layer** | UI controls, HUD profiler, user interactions | `app.js`, `app/controls.js`, `app/debug.js`, `index.html`, `style.css` |
| **6. AI Director Layer** | Gemini Live WebSocket client, semantic overrides, hand occlusion recovery | `app/gemini-client.js`, `app/gemini-live-throttler.js`, `app/profiler.js` |
| **7. Advanced Features** | Privacy masking, recording, ONNX 3D lifting worker, test suite | `app/privacy.js`, `recorder.js`, `app/poseLifter.js`, `app/poseLifterWorker.js`, `lifting/`, `testing/`, `tests/` |

---

## 📁 Complete File Inventory & Role Descriptions

### AI Director Layer (Gemini Live API)

| File | Lines | Role |
|---|---|---|
| `app/gemini-client.js` | ~270 | WebSocket client for Gemini ER-2 Streaming API (`gemini-robotics-er-2-streaming-preview`). Handles setup, heartbeats, tool calls (`trigger_gesture`, `set_hand_ik_target`, `spawn_prop`, `ack`). Auto-reconnects on session limits / drops. Features `pendingTurn` lock, `turnComplete: true`, socket injection for testing, and strict tool argument validation. |
| `app/gemini-live-throttler.js` | ~220 | **1 FPS JPEG Throttler:** Async encoding, dynamic aspect ratio sizing, frame deduplication via perceptual hash, CORS-safe `toBlob`, debug PiP view. Reads raw webcam (not privacy overlay) for AI Director. SSR/node guard in constructor. |
| `app/profiler.js` | ~98 | Diagnostic HUD overlay. Tracks FPS, inference latency, GPU memory, Gemini connection status (🔴 Offline / 🟢 Live), and recent tool dispatches. |

### Core Tracker Files

| File | Lines | Role |
|---|---|---|
| `tracker/index.js` | 227 | Main tracker class — preset auto-detection (`low`/`medium`/`high`), MediaPipe initializer, `detectPreset()` GPU probe, `WEBGL_lose_context` immediate cleanup after detection. Supports `?preset=videoPose3d` override. |
| `tracker/face.js` | ~180 | `extractFace()` — yaw/pitch/roll (Y-axis aligned to Three.js), **de-crossed eye gaze** (dead zone + outward bias), mouth open, blendshapes |
| `tracker/body.js` | 223 | `extractFullBody()` — shoulder/hip width, torso rotation, limb angles, mode detection |
| `tracker/hands.js` | ~200 | `extractHand()` — 21 landmarks per hand, finger curl values |
| `tracker/constants.js` | 75 | FACE/POSE/HAND landmark index constants |
| `tracker/wasm/` | — | MediaPipe WASM bundles |

### Core Avatar Files

| File | Lines | Role |
|---|---|---|
| `avatar/index.js` | ~370 | Main `AvatarController` — semantic override state machine (`handOverrides`, `activeGestures`), mode stabilization hysteresis, WebGL context loss recovery, lifted 3D pose integration, and `_applySemanticOverrides()` execution. |
| `avatar/bones.js` | ~200 | `findAllBones()`, `captureRestPose()`, rest pose data |
| `avatar/drivers.js` | ~400 | `driveHead()`, `driveEyes()` (with anatomical yaw/pitch limits), `driveTorso()`, `driveHips()`, `driveLimbs()`, `driveFingers()` (with anatomically-correct per-joint curl limits) |
| `avatar/overrides.js` | ~120 | Analytic 2-bone IK solver, gesture pose library (`peace_sign`, `thumbs_up`, `pointing`, `open_palm`, `rock_on`), procedural grip pose, IK anchor table (`hip`, `mouth`, `behind_back`, `chin`, `chest`, `release`) |
| `avatar/props.js` | ~80 | `PropManager` class — spawns/despawns 3D props, attaches to hand bones with grip offsets, tracks held state |
| `avatar/lifting.js` | ~75 | Maps ONNX-lifted 17 COCO 3D joints to VRM skeleton basis with anatomical coordinate alignment. |
| `avatar/expressions.js` | ~100 | Expression shape mapping |
| `avatar/gaze.js` | ~60 | `EyeGazeSolver` class — normalized iris offsets, dead zone (microsaccade filter), de-crossing bias (cancels screen convergence) |
| `avatar/loader.js` | ~130 | `loadVRM()` with VRM 0/1 support + fallback humanoid skeleton detector for standard GLTF/GLB models, `measureModel()` |
| `avatar/target.js` | ~75 | Camera ray unprojection for 2D-to-3D screen mapping with dynamic depth scaling based on eye distance. |
| `avatar/constants.js` | ~80 | Bone/finger/face index constants & reusable math scratch objects (`_v3a`, `_qa`, etc.) |

### Core Filter Files

| File | Lines | Role |
|---|---|---|
| `filters/index.js` | 265 | `FilterPipeline` — `filterFace()`, `filterBody()`, `filterHands()` |
| `filters/oneEuro.js` | 212 | `OneEuroFilter`, `OneEuroFilterPose`, `OneEuroFilterVec3` |
| `filters/kalman.js` | 75 | `KalmanFilter1D`, `KalmanFilterVec3` |

### Core App & Lifting Files

| File | Lines | Role |
|---|---|---|
| `app.js` | 154 | Main entry — imports controls, exposes test functions (`runPhase1Tests`, `testHeadSigns`, etc.) |
| `app/init.js` | ~240 | Starts camera, initializes `Tracker`, `AvatarController`, `PoseLifter`, `GeminiLiveClient`, `GeminiLiveThrottler`, and `PerformanceProfiler`. Handles camera flip and callback wiring. |
| `app/controls.js` | 154 | UI event handlers (start/stop, flip, mirror, record, settings, toggles) |
| `app/loop.js` | ~75 | Animation loop, FPS tracking, fire-and-forget `PoseLifter` worker dispatch, avatar update/render dispatch. |
| `app/poseLifter.js` | ~120 | Asynchronous main-thread wrapper for ONNX Web Worker pose lifting with bounded resolve queue. |
| `app/poseLifterWorker.js` | ~50 | Web Worker running `onnxruntime-web` inference on 256x256 normalized crop. |
| `app/debug.js` | 48 | `formatDebugHUD()` |
| `app/privacy.js` | 94 | Person privacy masking (`PERSON_THRESHOLD = 127`) |

### Testing & Standalone

| File | Role |
|---|---|
| `tests/gemini/gemini-client.stress.test.js` | 10 Vitest stress scenarios (reconnect storms, pendingTurn lock, malformed payload gauntlets, tool floods, 10-minute soak) |
| `tests/gemini/fake-server.js` | Mock Gemini WebSocket server for automated testing without API keys |
| `tests/drivers.test.js` | Driver fallback & joint rotation tests |
| `tests/geminiThrottler.test.js` | Throttler lifecycle and resource disposal tests |
| `tests/poseLifter.test.js` | Queue capping and worker communication tests |
| `tests/webglContext.test.js` | WebGL context loss/restoration handling tests |
| `testing/phase1.js` | In-browser 20-test runtime verification suite (T01–T20) |
| `testing/gaze.js` | Mock pipeline test for `EyeGazeSolver` |
| `standalone/` | Isolated lightweight Gemini Live API app and `stress.mjs` test script |

---

## 🤖 AI Director Architecture (Layer 6)

The AI Director uses a **hybrid architecture** that divides labor by latency and capability:

| Component | Responsibility | Latency |
|---|---|---|
| **MediaPipe (Local)** | Frame-by-frame joint coordinates (face, body, hands) | 16ms (60 FPS) |
| **PoseLifter (Local Worker)** | 3D root-relative coordinate lifting from 2D crops | ~20–40ms (non-blocking) |
| **Gemini ER-2 (Cloud)** | Semantic intent (occlusions, gestures, prop interactions) | 200–800ms (1 FPS) |

### The Heartbeat Pattern

Every second, the throttler sends a JPEG frame + text prompt to Gemini:

```javascript
{
  clientContent: {
    turns: [{
      role: "user",
      parts: [
        { inlineData: { data: base64Jpeg, mimeType: "image/jpeg" } },
        { text: "[HEARTBEAT] Observe the user's hands..." }
      ]
    }],
    turnComplete: true
  }
}
```

Gemini responds with **tool calls** that override local tracking when needed:

| Tool | Trigger Condition | Local Action |
|---|---|---|
| `trigger_gesture` | Clear hand sign detected | Applies pre-baked pose (`peace_sign`, `thumbs_up`, etc.) |
| `set_hand_ik_target` | Hand occluded / behind back / holding object | Switches to analytic 2-bone IK targeting body anchor (`hip`, `chest`, `mouth`, `behind_back`, `chin`, `release`) |
| `spawn_prop` | User holding real-world object | Attaches 3D prop mesh to hand bone + activates procedural grip |
| `ack` | No action needed | Silent acknowledgment, MediaPipe continues |

---

## ⚙️ Preset System — Performance Tiers

Three performance tiers are auto-detected at startup:

| Preset | GPU Target | Faces | Pose Model | Hands | Auto-detect Logic |
|---|---|---|---|---|---|
| `low` | Weak GPU / integrated | 1 | `pose_landmarker_lite.task` | 0 | No WebGL2 -> low; Intel HD/GMA/Mesa -> low |
| `medium` | Good mobile GPU | 1 | `pose_landmarker_full.task` | 2 | Adreno/Mali/Apple GPU -> medium |
| `high` | Phone / powerful GPU | 4 | `pose_landmarker_full.task` | 2 | Default when GPU is capable |

*Note:* GPU probe calls `WEBGL_lose_context` immediately after detection to prevent context exhaustion.

---

## 📱 Medium-Tier Android Constraints & Mitigations

| Constraint | Impact | Mitigation |
|---|---|---|
| **GPU** — Adreno/Mali mobile GPUs | WebGL2 performance varies | Use `"medium"` preset; cap resolution at 640×480 |
| **Memory** — 2–4 GB typical | VRM + WASM + WebGL contexts can exceed budget | `VRMUtils.deepDispose` on unload; `loseContext` on HMR; throttle 1 FPS to Gemini |
| **CPU** — Kryo/A78 | MediaPipe dominates CPU budget | OneEuro filtering reduces jitter without extra passes; PoseLifter offloaded to worker |
| **WebGL Contexts** — Limited to ~16 per process | Hot-reload leaks contexts -> `kGpuService` crash | Probe releases context; WebGL context loss listener pauses loop gracefully |
| **Battery** — Sustained inference drains fast | Gemini WebSocket adds network overhead | 1 FPS heartbeat only with frame deduplication |

---

## 🧪 Test Suite Reference

### Automated Tests (CLI)
```bash
npm test
```
Runs 16 unit, integration, and stress tests across 5 test suites.

### In-Browser Diagnostics
```javascript
window.runPhase1Tests();      // Full 20-test suite (T01–T20)
window.testHeadSigns();      // Calibrate head sign directions
window.testFilterQuality();  // Measure filter jitter
window.testHands();          // Hand tracking accuracy
window.testFingerDriver();   // Force fist to test bone rotation
window.testGaze();           // Validate EyeGazeSolver
window.openBoneInspector();  // Live bone rotation tool
```

---

## 🔐 Security & Deployment Notes

- **API Keys:** `VITE_GEMINI_API_KEY` is supported for client-side evaluation. For production web hosting, proxy WebSocket traffic through an authentication backend using ephemeral session tokens.
- **Privacy Masking:** Canvas overlay supports person segmentation masking (`PERSON_THRESHOLD = 127`) while throttler feeds raw camera frames directly to the AI director.
- **CORS:** MediaPipe WASM and ONNX model files must be served with appropriate CORS / COOP / COEP headers when deploying multithreaded WASM.
