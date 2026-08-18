import { tracker, avatar, recorder, startApp, stopApp, running } from "./init.js";
import { startLoop } from "./loop.js";
import { setPrivacyEnabled, isPrivacyEnabled } from "./privacy.js";

export function bindControls(elements) {
  const {
    webcam, overlay, bgCanvas, stage,
    startBtn, mirrorToggle, bodyToggle, bgToggle,
    smoothSlider, vrmInput, calibrateBtn,
    recordBtn, recordStatus, fpsEl,
    trackingStatus, debugEl,
  } = elements;

  startBtn.addEventListener("click", async () => {
    if (running) {
      stopApp(webcam);
      startBtn.textContent = "Start Camera";
      trackingStatus.classList.remove("active");
      trackingStatus.textContent = "● No tracking";
      return;
    }

    startBtn.textContent = "Loading...";
    startBtn.disabled = true;

    try {
      await startApp(webcam, overlay, bgCanvas, stage);

      startBtn.textContent = "Stop Camera";
      startBtn.disabled = false;
      trackingStatus.classList.add("active");
      trackingStatus.textContent = "● Tracking";

      startLoop(webcam, overlay, bgCanvas, mirrorToggle, fpsEl, debugEl, recordStatus, recorder);
    } catch (err) {
      console.error("[App] Start failed:", err);
      startBtn.textContent = "Start Camera";
      startBtn.disabled = false;
    }
  });

  bodyToggle.addEventListener("change", (e) => {
    if (tracker) tracker.enableBody = e.target.checked;
  });

  bgToggle.addEventListener("change", (e) => {
    setPrivacyEnabled(e.target.checked);
    if (tracker) tracker.enablePrivacy = e.target.checked;
    if (!e.target.checked) {
      const ctx = bgCanvas.getContext("2d");
      ctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    }
  });

  smoothSlider.addEventListener("input", (e) => {
    if (avatar) avatar.response = 5 + (e.target.value / 100) * 20;
  });

  vrmInput.addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (f && avatar) await avatar.loadVRM(URL.createObjectURL(f));
  });

  calibrateBtn.addEventListener("click", () => {
    if (tracker) {
      tracker.calibrate();
      calibrateBtn.textContent = "✓";
      setTimeout(() => (calibrateBtn.textContent = "Calibrate Neutral"), 1500);
    }
  });

  recordBtn.addEventListener("click", () => {
    if (!recorder) return;
    if (recorder.recording) {
      recorder.stop();
      recordBtn.textContent = "● Record";
      recordBtn.classList.remove("active");
      recordStatus.textContent = "Saved!";
    } else {
      recorder.start();
      recordBtn.textContent = "■ Stop";
      recordBtn.classList.add("active");
      recordStatus.textContent = "0:00";
    }
  });

  window.addEventListener("resize", () => avatar?.resize());
}