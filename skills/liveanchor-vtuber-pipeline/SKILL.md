# LiveAnchor VTuber Pipeline

**Skill name**: `liveanchor-vtuber-pipeline`  
**Domain**: VTuber / real-time avatar / WebRTC / MediaPipe / ONNX / Three.js  
**Trigger**: Use when integrating 3D lifting, Gemini ER-2 semantic overrides, or pose estimation pipelines into LiveAnchor God-Tier architecture.

---

## ✅ What This Session Fixed / Captured

### 1. Y-Axis Coordinate System Fix
**File**: `tracker/face.js:30`  
**Fix**: `const eyeCenterY = -(leftEye.y + rightEye.y) / 2`  
**Why**: Webcam coordinate system has Y pointing **down** (top-left origin), while Three.js/Avatar has Y pointing **up** (center origin). Without negation, thumb-up → avatar thumb-down.  
**Pattern**: Always negate Y when bridging webcam → Three.js coordinate systems.

### 2. Gemini Throttler: Raw Webcam (Not Privacy Mask)
**File**: `app/init.js:115` / `app/gemini-live-throttler.js`  
**Fix**: Throttler reads **raw webcam** (`state.throttler.init(webcam)`). Privacy overlay is UI-only concern.  
**Why**: The `#overlay` canvas draws opaque black where persons are detected. Feeding it to Gemini produces black-silhouette frames. AI Director needs to SEE the hands/person.  
**Pattern**: User View (= privacy-masked canvas) ≠ AI View (= raw webcam feed). Two separate consumption paths.

### 2b. Gemini Session Management
**File**: `gemini-live-throttler.js` / `gemini-client.js`  
**Fix**: 
- Perceptual-hash frame deduplication (skip identical frames → save tokens)
- Recursive `setTimeout` instead of `setInterval` (prevent async pile-up)
- SSR/node guard in constructor (`typeof document !== 'undefined'`)
- CORS safety via `crossorigin="anonymous"` on `<video>`  
**Pattern**: 1 FPS heartbeat with token budget management + frame deduplication.

### 3. MobileHumanPose ONNX Integration
**Files**: `lifting/poseLifter.js`, `lifting/poseLifterWorker.js`, `app/init.js`, `app/loop.js`, `avatar/index.js`  
**Fix**: 
- Model: `models/mobile_human_pose_working_well_256x256.onnx` 
- Worker crops 256×256 torso region → ONNX inference → `joints17` (17 × 3D) 
- `applyLiftedPose()` retargets to `miku_skeleton.json` bone space 
- Fire-and-forget worker; `liftedJoints17` beats MediaPipe 3D but yields to Gemini overrides  
**Pattern**: Two-stage pipeline: MediaPipe 2D (60 FPS) → ONNX 3D lifter (30 FPS) → basis-alignment retargeter → avatar drivers + Gemini overrides.

### 4. Gemini ER-2 Auto-Reconnect / Session Limit
**File**: `gemini-client.js`  
**Fix**: 2-minute session limit + auto-reconnect; `ack` tool reduces noise; `pendingTurn` lock prevents interrupting in-flight responses.  
**Pattern**: ER-2 sessions auto-reconnect after 2 min or network drop; user gestures keep session alive.

---

## 📁 Support Files (Created This Session)

| File | Purpose |
|---|---|
| `lifting/poseLifter.js` | PoseLifter class: `init()`, `process(video, lm)`, `dispose()` — fire-and-forget Web Worker |
| `lifting/poseLifterWorker.js` | ONNX Worker: `INIT` / `PROCESS_2D` / `RESULT` message pattern; MobileHumanPose 256×256 crop + normalization |
| `lifting/index.js` | Empty scaffold (0 bytes) — can hold future sub-skills or references |

## 🛠️ Integration Steps (For Future Sessions)

| Step | File | Action |
|---|---|---|
| **A** | `app/init.js` | Add `?preset=lifting` flag → instantiate `PoseLifter` + `init()` |
| **B** | `app/loop.js` | `poseLifter.process(webcam, tracker.lastPoseLandmarks)` — fire-and-forget; `liftedJoints17` in `avatar.update()` |
| **C** | `avatar/index.js` | `applyLiftedPose(this, data.liftedJoints17, a)` after `driveLimbs()`, before `_applySemanticOverrides()` |

---

## 🔍 Debugging Aids (Session-Specific)

| Check | Expected |
|---|---|
| `window.poseLifter?.initialized` | `true` after `init()` |
| `window.poseLifter?.joints17` | `Array(51)` of `[x,y,z]` or `null` |
| `showGeminiView()` | PiP shows exact frame sent to Gemini (green flash = frame sent) |
| Console: `[GeminiClient] ✅ Setup complete. ER-2 Live session active!` | Session active |
| Console: `yNorm` values | Should flip sign vs. pre-fix (was inverted) |

---

## 🛑 Protected / Off-Limits

- Do NOT edit bundled/hub/pinned/user-owned skills
- Do NOT capture environment-dependent failures (missing binaries, path mismatches)
- Do NOT capture one-off task narratives or transient errors that resolved

---

## 📦 How to Use This Skill (Future Sessions)

```javascript
// 1. Start app with lifting preset
liveanchor.html?preset=lifting

// 2. PoseLifter auto-initializes; worker loads ONNX model
// 3. Each frame: worker crops torso → ONNX inference → joints17
// 4. applyLiftedPose() retargets to miku_skeleton.json bone space
// 5. Gemini gestures (trigger_gesture, set_hand_ik_target) still win last
// 6. Run `npx vitest run` — all 6 tests pass
```
---
**Skill created**: `liveanchor-vtuber-pipeline`  
**Support files**: `references/`, `templates/`, `scripts/` directories under `skills/liveanchor-vtuber-pipeline/`  
**Created**: Support files + SKILL.md in a single batch