import { bindControls } from "./app/controls.js";
import { runPhase1Tests, testHeadSigns, testFilterQuality } from "./testing/phase1.js";
import {
  testHands,
  testFingerDriver,
  testFistRamp,
  testWristInvariance,
  testHandSymmetry,
} from "./testing/hands.js";
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

window.runPhase1Tests    = runPhase1Tests;
window.testHeadSigns     = testHeadSigns;
window.testFilterQuality = testFilterQuality;

window.testHands           = testHands;
window.testFingerDriver    = testFingerDriver;
window.testFistRamp        = testFistRamp;
window.testWristInvariance = testWristInvariance;
window.testHandSymmetry    = testHandSymmetry;

window.openBoneInspector  = openBoneInspector;
window.closeBoneInspector = closeBoneInspector;

console.log("[App] Diagnostic tools exposed on window:");
console.log("  window.runPhase1Tests()");
console.log("  window.testHands()");
console.log("  window.testFistRamp()");
console.log("  window.testWristInvariance()");
console.log("  window.testHandSymmetry()");
console.log("  window.testFingerDriver()");
console.log("  window.openBoneInspector()");
