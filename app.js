import { bindControls } from "./app/controls.js";

const $ = (id) => document.getElementById(id);

bindControls({
  webcam: $("webcam"),
  overlay: $("overlay"),
  bgCanvas: $("bgCanvas"),
  stage: $("stage"),
  startBtn: $("startBtn"),
  mirrorToggle: $("mirrorToggle"),
  bodyToggle: $("bodyToggle"),
  bgToggle: $("bgToggle"),
  smoothSlider: $("smoothSlider"),
  vrmInput: $("vrmInput"),
  calibrateBtn: $("calibrateBtn"),
  recordBtn: $("recordBtn"),
  recordStatus: $("recordStatus"),
  fpsEl: $("fps"),
  trackingStatus: $("trackingStatus"),
  debugEl: $("debugInfo"),
});