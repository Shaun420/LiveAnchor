import { state, startApp, stopApp, flipCamera } from "./init.js";
import { startLoop, setDebugVisible } from "./loop.js";

export function bindControls(elements) {
  const {
    webcam, overlay, stage,
    startBtn, flipBtn, mirrorBtn, recordBtn, settingsBtn,
    bodyToggle, handsToggle, smoothSlider, vrmInput,
    calibrateBtn, debugToggle, streamBtn,
    fpsEl, trackingStatus, debugEl, modeLabelEl, drawer,
  } = elements;

  const syncMirror = () => {
    if (state.avatar) state.avatar.config.mirrored = state.mirrored;
    if (state.recorder) state.recorder.mirror = state.mirrored;
  };

  startBtn.addEventListener("click", async () => {
    if (state.running) {
      await stopApp(webcam);
      startBtn.textContent = "▶";
      startBtn.classList.remove("primary");
      trackingStatus.classList.remove("active");
      return;
    }
    startBtn.textContent = "…";
    startBtn.disabled = true;
    try {
      await startApp({ webcam, overlay, stage });
      syncMirror();
      startBtn.textContent = "⏹";
      startBtn.classList.add("primary");
      startBtn.disabled = false;
      trackingStatus.classList.add("active");
      startLoop({ webcam, overlay, fpsEl, debugEl, modeLabelEl });
    } catch (err) {
      console.error("[App] Start failed:", err);
      startBtn.textContent = "▶";
      startBtn.disabled = false;
    }
  });

  flipBtn.addEventListener("click", async () => {
    if (!state.running) return;
    try { await flipCamera(webcam, overlay); }
    catch (err) { console.error("[App] Flip failed:", err); }
  });

  mirrorBtn.addEventListener("click", () => {
    state.mirrored = !state.mirrored;
    mirrorBtn.classList.toggle("active", state.mirrored);
    syncMirror();
  });
  mirrorBtn.classList.toggle("active", state.mirrored);

  recordBtn.addEventListener("click", () => {
    if (!state.recorder) return;
    if (state.recorder.recording) {
      state.recorder.stop();
      recordBtn.classList.remove("active");
    } else {
      state.recorder.mirror = state.mirrored;
      state.recorder.start();
      recordBtn.classList.add("active");
    }
  });

  settingsBtn.addEventListener("click", () => drawer.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (drawer.classList.contains("open") && !drawer.contains(e.target) && e.target !== settingsBtn) {
      drawer.classList.remove("open");
    }
  });

  bodyToggle.addEventListener("change", (e) => {
    if (state.tracker) state.tracker.enableBody = e.target.checked;
  });
  handsToggle.addEventListener("change", (e) => {
    if (state.tracker) state.tracker.enableHands = e.target.checked;
  });
  smoothSlider.addEventListener("input", (e) => {
    if (state.tracker) state.tracker.setSmoothing(parseInt(e.target.value));
  });

  vrmInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !state.avatar) return;
    const url = URL.createObjectURL(file);
    try {
      await state.avatar.loadVRM(url);
      console.log("[App] Custom VRM loaded");
    } catch (err) {
      console.error("[App] VRM load failed:", err);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  calibrateBtn.addEventListener("click", () => {
    const face = window._lastData?.face;
    if (!state.tracker || !face) {
      calibrateBtn.textContent = "No face!";
      setTimeout(() => (calibrateBtn.textContent = "Calibrate Neutral"), 1500);
      return;
    }
    state.tracker.calibrate(face);
    if (state.avatar) state.avatar.recaptureRest();
    calibrateBtn.textContent = "✓ Done";
    setTimeout(() => (calibrateBtn.textContent = "Calibrate Neutral"), 1500);
  });

  debugToggle.addEventListener("change", (e) => {
    setDebugVisible(e.target.checked);
    debugEl.classList.toggle("visible", e.target.checked);
  });

  streamBtn.addEventListener("click", () => {
    console.log("[App] WebRTC streaming — Phase 5");
  });

  window.addEventListener("resize", () => state.avatar?.resize());
  document.addEventListener("dblclick", (e) => e.preventDefault());

  if ("wakeLock" in navigator) {
    startBtn.addEventListener("click", async () => {
      if (state.running) {
        try { await navigator.wakeLock.request("screen"); }
        catch (e) { console.warn("[App] Wake lock denied:", e.message);
        }
      }
    });
  }
}
