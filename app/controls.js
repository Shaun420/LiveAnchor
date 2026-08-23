import { state, startApp, stopApp, flipCamera } from "./init.js";
import { startLoop, setDebugVisible } from "./loop.js";

export function bindControls(elements) {
  const {
    webcam, overlay, stage,
    startBtn, flipBtn, mirrorBtn,
    recordBtn, settingsBtn,
    bodyToggle, handsToggle,
    smoothSlider, vrmInput,
    calibrateBtn, debugToggle,
    streamBtn,
    fpsEl, trackingStatus,
    debugEl, modeLabelEl,
    drawer,
  } = elements;

  // ── Start / Stop ────────────────────────────────────────
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

  // ── Flip Camera ─────────────────────────────────────────
  flipBtn.addEventListener("click", async () => {
    if (!state.running) return;
    try {
      await flipCamera(webcam, overlay);
    } catch (err) {
      console.error("[App] Flip failed:", err);
    }
  });

  // ── Mirror ───────────────────────────────────────────────
  mirrorBtn.addEventListener("click", () => {
    state.mirrored = !state.mirrored;
    mirrorBtn.classList.toggle("active", state.mirrored);
  });
  mirrorBtn.classList.toggle("active", state.mirrored);

  // ── Record ───────────────────────────────────────────────
  recordBtn.addEventListener("click", () => {
    if (!state.recorder) return;
    if (state.recorder.recording) {
      state.recorder.stop();
      recordBtn.classList.remove("active");
    } else {
      state.recorder.start();
      recordBtn.classList.add("active");
    }
  });

  // ── Settings Drawer ──────────────────────────────────────
  settingsBtn.addEventListener("click", () => {
    drawer.classList.toggle("open");
  });

  // Close drawer when tapping outside
  document.addEventListener("click", (e) => {
    if (drawer.classList.contains("open") &&
        !drawer.contains(e.target) &&
        e.target !== settingsBtn) {
      drawer.classList.remove("open");
    }
  });

  // ── Tracking Toggles ─────────────────────────────────────
  bodyToggle.addEventListener("change", (e) => {
    if (state.tracker) state.tracker.enableBody = e.target.checked;
  });

  handsToggle.addEventListener("change", (e) => {
    if (state.tracker) state.tracker.enableHands = e.target.checked;
  });

  // ── Smoothing ────────────────────────────────────────────
  smoothSlider.addEventListener("input", (e) => {
    if (state.tracker) state.tracker.setSmoothing(parseInt(e.target.value));
  });

  // ── VRM Upload ───────────────────────────────────────────
  vrmInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !state.avatar) return;
    try {
      await state.avatar.loadVRM(URL.createObjectURL(file));
      console.log("[App] Custom VRM loaded");
    } catch (err) {
      console.error("[App] VRM load failed:", err);
    }
  });

  // ── Calibrate ────────────────────────────────────────────
  calibrateBtn.addEventListener("click", () => {
    if (state.tracker) {
      state.tracker.calibrate();
      calibrateBtn.textContent = "✓ Done";
      setTimeout(() => (calibrateBtn.textContent = "Calibrate Neutral"), 1500);
    }
  });

  // ── Debug ────────────────────────────────────────────────
  debugToggle.addEventListener("change", (e) => {
    setDebugVisible(e.target.checked);
    debugEl.classList.toggle("visible", e.target.checked);
  });

  // ── Stream ───────────────────────────────────────────────
  streamBtn.addEventListener("click", () => {
    console.log("[App] WebRTC streaming — Phase 5");
    // Implemented in Phase 5
  });

  // ── Resize ───────────────────────────────────────────────
  window.addEventListener("resize", () => state.avatar?.resize());

  // ── Prevent zoom on double-tap ───────────────────────────
  document.addEventListener("dblclick", (e) => e.preventDefault());

  // ── Keep screen awake (if supported) ─────────────────────
  if ("wakeLock" in navigator) {
    startBtn.addEventListener("click", async () => {
      if (state.running) {
        try {
          await navigator.wakeLock.request("screen");
          console.log("[App] Wake lock acquired");
        } catch (e) {
          console.warn("[App] Wake lock denied:", e.message);
        }
      }
    });
  }
}