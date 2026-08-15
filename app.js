import { Tracker } from "./tracker.js";
import { AvatarController } from "./avatar.js";
import { Recorder } from "./recorder.js";

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

let tracker = null;
let avatarController = null;
let recorder = null;
let stream = null;
let running = false;
let lastTime = performance.now();
let frameCount = 0;
let fpsTime = 0;

async function start() {
  if (running) return stop();
  startBtn.textContent = "Loading...";
  startBtn.disabled = true;

  try {
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

    overlayCanvas.width = w;ev
    overlayCanvas.height = h;
    bgCanvas.width = w;
    bgCanvas.height = h;

    tracker = new Tracker();
    await tracker.init();

    avatarController = new AvatarController(overlayCanvas);
    avatarController.setSourceSize(w, h);
    avatarController.resize();
    window.avatar = avatarController;

    try {
      await avatarController.loadVRM("./models/avatar.vrm");
      console.log("[App] Default VRM loaded");
    } catch (e) {
      console.warn("[App] No default VRM.", e);
    }

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

startBtn.addEventListener("click", () => (running ? stop() : start()));

function loop(now) {
  if (!running || !avatarController) return;

  const dt = (now - lastTime) / 1000;
  lastTime = now;

  frameCount++;
  if (now - fpsTime > 500) {
    fpsEl.textContent = `${Math.round(frameCount / ((now - fpsTime) / 1000))} FPS`;
    frameCount = 0;
    fpsTime = now;
  }

  const data = tracker.process(webcam, now);

  const mirrored = mirrorToggle.checked;
  const transform = mirrored
    ? "translate(-50%, -50%) scaleX(-1)"
    : "translate(-50%, -50%)";
  webcam.style.transform = transform;
  overlayCanvas.style.transform = transform;
  bgCanvas.style.transform = transform;

  avatarController.update(data, dt);
  avatarController.render();

  // Debug
  if (data) {
    const f = data.face;
    const b = data.body;
    let dbg = "";

    if (f) {
      dbg +=
        `face: ${f.x.toFixed(0)},${f.y.toFixed(0)}\n` +
        `yaw:${(f.yaw * 57.3).toFixed(1)}° ` +
        `pitch:${(f.pitch * 57.3).toFixed(1)}° ` +
        `roll:${(f.roll * 57.3).toFixed(1)}°\n` +
        `eye:${f.eyeDistance.toFixed(0)}px ` +
        `mouth:${f.mouthOpen.toFixed(2)}\n`;
    }

    if (b) {
      dbg += `---body---\n`;
      dbg += `shoulders: ${b.shoulderWidth.toFixed(0)}px `;
      dbg += `tilt:${((b.shoulderTilt || 0) * 57.3).toFixed(1)}°\n`;

      if (b.torso) {
        dbg +=
          `torso Y:${(b.torso.yaw * 57.3).toFixed(1)}° ` +
          `P:${(b.torso.pitch * 57.3).toFixed(1)}° ` +
          `R:${(b.torso.roll * 57.3).toFixed(1)}°\n`;
      }

      if (b.rotations) {
        dbg +=
          `elbows L:${(b.rotations.leftElbowAngle * 57.3).toFixed(0)}° ` +
          `R:${(b.rotations.rightElbowAngle * 57.3).toFixed(0)}°\n`;
        dbg +=
          `knees L:${(b.rotations.leftKneeAngle * 57.3).toFixed(0)}° ` +
          `R:${(b.rotations.rightKneeAngle * 57.3).toFixed(0)}°\n`;
      }

      dbg += b.synthesized ? "(synthesized)\n" : "(real pose)\n";
      dbg += `vis: sh:${b.hasShoulders} arms:${b.hasLeftArm}/${b.hasRightArm} `;
      dbg += `legs:${b.hasLeftLeg}/${b.hasRightLeg}\n`;
    }

    debugEl.textContent = dbg || "No tracking data";
  }

  if (recorder?.recording) {
    recordStatus.textContent = recorder.getDuration();
  }

  requestAnimationFrame(loop);
}

mirrorToggle.addEventListener("change", () => {});
bodyToggle.addEventListener("change", (e) => {
  if (tracker) tracker.enableBody = e.target.checked;
});
bgToggle.addEventListener("change", (e) => {
  if (tracker) tracker.enableBg = e.target.checked;
});
smoothSlider.addEventListener("input", (e) => {
  if (avatarController) avatarController.response = 5 + (e.target.value / 100) * 20;
});
vrmInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !avatarController) return;
  await avatarController.loadVRM(URL.createObjectURL(file));
});
calibrateBtn.addEventListener("click", () => {
  if (tracker) {
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
window.addEventListener("resize", () => avatarController?.resize());