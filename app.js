import { bindControls } from "./app/controls.js";
import { runPhase1Tests, testHeadSigns, testFilterQuality } from "./testing/phase1.js";
import { testHands, testFingerDriver } from "./testing/hands.js";
import { openBoneInspector, closeBoneInspector } from "./testing/boneInspector.js";

const $ = (id) => document.getElementById(id);

bindControls({
  // Stage
  webcam:        $("webcam"),
  overlay:       $("overlay"),
  stage:         $("stage"),

  // HUD buttons
  startBtn:      $("startBtn"),
  flipBtn:       $("flipBtn"),
  mirrorBtn:     $("mirrorBtn"),
  recordBtn:     $("recordBtn"),
  settingsBtn:   $("settingsBtn"),

  // HUD display
  fpsEl:         $("fps"),
  trackingStatus:$("trackingStatus"),
  debugEl:       $("debugInfo"),
  modeLabelEl:   $("modeLabel"),

  // Drawer
  drawer:        $("drawer"),

  // Settings
  bodyToggle:    $("bodyToggle"),
  handsToggle:   $("handsToggle"),
  smoothSlider:  $("smoothSlider"),
  vrmInput:      $("vrmInput"),
  calibrateBtn:  $("calibrateBtn"),
  debugToggle:   $("debugToggle"),
  streamBtn:     $("streamBtn"),
});

window.runPhase1Tests  = runPhase1Tests;
window.testHeadSigns   = testHeadSigns;
window.testFilterQuality = testFilterQuality;

console.log("[App] Tests ready:");
console.log("  window.runPhase1Tests()    — full test suite");
console.log("  window.testHeadSigns()     — calibrate head sign directions");
console.log("  window.testFilterQuality() — measure filter jitter");

window.testHands = testHands;
window.testFingerDriver = testFingerDriver;

console.log("  window.testHands()         — hand tracking accuracy");
console.log("  window.testFingerDriver()  — force fist to test bone rotation");

window.openBoneInspector = openBoneInspector;
window.closeBoneInspector = closeBoneInspector;
console.log("  window.openBoneInspector() — live bone rotation tool");
