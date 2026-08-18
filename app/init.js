import { Tracker } from "../tracker/index.js";
import { AvatarController } from "../avatar/index.js";
import { Recorder } from "../recorder.js";

export let tracker = null;
export let avatar = null;
export let recorder = null;
export let stream = null;
export let running = false;

export async function startApp(webcam, overlay, bgCanvas, stage) {
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

  // Expose for console debugging
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
}

export function stopApp(webcam) {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  webcam.srcObject = null;
}

export function setRunning(val) {
  running = val;
}