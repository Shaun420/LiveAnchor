import { Tracker } from "./tracker.js";
import { AvatarController } from "./avatar.js";
import { Recorder } from "./recorder.js";

// DOM
const webcam = document.getElementById("webcam");
const overlayCanvas = document.getElementById("overlay");
const bgCanvas = document.getElementById("bgCanvas");
const startBtn = document.getElementById("startBtn");
const mirrorToggle = document.getElementById("mirrorToggle");
const bodyToggle = document.getElementById("bodyToggle");
const bgToggle = document.getElementById("bgToggle");
const smoothSlider = document.getElementById("smoothSlider");
const vrmInput = document.getElementById("vrmInput");
const calibrateBtn = document.getElementById("calibrateBtn");
const recordBtn = document.getElementById("recordBtn");
const recordStatus = document.getElementById("recordStatus");
const fpsEl = document.getElementById("fps");
const trackingStatusEl = document.getElementById("trackingStatus");
const debugEl = document.getElementById("debugInfo");
const stage = document.getElementById("stage");

// State
let tracker = null;
let avatarController = null;  // <-- renamed
let recorder = null;
let stream = null;
let running = false;
let lastTime = performance.now();
let frameCount = 0;
let fpsTime = 0;

// --- Start ---
async function start() {
  if (running) return stop();

  startBtn.textContent = "Loading...";
  startBtn.disabled = true;

  try {
    // 1. Start camera FIRST so we know the real video dimensions
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });

    webcam.srcObject = stream;
    await new Promise((r) => (webcam.onloadedmetadata = r));
    await webcam.play();

    const w = webcam.videoWidth;
    const h = webcam.videoHeight;
    console.log("[App] Camera resolution:", w, "x", h);

    // 2. Size the overlay canvas to match the video
    overlayCanvas.width = w;
    overlayCanvas.height = h;
    bgCanvas.width = w;
    bgCanvas.height = h;

    // 3. Initialize tracker
    tracker = new Tracker();
    await tracker.init();

    // 4. Create the avatar controller AFTER canvas is sized
    avatarController = new AvatarController(overlayCanvas);
    avatarController.setSourceSize(w, h);
    avatarController.resize();

    // Expose for console debugging
    window.avatar = avatarController;

    // 5. Load VRM
    try {
      await avatarController.loadVRM("./models/avatar.vrm");
      console.log("[App] Default VRM loaded");
    } catch (e) {
      console.warn("[App] No default VRM. Upload one via the panel.", e);
    }

    // 6. Recorder
    recorder = new Recorder(stage);

    running = true;
    startBtn.textContent = "Stop Camera";
    startBtn.disabled = false;
    trackingStatusEl.classList.add("active");
    trackingStatusEl.textContent = "● Tracking";

    requestAnimationFrame(loop);
  } catch (err) {
    console.error("[App] Start failed:", err);
    startBtn.textContent = "Start Camera";
    startBtn.disabled = false;
  }
}

function stop() {
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  webcam.srcObject = null;
  startBtn.textContent = "Start Camera";
  trackingStatusEl.classList.remove("active");
  trackingStatusEl.textContent = "● No tracking";
}

startBtn.addEventListener("click", () => {
  if (running) stop();
  else start();
});

// --- Main Loop ---
function loop(now) {
  if (!running || !avatarController) return;

  const dt = (now - lastTime) / 1000;
  lastTime = now;

  // FPS
  frameCount++;
  if (now - fpsTime > 500) {
    fpsEl.textContent = `${Math.round(frameCount / ((now - fpsTime) / 1000))} FPS`;
    frameCount = 0;
    fpsTime = now;
  }

  // --- Tracking ---
  const data = tracker.process(webcam, now);

  // --- Mirror toggle (visual only — do NOT flip tracking data) ---
  const mirrored = mirrorToggle.checked;
  const transform = mirrored
    ? "translate(-50%, -50%) scaleX(-1)"
    : "translate(-50%, -50%)";
  webcam.style.transform = transform;
  overlayCanvas.style.transform = transform;
  // bgCanvas is hidden behind webcam, mirror it too if needed
  bgCanvas.style.transform = transform;

  // --- Update avatar ---
  // The avatar handles the X/Y mirroring internally
  // based on the CSS mirror state we pass in (or just always mirror)
  avatarController.update(data, dt);
  avatarController.render();

  // --- Debug ---
  if (data && data.face) {
    const f = data.face;
    debugEl.textContent =
      `pos: ${f.x.toFixed(0)}, ${f.y.toFixed(0)}\n` +
      `norm: ${(f.xNorm || 0).toFixed(2)}, ${(f.yNorm || 0).toFixed(2)}\n` +
      `yaw: ${(f.yaw * 57.3).toFixed(1)}°\n` +
      `pitch: ${(f.pitch * 57.3).toFixed(1)}°\n` +
      `roll: ${(f.roll * 57.3).toFixed(1)}°\n` +
      `eye: ${f.eyeDistance.toFixed(0)}px\n` +
      `mouth: ${f.mouthOpen.toFixed(2)}`;
  }

  // --- Recording status ---
  if (recorder && recorder.recording) {
    recordStatus.textContent = recorder.getDuration();
  }

  requestAnimationFrame(loop);
}

// --- Controls ---
mirrorToggle.addEventListener("change", () => {});

bodyToggle.addEventListener("change", (e) => {
  if (tracker) tracker.enableBody = e.target.checked;
});

bgToggle.addEventListener("change", (e) => {
  if (tracker) tracker.enableBg = e.target.checked;
});

smoothSlider.addEventListener("input", (e) => {
  if (avatarController) {
    avatarController.response = 5 + (e.target.value / 100) * 20;
  }
});

vrmInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !avatarController) return;
  const url = URL.createObjectURL(file);
  await avatarController.loadVRM(url);
  console.log("[App] Custom VRM loaded");
});

calibrateBtn.addEventListener("click", () => {
  if (tracker && tracker.calibrate) {
    tracker.calibrate();
    calibrateBtn.textContent = "✓ Calibrated";
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

window.addEventListener("resize", () => {
  if (avatarController) avatarController.resize();
});