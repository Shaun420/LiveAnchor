import { Tracker } from "../tracker/index.js";
import { AvatarController } from "../avatar/index.js";
import { Recorder } from "../recorder.js";
import { GeminiLiveThrottler } from "./gemini-live-throttler.js";
import { GeminiLiveClient } from "./gemini-client.js";
import { PerformanceProfiler } from "./profiler.js";

export const state = {
  tracker: null,
  avatar: null,
  recorder: null,
  stream: null,
  running: false,
  facingMode: "user",
  mirrored: true,
  
  // God-Tier Architecture Additions
  profiler: null,
  throttler: null,
  geminiClient: null,
};

export async function startApp(elements) {
  const { webcam, overlay, stage } = elements;

  // 1. Camera Setup (Video only is fine for ER-2 Video Heartbeats)
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

  // 2. Core Pipeline (Tracker + Avatar)
  const urlPreset = new URLSearchParams(location.search).get("preset");
  state.tracker = new Tracker(urlPreset); 
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

  // ==========================================
  // 3. GOD-TIER ARCHITECTURE INITIALIZATION
  // ==========================================

  // A. Performance Profiler (Diagnostic HUD)
  state.profiler = new PerformanceProfiler();

  // B. Gemini Live Client (WebSocket ER-2 Streaming)
  const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
  if (API_KEY) {
    state.geminiClient = new GeminiLiveClient(API_KEY);
    state.throttler = new GeminiLiveThrottler();

    // Wire Throttler -> Client (1 FPS Heartbeats)
    state.throttler.onHeartbeat = (base64Jpeg) => {
      state.geminiClient.sendHeartbeat(base64Jpeg);
    };

    // // Wire Client -> Avatar (Semantic Overrides & Emotions)
    // state.geminiClient.onEmotionChange = (emotion, intensity) => {
    //   console.log(`[Avatar] AI Emotion: ${emotion} (${intensity})`);
    //   if (window.avatar && window.avatar.setEmotion) {
    //     window.avatar.setEmotion(emotion, intensity);
    //   }
    // };
    
    state.geminiClient.onPropSpawn = (propName, hand) => {
      console.log(`[Avatar] AI Prop: ${propName} in ${hand} hand`);
      if (window.avatar?.spawnProp) window.avatar.spawnProp(propName, hand);
    };

    state.geminiClient.onGesture = (gesture, hand) => {
      console.log(`[Avatar] AI Gesture Override: ${gesture} on ${hand}`);
      if (window.avatar && window.avatar.triggerGesture) window.avatar.triggerGesture(gesture, hand);
    };

    state.geminiClient.onHandIKTarget = (hand, target) => {
      console.log(`[Avatar] AI IK Override: ${hand} hand locked to ${target}`);
      if (window.avatar && window.avatar.setHandIKTarget) window.avatar.setHandIKTarget(hand, target);
    };

    // Wire Client -> Profiler (HUD Status)
    state.geminiClient.onConnectionChange = (isConnected) => {
      if (state.profiler) state.profiler.setGeminiStatus(isConnected);
    };

    // Start WebSocket and 1 FPS Capture
    state.geminiClient.connect();
    state.throttler.init(webcam); 
    
    console.log("[App] Gemini WebSocket & 1 FPS Throttler initialized");
  } else {
    console.warn("[App] VITE_GEMINI_API_KEY not found. AI Director disabled.");
  }
}

export async function stopApp(webcam) {
  state.running = false;
  
  // Cleanup God-Tier components
  if (state.throttler) {
    state.throttler.dispose();
    state.throttler = null;
  }
  if (state.geminiClient) {
    state.geminiClient.disconnect();
    state.geminiClient = null;
  }

  // Cleanup Camera
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  webcam.srcObject = null;
}

export async function flipCamera(webcam, overlay) {
  // Stop current
  state.stream?.getTracks().forEach((t) => t.stop());
  
  // Dispose old throttler before switching streams to prevent memory leaks
  if (state.throttler) {
    state.throttler.dispose();
    state.throttler = null;
  }

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

    // Re-init throttler with new webcam element if Gemini is active
    if (state.geminiClient) {
      state.throttler = new GeminiLiveThrottler();
      state.throttler.onHeartbeat = (base64Jpeg) => {
        state.geminiClient.sendHeartbeat(base64Jpeg);
      };
      state.throttler.init(webcam);
    }

    console.log("[App] Camera flipped to:", state.facingMode);
  } catch (err) {
    console.warn("[App] Flip failed, restoring:", err.message);
    state.facingMode = state.facingMode === "user" ? "environment" : "user";
    state.mirrored = state.facingMode === "user";

    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode },
      audio: false,
    });
    webcam.srcObject = state.stream;
    await webcam.play();
    
    // Re-init throttler on fallback
    if (state.geminiClient) {
      state.throttler = new GeminiLiveThrottler();
      state.throttler.onHeartbeat = (base64Jpeg) => {
        state.geminiClient.sendHeartbeat(base64Jpeg);
      };
      state.throttler.init(webcam);
    }
  }
}