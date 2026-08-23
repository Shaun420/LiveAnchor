import { state } from "./init.js";
import { formatDebugHUD } from "./debug.js";

let lastTime = performance.now();
let frames = 0;
let fpsTime = 0;
let debugVisible = false;

export function setDebugVisible(v) {
  debugVisible = v;
}

export function startLoop(elements) {
  const { webcam, overlay, fpsEl, debugEl, modeLabelEl } = elements;
  lastTime = performance.now();

  function tick(now) {
    if (!state.running || !state.avatar) return;

    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (++frames, now - fpsTime > 500) {
      fpsEl.textContent = `${Math.round(frames / ((now - fpsTime) / 1000))} FPS`;
      frames = 0;
      fpsTime = now;
    }

    const data = state.tracker.process(webcam, now);
    window._lastData = data;

    const tf = state.mirrored
      ? "translate(-50%,-50%) scaleX(-1)"
      : "translate(-50%,-50%)";
    webcam.style.transform = tf;
    overlay.style.transform = tf;

    state.avatar.update(data, dt);
    state.avatar.render();

    if (data?.body?.mode) {
      modeLabelEl.textContent = data.body.mode;
    }

    if (debugVisible && debugEl) {
      debugEl.textContent = formatDebugHUD(data, state.tracker);
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}