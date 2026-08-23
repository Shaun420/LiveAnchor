import { Tracker } from "../tracker/index.js";
import { AvatarController } from "../avatar/index.js";
import { Recorder } from "../recorder.js";

export const state = {
  tracker: null,
  avatar: null,
  recorder: null,
  stream: null,
  running: false,
  facingMode: "user",
  mirrored: true,
};

export async function startApp(elements) {
  const { webcam, overlay, stage } = elements;

  state.stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
      facingMode: state.facingMode,
    },
    audio: false,
  });

  webcam.srcObject = state.stream;
  await new Promise((r) => (webcam.onloadedmetadata = r));
  await webcam.play();

  const w = webcam.videoWidth;
  const h = webcam.videoHeight;
  console.log("[App] Camera:", w, "x", h, state.facingMode);

  overlay.width = w;
  overlay.height = h;

  // Auto-detect preset, or override with URL param
  const urlPreset = new URLSearchParams(location.search).get("preset");
  state.tracker = new Tracker(urlPreset); // "low", "medium", "high", or null (auto)
  await state.tracker.init();

  state.avatar = new AvatarController(overlay);
  state.avatar.setSourceSize(w, h);
  state.avatar.resize();

  window.avatar = state.avatar;
  window.tracker = state.tracker;

  try {
    await state.avatar.loadVRM("./models/avatar.vrm");
    console.log("[App] VRM loaded");
  } catch (e) {
    console.warn("[App] No default VRM:", e.message);
  }

  state.recorder = new Recorder(stage);
  state.running = true;
}

export async function stopApp(webcam) {
  state.running = false;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  webcam.srcObject = null;
}

export async function flipCamera(webcam, overlay) {
  // Stop current
  state.stream?.getTracks().forEach((t) => t.stop());

  state.facingMode = state.facingMode === "user" ? "environment" : "user";
  state.mirrored = state.facingMode === "user";

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: state.facingMode,
      },
      audio: false,
    });

    webcam.srcObject = state.stream;
    await webcam.play();

    const w = webcam.videoWidth;
    const h = webcam.videoHeight;
    overlay.width = w;
    overlay.height = h;
    state.avatar?.setSourceSize(w, h);
    state.tracker?.filters.reset();

    console.log("[App] Camera flipped to:", state.facingMode);
  } catch (err) {
    // If flip fails (only 1 camera), restore original
    console.warn("[App] Flip failed, restoring:", err.message);
    state.facingMode = state.facingMode === "user" ? "environment" : "user";
    state.mirrored = state.facingMode === "user";

    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode },
      audio: false,
    });
    webcam.srcObject = state.stream;
    await webcam.play();
  }
}