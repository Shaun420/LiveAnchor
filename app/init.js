import { Tracker } from "../tracker/index.js";
import { AvatarController } from "../avatar/index.js";
import { Recorder } from "../recorder.js";
import { PerformanceProfiler } from "./profiler.js";

const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

export const state = {
  tracker: null,
  avatar: null,
  recorder: null,
  stream: null,
  running: false,
  facingMode: "user",
  mirrored: true,
  profiler: null,
  throttler: null,
  geminiClient: null,
  poseLifter: null,
};

async function openStream(facingMode) {
  return navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode }, audio: false });
}

async function initGemini(webcam) {
  const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
  if (!API_KEY) {
    console.warn("[App] VITE_GEMINI_API_KEY not set — AI Director disabled (local-only mode).");
    return;
  }

  try {
    const [{ GeminiLiveClient }, { GeminiLiveThrottler }] = await Promise.all([
      import("./gemini-client.js"),
      import("./gemini-live-throttler.js"),
    ]);

    state.geminiClient = new GeminiLiveClient(API_KEY);
    state.throttler = new GeminiLiveThrottler();
    state.throttler.onHeartbeat = (jpeg) => state.geminiClient.sendHeartbeat(jpeg);

    state.geminiClient.onGesture = (gesture, hand) => {
      window.avatar?.triggerGesture?.(gesture, hand);
      state.profiler?.setLastToolCall?.(`gesture:${gesture}(${hand})`);
    };
    state.geminiClient.onHandIKTarget = (hand, target) => {
      window.avatar?.setHandIKTarget?.(hand, target);
      state.profiler?.setLastToolCall?.(`ik:${hand}→${target}`);
    };
    state.geminiClient.onPropSpawn = (propName, hand) => {
      window.avatar?.spawnProp?.(propName, hand);
      state.profiler?.setLastToolCall?.(`prop:${propName}(${hand})`);
    };
    state.geminiClient.onConnectionChange = (ok) => state.profiler?.setGeminiStatus?.(ok);

    state.geminiClient.connect();
    state.throttler.init(webcam);
    console.log("[App] AI Director initialized (1 FPS heartbeat)");
  } catch (err) {
    console.warn("[App] AI Director init failed:", err.message);
    state.geminiClient = null;
    state.throttler = null;
  }
}

async function restartThrottler(webcam) {
  if (!state.geminiClient) return;
  state.throttler?.dispose();
  const { GeminiLiveThrottler } = await import("./gemini-live-throttler.js");
  state.throttler = new GeminiLiveThrottler();
  state.throttler.onHeartbeat = (jpeg) => state.geminiClient.sendHeartbeat(jpeg);
  state.throttler.init(webcam);
}

export async function startApp(elements) {
  const { webcam, overlay, stage } = elements;

  try {
    state.stream = await openStream(state.facingMode);
  } catch (err) {
    const reason = err.name === "NotAllowedError" ? "permission denied" : err.message;
    throw new Error(`Camera access failed: ${reason}`);
  }
  webcam.srcObject = state.stream;
  await new Promise((r) => (webcam.onloadedmetadata = r));
  await webcam.play();

  const w = webcam.videoWidth;
  const h = webcam.videoHeight;
  overlay.width = w;
  overlay.height = h;

  const preset = new URLSearchParams(location.search).get("preset");
  state.tracker = new Tracker(preset);
  await state.tracker.init();

  const avatarCanvas = document.getElementById("avatarCanvas");
  avatarCanvas.width = w;
  avatarCanvas.height = h;
  state.avatar = new AvatarController(avatarCanvas);
  state.avatar.setSourceSize(w, h);
  state.avatar.resize();
  state.avatar.config.mirrored = state.mirrored;

  window.avatar = state.avatar;
  window.tracker = state.tracker;

  try {
    await state.avatar.loadVRM("./models/avatar.vrm");
    console.log("[App] VRM loaded");
  } catch (e) {
    console.warn("[App] No default VRM:", e.message);
  }

  state.recorder = new Recorder(stage);
  state.profiler = new PerformanceProfiler();
  state.running = true;

  // ONNX lifter is FROZEN until Phase 2 — opt-in via ?lifter=1 only.
  if (new URLSearchParams(location.search).get("lifter") === "1") {
    try {
      const { PoseLifter } = await import("./poseLifter.js");
      state.poseLifter = new PoseLifter();
      state.poseLifter.init();
    } catch (err) {
      console.warn("[App] PoseLifter unavailable:", err.message);
    }
  }

  initGemini(webcam);
}

export async function stopApp(webcam) {
  state.running = false;

  state.throttler?.dispose();
  state.geminiClient?.disconnect();
  state.throttler = null;
  state.geminiClient = null;

  state.poseLifter?.dispose?.();
  state.poseLifter = null;

  state.recorder?.stop?.();
  state.profiler?.dispose?.();
  state.profiler = null;

  state.avatar?.dispose?.();
  state.tracker?.dispose?.();
  state.avatar = null;

  // Firefox/Chromium refuse a new WebGL context on a canvas after forceContextLoss().
  // Swap in a fresh clone node so every start gets a clean WebGL context.
  const oldCanvas = document.getElementById("avatarCanvas");
  if (oldCanvas) {
    const fresh = oldCanvas.cloneNode(false);
    oldCanvas.replaceWith(fresh);
  }

  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  if (webcam) webcam.srcObject = null;
}

export async function flipCamera(webcam, overlay) {
  const target = state.facingMode === "user" ? "environment" : "user";

  let stream;
  try {
    stream = await openStream(target);
  } catch (err) {
    console.warn("[App] Flip failed — keeping current camera:", err.message);
    return;
  }

  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = stream;
  state.facingMode = target;
  state.mirrored = target === "user";

  webcam.srcObject = stream;
  await webcam.play();

  const w = webcam.videoWidth;
  const h = webcam.videoHeight;
  overlay.width = w;
  overlay.height = h;
  const avatarCanvas = document.getElementById("avatarCanvas");
  if (avatarCanvas) {
    avatarCanvas.width = w;
    avatarCanvas.height = h;
  }
  state.avatar?.setSourceSize(w, h);
  if (state.avatar) state.avatar.config.mirrored = state.mirrored;
  state.tracker?.filters?.reset?.();

  await restartThrottler(webcam);
  console.log("[App] Camera flipped to:", target);
}
