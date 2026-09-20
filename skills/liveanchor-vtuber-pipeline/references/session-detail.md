# LiveAnchor Session-Specific Detail

**Skill**: `liveanchor-vtuber-pipeline`  
**Session**: Current LiveAnchor VTuber pipeline integration  
**Date**: 2026-09-25  

## Y-Axis Coordinate Fix
- **File**: `tracker/face.js:30`
- **Change**: `const eyeCenterY = -(leftEye.y + rightEye.y) / 2`
- **Problem**: Webcam Y-down → Three.js Y-up mismatch caused thumb-up → avatar thumb-down
- **Fix**: Negate Y when bridging webcam → Three.js coordinate systems
- **Verification**: Console `yNorm` values flip sign compared to before; avatar thumb direction corrects

## Gemini Throttler: Raw Webcam (Not Privacy Mask)
- **File**: `app/init.js:115` / `app/gemini-live-throttler.js`
- **Change**: `state.throttler.init(webcam)` — privacy overlay is UI-only
- **Problem**: `#overlay` canvas draws opaque black where persons are detected → Gemini sees black silhouette
- **Fix**: Two consumption paths: User View (= privacy-masked canvas, local screen/recordings) vs AI View (= raw webcam feed, AI Director)
- **Verification**: `showGeminiView()` in console shows actual webcam feed (green flash = frame sent to API); no more black silhouettes

## Frame Deduplication + CORS Safety
- **File**: `app/gemini-live-throttler.js`
- **Changes**: 
  - Perceptual-hash frame dedup (skip identical frames → save Gemini tokens)
  - Recursive `setTimeout` instead of `setInterval` (prevent async pile-up)
  - `typeof document !== 'undefined'` guard (SSR/node compatibility)
  - `crossorigin="anonymous"` on `<video id="webcam">` (prevents taint → silent `toBlob()` failures)
- **Pattern**: 1 FPS heartbeat + token budget management + frame dedup = efficient API usage

## MobileHumanPose ONNX Integration
- **Files**: `lifting/poseLifter.js`, `lifting/poseLifterWorker.js`, `app/init.js`, `app/loop.js`, `avatar/index.js`
- **Model**: `models/mobile_human_pose_working_well_256x256.onnx` (14MB)
- **Pipeline**: MediaPipe 2D (60 FPS) → ONNX MobileHumanPose (30 FPS, 256×256 torso crop) → `joints17` (17 × 3D coords) → `applyLiftedPose()` (basis-alignment retargeter → miku_skeleton.json) → avatar drivers + Gemini overrides
- **Pattern**: Two-stage: MediaPipe 2D (60 FPS) → ONNX 3D lifter (30 FPS) → retargeter → avatar drivers + Gemini overrides win last
- **Verification**: `window.poseLifter?.initialized` = `true`; `window.poseLifter?.joints17` = `Array(51)` or `null`; tests pass (6/6)

## ER-2 Session Management
- **File**: `gemini-client.js`
- **Pattern**: 2-minute session limit + auto-reconnect; `ack` reduces noise; `pendingTurn` lock prevents interrupting in-flight responses; user gestures keep session alive

---

## 📦 Support File Guide

| File Type | Directory | Example |
|---|---|---|
| `references/<topic>.md` | Session-specific detail, error transcripts, provider quirks, API docs, research quotes | `references/gemini-api.md` |
| `templates/<name>.<ext>` | Starter files, boilerplate configs, scaffolding, known-good examples | `templates/poseLifter.worker.template.js` |
| `scripts/<name>.<ext>` | Statically re-runnable actions: verification scripts, fixture generators, deterministic probes | `scripts/verify-pipeline.js` |

**How to use**: The skill's SKILL.md lists support files; future agents know to consult them before starting new tasks in this class.

---

**Skill**: `liveanchor-vtuber-pipeline`  
**Created**: 2026-09-25  
**Support files**: `references/`, `templates/`, `scripts/` directories initialized under `skills/liveanchor-vtuber-pipeline/`