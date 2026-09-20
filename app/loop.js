import { state } from "./init.js";
import { formatDebugHUD } from "./debug.js";

let lastTime = 0;
let frames = 0;
let fpsTime = 0;
let debugVisible = false;
let loopRunning = false;

export function setDebugVisible(v) {
  debugVisible = v;
}

export function startLoop(elements) {
  if (loopRunning) return;
  loopRunning = true;

  const { webcam, fpsEl, debugEl, modeLabelEl } = elements;

  function tick(now) {
    requestAnimationFrame(tick);
    if (!state.running || !state.tracker) {
      lastTime = now;
      return;
    }

    if (!lastTime) lastTime = now;
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    frames++;
    if (now - fpsTime > 500) {
      if (fpsEl) fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsTime))} FPS`;
      frames = 0;
      fpsTime = now;
    }

    if (!state.avatar) return;

    // 1. Track
    const t0 = performance.now();
    const data = state.tracker.process(webcam, now);
    const procMs = performance.now() - t0;
    window._lastData = data;

    // 2. PoseLifter (guarded)
    if (state.poseLifter && typeof state.poseLifter.process === "function" && data?.body && !state.poseLifter.busy) {
      state.poseLifter.process(webcam, state.tracker.lastPoseLandmarks);
    }
    const body = data?.body
      ? { ...data.body, liftedJoints17: state.poseLifter?.joints17 ?? null }
      : data?.body;

    // 3. Update + render
    state.avatar.update(body ? { ...data, body } : data, dt);
    state.avatar.render();

    if (modeLabelEl && data?.body?.mode) modeLabelEl.textContent = data.body.mode;
    if (debugVisible && debugEl) debugEl.textContent = formatDebugHUD(data, state.tracker);

    // 4. Profiler
    state.profiler?.tick?.(now, data, procMs);
  }

  requestAnimationFrame(tick);
}
