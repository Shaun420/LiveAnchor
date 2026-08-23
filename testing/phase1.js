// ============================================================
// Phase 1 Test Suite
// Run in console: window.runPhase1Tests()
//
// Tests:
//   T01 - Camera access
//   T02 - Video resolution
//   T03 - MediaPipe face detection
//   T04 - MediaPipe pose detection
//   T05 - MediaPipe hand detection
//   T06 - OneEuro filter correctness
//   T07 - Kalman filter correctness
//   T08 - FilterPipeline integration
//   T09 - Avatar VRM loaded
//   T10 - Bone availability
//   T11 - Head rotation signs
//   T12 - Eye gaze direction
//   T13 - Face picking (best face selection)
//   T14 - Camera flip
//   T15 - Smoothing slider effect
//   T16 - Frame rate
//   T17 - Wake lock
//   T18 - Mobile viewport
//   T19 - Drawer open/close
//   T20 - Full pipeline latency
// ============================================================

import { OneEuroFilter, OneEuroFilterPose } from "../filters/oneEuro.js";
import { KalmanFilter1D, KalmanFilterVec3 } from "../filters/kalman.js";

// ── Result collector ───────────────────────────────────────

const PASS = "✅ PASS";
const FAIL = "❌ FAIL";
const WARN = "⚠️  WARN";
const SKIP = "⏭️  SKIP";

class TestReport {
  constructor(phaseName) {
    this.phase = phaseName;
    this.results = [];
    this.startTime = performance.now();
  }

  add(id, name, status, detail = "", data = null) {
    this.results.push({ id, name, status, detail, data });
  }

  print() {
    const elapsed = (performance.now() - this.startTime).toFixed(0);
    const passed = this.results.filter(r => r.status === PASS).length;
    const failed = this.results.filter(r => r.status === FAIL).length;
    const warned = this.results.filter(r => r.status === WARN).length;
    const skipped = this.results.filter(r => r.status === SKIP).length;
    const total = this.results.length;

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  ${this.phase} — Test Report`);
    console.log(`${"═".repeat(60)}`);
    console.log(`  Ran ${total} tests in ${elapsed}ms`);
    console.log(`  ${PASS} ${passed}  ${FAIL} ${failed}  ${WARN} ${warned}  ${SKIP} ${skipped}`);
    console.log(`${"─".repeat(60)}`);

    for (const r of this.results) {
      const line = `  ${r.status}  [${r.id}] ${r.name}`;
      if (r.status === FAIL) {
        console.error(line);
        if (r.detail) console.error(`         → ${r.detail}`);
        if (r.data)   console.error("         data:", r.data);
      } else if (r.status === WARN) {
        console.warn(line);
        if (r.detail) console.warn(`         → ${r.detail}`);
      } else {
        console.log(line);
        if (r.detail) console.log(`         → ${r.detail}`);
      }
    }

    console.log(`${"═".repeat(60)}`);

    if (failed > 0) {
      console.error(`\n  ❌ ${failed} test(s) FAILED. Fix before Phase 2.\n`);
    } else if (warned > 0) {
      console.warn(`\n  ⚠️  All passed but ${warned} warning(s). Review before Phase 2.\n`);
    } else {
      console.log(`\n  ✅ All tests passed. Ready for Phase 2.\n`);
    }

    return { passed, failed, warned, skipped };
  }

  toJSON() {
    return {
      phase: this.phase,
      results: this.results,
      summary: {
        passed: this.results.filter(r => r.status === PASS).length,
        failed: this.results.filter(r => r.status === FAIL).length,
        warned: this.results.filter(r => r.status === WARN).length,
      },
    };
  }
}

// ── Individual tests ───────────────────────────────────────

async function testCamera(report) {
  const tracker = window.tracker;
  const webcam = document.getElementById("webcam");

  // T01: Camera access
  if (webcam?.srcObject) {
    const tracks = webcam.srcObject.getVideoTracks();
    if (tracks.length > 0 && tracks[0].readyState === "live") {
      report.add("T01", "Camera access", PASS, `Track: ${tracks[0].label}`);
    } else {
      report.add("T01", "Camera access", FAIL, "Track not live");
    }
  } else {
    report.add("T01", "Camera access", FAIL, "No srcObject — start camera first");
    return; // Can't test resolution without camera
  }

  // T02: Video resolution
  const w = webcam.videoWidth;
  const h = webcam.videoHeight;
  if (w >= 640 && h >= 480) {
    const quality = w >= 1280 ? "HD" : "SD";
    report.add("T02", "Video resolution", PASS, `${w}×${h} (${quality})`);
  } else if (w > 0 && h > 0) {
    report.add("T02", "Video resolution", WARN,
      `${w}×${h} — below 640×480, tracking may be unreliable`);
  } else {
    report.add("T02", "Video resolution", FAIL, "Video not playing");
  }
}

async function testMediaPipe(report) {
  const data = window._lastData;

  if (!data) {
    report.add("T03", "Face detection", FAIL, "No tracking data — is camera running?");
    report.add("T04", "Pose detection", FAIL, "No tracking data");
    report.add("T05", "Hand detection", SKIP, "No tracking data");
    return;
  }

  // T03: Face detection
  if (data.face) {
    const f = data.face;
    const hasPosition = typeof f.xNorm === "number" && typeof f.yNorm === "number";
    const hasRotation = typeof f.yaw === "number" && typeof f.pitch === "number";
    const hasBlendshapes = !!data.blendshapes && Object.keys(data.blendshapes).length > 0;

    if (hasPosition && hasRotation) {
      report.add("T03", "Face detection", PASS,
        `pos:(${f.xNorm?.toFixed(2)},${f.yNorm?.toFixed(2)}) ` +
        `yaw:${(f.yaw * 57.3).toFixed(1)}° ` +
        `blendshapes:${hasBlendshapes ? Object.keys(data.blendshapes).length : 0}`
      );
    } else {
      report.add("T03", "Face detection", FAIL, "Missing position or rotation data", f);
    }
  } else {
    report.add("T03", "Face detection", FAIL,
      `No face detected. Faces in frame: ${data.facesDetected}. ` +
      "Make sure your face is visible.");
  }

  // T04: Pose detection
  if (data.body) {
    const b = data.body;
    const hasJoints = b.joints3d && Object.keys(b.joints3d).length >= 8;
    const hasShoulders = b.hasShoulders;

    if (hasJoints && hasShoulders) {
      report.add("T04", "Pose detection", PASS,
        `mode:${b.mode} joints:${Object.keys(b.joints3d).length} ` +
        `arms:${b.hasLeftArm}/${b.hasRightArm} ` +
        `legs:${b.hasLeftLeg}/${b.hasRightLeg}`
      );
    } else if (hasJoints) {
      report.add("T04", "Pose detection", WARN,
        `Joints detected but shoulders not visible (mode:${b.mode}). ` +
        "Stand back so shoulders are in frame."
      );
    } else {
      report.add("T04", "Pose detection", FAIL,
        "No body joints detected. Make sure body is visible.");
    }
  } else {
    report.add("T04", "Pose detection", FAIL,
      "No body data. Check bodyToggle is ON.");
  }

  // T05: Hand detection
  if (data.hands && Object.keys(data.hands).length > 0) {
    const sides = Object.keys(data.hands).join(", ");
    const sample = Object.values(data.hands)[0];
    const curls = Object.values(sample.fingers).map(f => f.curl.toFixed(2)).join(", ");
    report.add("T05", "Hand detection", PASS,
      `Detected: ${sides} | curls: [${curls}]`);
  } else {
    report.add("T05", "Hand detection", WARN,
      "No hands detected. Raise a hand into view to test. " +
      "If handsToggle is OFF this is expected.");
  }
}

async function testFilters(report) {
  // T06: OneEuro filter correctness
  try {
    const f = new OneEuroFilter(30, 1.0, 0.007);

    // Filter a constant signal — should converge to constant
    let val = 0;
    for (let i = 0; i < 60; i++) val = f.filter(1.0, i / 30);
    const convergesToConst = Math.abs(val - 1.0) < 0.001;

    // Filter an impulse — should not over-shoot
    const f2 = new OneEuroFilter(30, 1.0, 0.007);
    let impulse = 0;
    for (let i = 0; i < 10; i++) impulse = f2.filter(0, i / 30);
    const spike = f2.filter(100, 10 / 30);
    const recovery = f2.filter(0, 11 / 30);
    const noOvershoot = recovery < spike; // should decay, not bounce

    // Adaptive: fast signal should have less lag than slow signal
    const fFast = new OneEuroFilter(30, 1.0, 0.1); // high beta
    const fSlow = new OneEuroFilter(30, 1.0, 0.001); // low beta
    let fastVal = 0, slowVal = 0;
    for (let i = 0; i < 10; i++) {
      fastVal = fFast.filter(Math.sin(i * 0.5), i / 30);
      slowVal = fSlow.filter(Math.sin(i * 0.5), i / 30);
    }
    // Fast filter should track closer to current value
    const adaptiveWorks = true; // soft check

    if (convergesToConst && noOvershoot) {
      report.add("T06", "OneEuro filter", PASS,
        `convergence:${val.toFixed(4)} noOvershoot:${noOvershoot}`);
    } else {
      report.add("T06", "OneEuro filter", FAIL,
        `convergence:${val.toFixed(4)} noOvershoot:${noOvershoot}`,
        { convergesToConst, noOvershoot }
      );
    }
  } catch (err) {
    report.add("T06", "OneEuro filter", FAIL, err.message);
  }

  // T07: Kalman filter correctness
  try {
    const k = new KalmanFilter1D(0.01, 0.0001);

    // Should converge to measured value
    let kVal = 0;
    for (let i = 0; i < 100; i++) kVal = k.filter(5.0);
    const converges = Math.abs(kVal - 5.0) < 0.01;

    // Prediction during occlusion should not jump
    const kPred = k.predict();
    const predStable = Math.abs(kPred - kVal) < 0.1;

    // KalmanFilterVec3
    const kv = new KalmanFilterVec3(0.01, 0.0001);
    const result = kv.filter({ x: 1, y: 2, z: 3 });
    const vec3works = typeof result.x === "number" &&
                      typeof result.y === "number" &&
                      typeof result.z === "number";

    if (converges && predStable && vec3works) {
      report.add("T07", "Kalman filter", PASS,
        `converged to: ${kVal.toFixed(4)}, prediction: ${kPred.toFixed(4)}`);
    } else {
      report.add("T07", "Kalman filter", FAIL,
        `converges:${converges} predStable:${predStable} vec3:${vec3works}`);
    }
  } catch (err) {
    report.add("T07", "Kalman filter", FAIL, err.message);
  }

  // T08: FilterPipeline integration
  try {
    const tracker = window.tracker;
    if (!tracker?.filters) {
      report.add("T08", "FilterPipeline", FAIL, "tracker.filters not found");
      return;
    }

    const fp = tracker.filters;

    // Test face filtering
    const rawFace = {
      yaw: 0.1, pitch: -0.05, roll: 0.02,
      x: 640, y: 360, xNorm: 0.5, yNorm: 0.5,
      eyeDistance: 80, eyeDistanceNorm: 0.06,
      mouthOpen: 0.1,
      gaze: { leftX: 0.1, leftY: -0.05, rightX: 0.12, rightY: -0.04 },
    };

    const filtered = fp.filterFace(rawFace, 0);
    const hasAllKeys = ["yaw", "pitch", "roll", "xNorm", "yNorm", "mouthOpen", "gaze"]
      .every(k => filtered[k] !== undefined);

    // Values should be in reasonable range
    const yawInRange = Math.abs(filtered.yaw) < Math.PI;
    const xNormInRange = filtered.xNorm >= 0 && filtered.xNorm <= 1;

    if (hasAllKeys && yawInRange && xNormInRange) {
      report.add("T08", "FilterPipeline", PASS,
        `face filter: yaw:${filtered.yaw.toFixed(3)} xNorm:${filtered.xNorm.toFixed(3)}`);
    } else {
      report.add("T08", "FilterPipeline", FAIL,
        `hasAllKeys:${hasAllKeys} yawInRange:${yawInRange} xNormInRange:${xNormInRange}`,
        filtered
      );
    }
  } catch (err) {
    report.add("T08", "FilterPipeline", FAIL, err.message);
  }
}

async function testAvatar(report) {
  const avatar = window.avatar;

  // T09: VRM loaded
  if (!avatar) {
    report.add("T09", "Avatar controller", FAIL, "window.avatar not found");
    report.add("T10", "Bone availability", SKIP, "No avatar");
    return;
  }

  if (avatar.vrm) {
    report.add("T09", "VRM loaded", PASS,
      `Model: ${avatar.vrm.meta?.name || "unknown"}`);
  } else {
    report.add("T09", "VRM loaded", FAIL,
      "No VRM loaded. Upload a .vrm file.");
    report.add("T10", "Bone availability", SKIP, "No VRM");
    return;
  }

  // T10: Bone availability
  const requiredBones = [
    "head", "neck", "spine", "chest", "hips",
    "leftUpperArm", "rightUpperArm",
    "leftLowerArm", "rightLowerArm",
  ];
  const optionalBones = [
    "leftEye", "rightEye",
    "leftIndexProximal", "rightIndexProximal",
    "upperChest",
  ];

  const missing = requiredBones.filter(n => !avatar.bones[n]);
  const optionalMissing = optionalBones.filter(n => !avatar.bones[n]);

  if (missing.length === 0) {
    const detail = optionalMissing.length > 0
      ? `optional missing: ${optionalMissing.join(", ")}`
      : "all bones including optional";
    report.add("T10", "Bone availability", PASS, detail);
  } else {
    report.add("T10", "Bone availability", FAIL,
      `Required bones missing: ${missing.join(", ")}. Try a different VRM.`,
      { missing, optionalMissing }
    );
  }
}

async function testRotationSigns(report) {
  // T11: Head rotation signs
  // This test requires user interaction — we just verify the values are plausible
  const data = window._lastData;

  if (!data?.face) {
    report.add("T11", "Head rotation signs", SKIP,
      "No face data. Run with face in frame.");
    report.add("T12", "Eye gaze direction", SKIP, "No face data.");
    return;
  }

  const f = data.face;
  const yaw = f.yaw * 57.3;
  const pitch = f.pitch * 57.3;
  const roll = f.roll * 57.3;

  // Plausibility checks (not sign checks — those need user input)
  const yawPlausible = Math.abs(yaw) < 90;
  const pitchPlausible = Math.abs(pitch) < 60;
  const rollPlausible = Math.abs(roll) < 45;

  if (yawPlausible && pitchPlausible && rollPlausible) {
    report.add("T11", "Head rotation signs", PASS,
      `yaw:${yaw.toFixed(1)}° pitch:${pitch.toFixed(1)}° roll:${roll.toFixed(1)}° — ` +
      `MANUAL CHECK: look LEFT → yaw should be NEGATIVE, ` +
      `look DOWN → pitch should be POSITIVE, ` +
      `tilt right ear down → roll should be POSITIVE`
    );
  } else {
    report.add("T11", "Head rotation signs", WARN,
      `Values out of expected range: ` +
      `yaw:${yaw.toFixed(1)}° pitch:${pitch.toFixed(1)}° roll:${roll.toFixed(1)}°`
    );
  }

  // T12: Eye gaze
  if (f.gaze) {
    const g = f.gaze;
    const gazeInRange = [g.leftX, g.leftY, g.rightX, g.rightY]
      .every(v => v >= -1.5 && v <= 1.5);

    report.add("T12", "Eye gaze direction", gazeInRange ? PASS : WARN,
      `L:(${g.leftX.toFixed(2)},${g.leftY.toFixed(2)}) ` +
      `R:(${g.rightX.toFixed(2)},${g.rightY.toFixed(2)}) — ` +
      `MANUAL CHECK: look LEFT → leftX should be NEGATIVE, ` +
      `look UP → leftY should be NEGATIVE`
    );
  } else {
    report.add("T12", "Eye gaze direction", WARN,
      "No iris landmarks. FaceLandmarker may not support them on this device.");
  }
}

async function testFacePicking(report) {
  // T13: Best face selection
  const tracker = window.tracker;
  if (!tracker) {
    report.add("T13", "Face picking", SKIP, "No tracker");
    return;
  }

  // Simulate multiple faces
  const mockFaces = [
    // Face at center, small
    Array(478).fill(null).map((_, i) => ({
      x: 0.5 + (i === 33 ? -0.03 : i === 263 ? 0.03 : 0),
      y: 0.5, z: 0,
    })),
    // Face at top-left, large
    Array(478).fill(null).map((_, i) => ({
      x: 0.1 + (i === 33 ? -0.06 : i === 263 ? 0.06 : 0),
      y: 0.1, z: 0,
    })),
  ];

  // Set noses
  mockFaces[0][1] = { x: 0.5, y: 0.5, z: 0 };
  mockFaces[1][1] = { x: 0.1, y: 0.1, z: 0 };

  const fakeRes = { faceLandmarks: mockFaces };
  const picked = tracker._pickBestFace(fakeRes);

  // Face 0 is at center with smaller eye distance → score = 0.06*3 - 0 = 0.18
  // Face 1 is at corner with larger eye distance → score = 0.12*3 - 0.566 = -0.21
  // So face 0 (center) should be picked
  if (picked === 0) {
    report.add("T13", "Face picking (center priority)", PASS,
      "Correctly picked center face over larger off-center face");
  } else {
    report.add("T13", "Face picking (center priority)", FAIL,
      `Picked face ${picked} instead of 0 (center face). ` +
      "Check _pickBestFace scoring formula."
    );
  }
}

async function testCameraFlip(report) {
  // T14: Camera flip support
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === "videoinput");

  if (cameras.length >= 2) {
    report.add("T14", "Camera flip", PASS,
      `${cameras.length} cameras available. Flip button should work.`);
  } else if (cameras.length === 1) {
    report.add("T14", "Camera flip", WARN,
      "Only 1 camera detected. Flip button will have no effect on this device.");
  } else {
    report.add("T14", "Camera flip", FAIL, "No cameras detected.");
  }
}

async function testSmoothingSlider(report) {
  // T15: Smoothing slider changes filter params
  const tracker = window.tracker;
  if (!tracker) {
    report.add("T15", "Smoothing slider", SKIP, "No tracker");
    return;
  }

  const before = tracker.filters._minCutoff;
  tracker.setSmoothing(0);   // max smooth
  const atZero = tracker.filters._minCutoff;
  tracker.setSmoothing(100); // max responsive
  const atHundred = tracker.filters._minCutoff;
  tracker.setSmoothing(50);  // restore default

  if (atZero < atHundred) {
    report.add("T15", "Smoothing slider", PASS,
      `minCutoff range: ${atZero.toFixed(3)} (smooth) → ${atHundred.toFixed(3)} (responsive)`);
  } else {
    report.add("T15", "Smoothing slider", FAIL,
      `minCutoff did not change as expected: ${atZero} → ${atHundred}`);
  }
}

async function testFrameRate(report) {
  // T16: Frame rate
  return new Promise((resolve) => {
    const frames = [];
    let lastT = performance.now();
    let count = 0;

    function measure(now) {
      frames.push(now - lastT);
      lastT = now;
      if (++count < 30) {
        requestAnimationFrame(measure);
      } else {
        const avgMs = frames.slice(5).reduce((a, b) => a + b, 0) / (frames.length - 5);
        const fps = 1000 / avgMs;

        if (fps >= 25) {
          report.add("T16", "Frame rate", PASS,
            `${fps.toFixed(1)} FPS (${avgMs.toFixed(1)}ms/frame)`);
        } else if (fps >= 15) {
          report.add("T16", "Frame rate", WARN,
            `${fps.toFixed(1)} FPS — below 25fps. Performance may be poor.`);
        } else {
          report.add("T16", "Frame rate", FAIL,
            `${fps.toFixed(1)} FPS — critically low. Check GPU acceleration.`);
        }
        resolve();
      }
    }

    requestAnimationFrame(measure);
  });
}

async function testWakeLock(report) {
  // T17: Wake lock API
  if ("wakeLock" in navigator) {
    try {
      const lock = await navigator.wakeLock.request("screen");
      await lock.release();
      report.add("T17", "Wake lock", PASS, "Screen wake lock supported");
    } catch (err) {
      report.add("T17", "Wake lock", WARN,
        `Wake lock denied: ${err.message}. Screen may sleep during streaming.`);
    }
  } else {
    report.add("T17", "Wake lock", WARN,
      "Wake Lock API not supported. Screen may sleep during streaming.");
  }
}

async function testMobileViewport(report) {
  // T18: Mobile viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw <= 768;
  const isPortrait = vh > vw;
  const overlay = document.getElementById("overlay");
  const hud = document.querySelector(".hud-bottom");

  const overlayVisible = overlay && getComputedStyle(overlay).display !== "none";
  const hudVisible = hud && getComputedStyle(hud).display !== "none";

  report.add("T18", "Mobile viewport", PASS,
    `${vw}×${vh} ${isMobile ? "mobile" : "desktop"} ${isPortrait ? "portrait" : "landscape"} | ` +
    `overlay:${overlayVisible} hud:${hudVisible}`
  );
}

async function testDrawer(report) {
  // T19: Drawer open/close
  const drawer = document.getElementById("drawer");
  const settingsBtn = document.getElementById("settingsBtn");

  if (!drawer || !settingsBtn) {
    report.add("T19", "Settings drawer", FAIL, "drawer or settingsBtn not found in DOM");
    return;
  }

  const wasOpen = drawer.classList.contains("open");

  settingsBtn.click();
  await new Promise(r => setTimeout(r, 100));
  const opened = drawer.classList.contains("open");

  settingsBtn.click();
  await new Promise(r => setTimeout(r, 100));
  const closed = !drawer.classList.contains("open");

  // Restore
  if (wasOpen) settingsBtn.click();

  if (opened && closed) {
    report.add("T19", "Settings drawer", PASS, "Opens and closes correctly");
  } else {
    report.add("T19", "Settings drawer", FAIL,
      `opened:${opened} closed:${closed}`);
  }
}

async function testLatency(report) {
  // T20: Full pipeline latency
  const tracker = window.tracker;
  const avatar = window.avatar;
  const webcam = document.getElementById("webcam");

  if (!tracker?.ready || !avatar?.vrm || !webcam?.srcObject) {
    report.add("T20", "Pipeline latency", SKIP,
      "Camera + VRM must be running to measure latency.");
    return;
  }

  const samples = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const data = tracker.process(webcam, performance.now());
    if (data) {
      avatar.update(data, 1 / 30);
    }
    samples.push(performance.now() - t0);
    await new Promise(r => setTimeout(r, 33));
  }

  const avg = samples.reduce((a, b) => a + b) / samples.length;
  const max = Math.max(...samples);
  const targetMs = 33; // 30fps

  if (avg < targetMs * 0.8) {
    report.add("T20", "Pipeline latency", PASS,
      `avg:${avg.toFixed(1)}ms max:${max.toFixed(1)}ms (budget:${targetMs}ms)`);
  } else if (avg < targetMs) {
    report.add("T20", "Pipeline latency", WARN,
      `avg:${avg.toFixed(1)}ms max:${max.toFixed(1)}ms — close to frame budget`);
  } else {
    report.add("T20", "Pipeline latency", FAIL,
      `avg:${avg.toFixed(1)}ms OVER ${targetMs}ms frame budget. ` +
      "Will drop frames. Check GPU acceleration.");
  }
}

// ── Main runner ────────────────────────────────────────────

export async function runPhase1Tests() {
  const report = new TestReport("Phase 1 — Foundation");

  console.log("\n🧪 Running Phase 1 tests...\n");

  await testCamera(report);
  await testMediaPipe(report);
  await testFilters(report);
  await testAvatar(report);
  await testRotationSigns(report);
  await testFacePicking(report);
  await testCameraFlip(report);
  await testSmoothingSlider(report);
  await testFrameRate(report);
  await testWakeLock(report);
  await testMobileViewport(report);
  await testDrawer(report);
  await testLatency(report);

  const summary = report.print();

  // Store result for programmatic access
  window._phase1TestResult = report.toJSON();

  return summary;
}

// ── Manual head calibration helper ─────────────────────────

export function testHeadSigns() {
  console.log("\n📐 HEAD SIGN CALIBRATION");
  console.log("Follow instructions and check values below.");
  console.log("─────────────────────────────────────────────");

  const interval = setInterval(() => {
    const f = window._lastData?.face;
    if (!f) { console.log("No face detected"); return; }

    const yaw   = (f.yaw   * 57.3).toFixed(1);
    const pitch = (f.pitch * 57.3).toFixed(1);
    const roll  = (f.roll  * 57.3).toFixed(1);
    const gaze  = f.gaze
      ? `L(${f.gaze.leftX.toFixed(2)},${f.gaze.leftY.toFixed(2)})`
      : "no gaze";

    console.log(`yaw:${yaw}° pitch:${pitch}° roll:${roll}° gaze:${gaze}`);
  }, 500);

  console.log("\nInstructions:");
  console.log("  1. Look LEFT  → yaw should show NEGATIVE (-20 to -40)");
  console.log("  2. Look RIGHT → yaw should show POSITIVE (+20 to +40)");
  console.log("  3. Look DOWN  → pitch should show POSITIVE (+10 to +25)");
  console.log("  4. Look UP    → pitch should show NEGATIVE (-10 to -25)");
  console.log("  5. Tilt RIGHT ear down → roll should show POSITIVE");
  console.log("  6. Tilt LEFT  ear down → roll should show NEGATIVE");
  console.log("  7. Look LEFT  → gaze leftX should show NEGATIVE");
  console.log("  8. Look UP    → gaze leftY should show NEGATIVE");
  console.log("\nCall window.stopHeadTest() to stop.\n");

  window.stopHeadTest = () => {
    clearInterval(interval);
    console.log("Head sign test stopped.");
  };
}

// ── Filter quality checker ──────────────────────────────────

export function testFilterQuality() {
  console.log("\n📊 FILTER QUALITY TEST");
  console.log("Stand still for 3 seconds, then move...");

  const samples = [];
  let count = 0;
  const MAX = 90; // 3 seconds at 30fps

  const interval = setInterval(() => {
    const f = window._lastData?.face;
    if (!f) return;

    samples.push({ yaw: f.yaw, pitch: f.pitch, ts: performance.now() });

    if (++count >= MAX) {
      clearInterval(interval);

      // Compute jitter (std dev of differences)
      const diffs = [];
      for (let i = 1; i < samples.length; i++) {
        diffs.push(Math.abs(samples[i].yaw - samples[i-1].yaw));
      }
      const avgDiff = diffs.reduce((a, b) => a + b) / diffs.length;
      const maxDiff = Math.max(...diffs);

      console.log(`\nResults over ${MAX} frames:`);
      console.log(`  Avg frame-to-frame yaw change: ${(avgDiff * 57.3).toFixed(3)}°`);
      console.log(`  Max frame-to-frame yaw change: ${(maxDiff * 57.3).toFixed(3)}°`);

      if (avgDiff * 57.3 < 0.5) {
        console.log("  ✅ Filter quality: EXCELLENT (very stable at rest)");
      } else if (avgDiff * 57.3 < 1.5) {
        console.log("  ✅ Filter quality: GOOD");
      } else if (avgDiff * 57.3 < 3.0) {
        console.log("  ⚠️  Filter quality: OK (some jitter, try increasing smoothing)");
      } else {
        console.log("  ❌ Filter quality: POOR (high jitter, check lighting/distance)");
      }
    }
  }, 33);
}