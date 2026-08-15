import { Tracker } from "./tracker/index.js";
import { AvatarController } from "./avatar/index.js";
import { Recorder } from "./recorder.js";

const $ = (id) => document.getElementById(id);
const webcam = $("webcam"), overlay = $("overlay"), bgCanvas = $("bgCanvas");
const startBtn = $("startBtn"), mirrorToggle = $("mirrorToggle");
const bodyToggle = $("bodyToggle"), bgToggle = $("bgToggle");
const smoothSlider = $("smoothSlider"), vrmInput = $("vrmInput");
const calibrateBtn = $("calibrateBtn"), recordBtn = $("recordBtn");
const recordStatus = $("recordStatus"), fpsEl = $("fps");
const trackingStatus = $("trackingStatus"), debugEl = $("debugInfo");
const stage = $("stage");

let tracker, avatar, recorder, stream;
let running = false, lastTime = performance.now(), frames = 0, fpsTime = 0;

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

    const w = webcam.videoWidth, h = webcam.videoHeight;
    console.log("[App] Camera:", w, "x", h);
    overlay.width = bgCanvas.width = w;
    overlay.height = bgCanvas.height = h;

    tracker = new Tracker();
    await tracker.init();

    avatar = new AvatarController(overlay);
    avatar.setSourceSize(w, h);
    avatar.resize();
    window.avatar = avatar;
    window.tracker = tracker;

    try {
      await avatar.loadVRM("./models/avatar.vrm");
      console.log("[App] VRM loaded");
    } catch (e) {
      console.warn("[App] No default VRM", e);
    }

    recorder = new Recorder(stage);
    running = true;
    startBtn.textContent = "Stop Camera";
    startBtn.disabled = false;
    trackingStatus.classList.add("active");
    trackingStatus.textContent = "● Tracking";
    requestAnimationFrame(loop);
  } catch (err) {
    console.error("[App] Start failed:", err);
    startBtn.textContent = "Start Camera";
    startBtn.disabled = false;
  }
}

function stop() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  webcam.srcObject = null;
  startBtn.textContent = "Start Camera";
  trackingStatus.classList.remove("active");
  trackingStatus.textContent = "● No tracking";
}

function loop(now) {
  if (!running || !avatar) return;
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (++frames, now - fpsTime > 500) {
    fpsEl.textContent = `${Math.round(frames / ((now - fpsTime) / 1000))} FPS`;
    frames = 0;
    fpsTime = now;
  }

  const data = tracker.process(webcam, now);
  window._lastData = data;

  const tf = mirrorToggle.checked
    ? "translate(-50%,-50%) scaleX(-1)"
    : "translate(-50%,-50%)";
  webcam.style.transform = overlay.style.transform = bgCanvas.style.transform = tf;

  avatar.update(data, dt);
  avatar.render();

  // Debug HUD
  if (data) {
    const f = data.face, b = data.body;
    let d = "";
    if (f) {
      d += `face:${f.x.toFixed(0)},${f.y.toFixed(0)} `;
      d += `yaw:${(f.yaw*57.3).toFixed(1)}° pitch:${(f.pitch*57.3).toFixed(1)}° roll:${(f.roll*57.3).toFixed(1)}°\n`;
      d += `eye:${f.eyeDistance.toFixed(0)}px mouth:${f.mouthOpen.toFixed(2)}\n`;
    }
    if (b) {
      d += `--- body ${b.worldSpace?"3D":"2D"} ${b.synthesized?"syn":"real"} ---\n`;
      d += `sh:${b.shoulderWidth.toFixed(0)}px tilt:${((b.shoulderTilt||0)*57.3).toFixed(1)}°\n`;
      if (b.torso) d += `torso Y:${(b.torso.yaw*57.3).toFixed(1)}° P:${(b.torso.pitch*57.3).toFixed(1)}° R:${(b.torso.roll*57.3).toFixed(1)}°\n`;
      if (b.rotations) d += `elbows L:${(b.rotations.leftElbowAngle*57.3).toFixed(0)}° R:${(b.rotations.rightElbowAngle*57.3).toFixed(0)}°\n`;
      d += `vis: sh:${b.hasShoulders} arms:${b.hasLeftArm}/${b.hasRightArm} legs:${b.hasLeftLeg}/${b.hasRightLeg}\n`;
    }
    debugEl.textContent = d || "No data";
  }

  if (recorder?.recording) recordStatus.textContent = recorder.getDuration();
  requestAnimationFrame(loop);
}

// Controls
startBtn.addEventListener("click", () => (running ? stop() : start()));
bodyToggle.addEventListener("change", (e) => { if (tracker) tracker.enableBody = e.target.checked; });
bgToggle.addEventListener("change", (e) => { if (tracker) tracker.enableBg = e.target.checked; });
smoothSlider.addEventListener("input", (e) => { if (avatar) avatar.response = 5 + (e.target.value / 100) * 20; });
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