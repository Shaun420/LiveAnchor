# LiveAnchor — God-Tier Web VTuber Pipeline

LiveAnchor is a real-time, browser-based avatar tracking system that combines **local high-speed computer vision** (MediaPipe + ONNX 3D pose lifting) with **cloud multimodal AI** (Gemini Robotics ER-2 Streaming API) to drive 3D VRM avatars with zero cloud latency for reflexes and rich semantic understanding for gestures, expressions, and prop interactions.

---

## 🌟 Key Features

- **Local 60 FPS Reflex Tracking:**
  - MediaPipe WASM-based face, body (BlazePose), and hand landmark extraction.
  - Full facial expressions, iris gaze solver (with de-crossing bias & saccade filtering), and anatomically constrained finger curling.
  - Fallback and hybrid support for ONNX-based 3D pose lifting (`MobileHumanPose` / `VideoPose3D`).
- **Cloud AI Director (Gemini Live ER-2 Streaming Preview):**
  - 1 FPS throttled JPEG heartbeat sent over WebSocket with `turnComplete: true`.
  - Semantic tool handling: `trigger_gesture`, `set_hand_ik_target`, `spawn_prop`, `ack`.
  - Hardened client: `pendingTurn` lock preventing queue pile-ups, automatic reconnection on 2-minute limits, payload validation, and CORS-safe frame deduplication.
- **VRM Avatar Engine (Three.js + `@pixiv/three-vrm`):**
  - Full VRM 0.0 & 1.0 support with automatic humanoid skeleton detection in standard GLTF/GLB models.
  - 2-bone analytical IK solver with anatomical joint limits.
  - WebGL context-loss recovery and memory disposal (`VRMUtils.deepDispose`).
- **Developer & Diagnostic Tooling:**
  - In-browser diagnostic HUD / Performance profiler (FPS, inference latency, GPU memory, Gemini status, tool calls).
  - Isolated standalone Gemini Live sandbox (`standalone/`).
  - Automated Vitest test suite and in-browser calibration suite (`window.runPhase1Tests()`).

---

## 🏗️ 7-Layer Architecture Overview

```
Webcam (navigator.mediaDevices.getUserMedia)
  │
  ├── [Local 60 FPS Engine]
  │     ├─ Layer 1: Foundation (MediaPipe WASM + Camera Setup)
  │     ├─ Layer 2: Sync Layer (OneEuro & Kalman smoothing filters)
  │     ├─ Layer 3: Async Layer (Face / Body / Hands landmark extraction)
  │     ├─ Layer 4: Real-Time Layer (Three.js VRM driver, 2-bone IK, PoseLifter worker)
  │     └─ Layer 5: Frontend Layer (Controls, HUD profiler, debug canvas, privacy mask)
  │
  └── [Cloud AI Director Layer (Layer 6)]
        └─ 1 FPS Async Throttler (Frame hash dedup + JPEG)
             └─ WebSocket (wss://generativelanguage.googleapis.com/...)
                  └─ Gemini ER-2 Multimodal Streaming
                       └─ Tool Calls -> Semantic Overrides -> Layer 4 Avatar State
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- Modern Web browser with WebGL2 support (Chrome, Edge, Firefox, Safari)

### Installation

```bash
# Clone the repository
git clone https://github.com/Shaun420/LiveAnchor.git
cd LiveAnchor

# Install dependencies
npm install
```

### Environment Configuration

Create a `.env` or `.env.local` file in the project root if using the Gemini AI Director:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

*(Note: Tracking and avatar rendering work locally without an API key. Gemini features enable semantic hand/prop/gesture overrides).* 

### Development Server

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build for Production

```bash
npm run build
```

---

## 🧪 Testing

### Unit & Stress Tests (Vitest)

Run the test suite covering drivers, throttler, WebGL context handling, and the 10-case Gemini stress harness:

```bash
npm test
```

### In-Browser Diagnostic Suite

Open the browser dev console while running the app:

```js
window.runPhase1Tests();     // Run 20 comprehensive end-to-end checks (T01-T20)
window.testHeadSigns();     // Interactive head pitch/yaw/roll verification
window.testFilterQuality(); // Measure OneEuro frame-to-frame stability
window.testHands();         // Hand & finger tracking verification
window.openBoneInspector(); // Inspect real-time 3D bone rotations
```

---

## 📁 Directory Structure

```
LiveAnchor/
├── app/                    # Application loop, init, controls, HUD, Gemini client & throttler
├── avatar/                 # VRM loaders, bone drivers, IK solver, gaze solver, lifting adapter
├── filters/                # OneEuro, Kalman, and composite smoothing pipelines
├── tracker/                # MediaPipe WASM bundles, face/body/hand landmark extraction
├── lifting/                # ONNX 3D pose lifter (MobileHumanPose / VideoPose3D)
├── models/                 # MediaPipe task models, ONNX models, default VRM assets
├── tests/                  # Vitest specs and Gemini fake-server stress harness
├── standalone/             # Standalone lightweight Gemini Live API demo & stress harness
├── AGENTS.md               # Technical project reference for AI and contributors
└── package.json            # Scripts and dependencies
```

---

## 📱 Platform & Mobile Considerations

- **Resolution:** Defaults to `640x480` for optimal mobile / medium-tier performance.
- **Preset System:** Auto-detects `low`, `medium`, and `high` hardware tiers based on GPU probe with immediate WebGL context release.
- **Power & Memory:** Single worker thread for ONNX inference, 1 FPS frame-deduplicated cloud streaming, and context cleanup hooks on teardown.

---

## 📄 License

MIT License. See `LICENSE` for details.
