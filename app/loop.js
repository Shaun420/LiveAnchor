import { tracker, avatar, running } from "./init.js";
import { drawPrivacyMask, isPrivacyEnabled } from "./privacy.js";
import { formatDebugHUD } from "./debug.js";

let lastTime = performance.now();
let frames = 0;
let fpsTime = 0;

export function startLoop(webcam, overlay, bgCanvas, mirrorToggle, fpsEl, debugEl, recordStatusEl, recorder) {
  lastTime = performance.now();
  frames = 0;
  fpsTime = lastTime;
  
  function tick(now) {
    if (!running || !avatar) return;

    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // FPS
    if (++frames, now - fpsTime > 500) {
      fpsEl.textContent = `${Math.round(frames / ((now - fpsTime) / 1000))} FPS`;
      frames = 0;
      fpsTime = now;
    }

    // Track
    const data = tracker.process(webcam, now);
    window._lastData = data;

    // Mirror
    const tf = mirrorToggle.checked
      ? "translate(-50%,-50%) scaleX(-1)"
      : "translate(-50%,-50%)";
    webcam.style.transform = overlay.style.transform = bgCanvas.style.transform = tf;

    // Privacy mask
    drawPrivacyMask(bgCanvas, data?.face, data?.body);

    // Avatar
    avatar.update(data, dt);
    avatar.render();

    // Debug
    debugEl.textContent = formatDebugHUD(data, isPrivacyEnabled());

    // Recording
    if (recorder?.recording) recordStatusEl.textContent = recorder.getDuration();

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}