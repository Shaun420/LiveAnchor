// ── Live values ──
export function testHands() {
  console.log("\n🖐️ LIVE HAND TEST");
  console.log("Watch values while: opening/closing fist, rotating wrist, flipping palm.");
  console.log("Palm-flip check: same half-fist, palm-to-camera vs palm-away → curls should match.\n");

  const interval = setInterval(() => {
    const data = window._lastData;
    const hands = data?.hands;
    if (!hands || Object.keys(hands).length === 0) {
      console.log("❌ No hands in view");
      return;
    }
    for (const [side, hand] of Object.entries(hands)) {
      const f = hand.fingers;
      const fwd = hand.handForward, nrm = hand.palmNormal;
      console.log(
        `[${side.toUpperCase()}] ` +
        `fwd:(${fwd.x.toFixed(2)},${fwd.y.toFixed(2)},${fwd.z.toFixed(2)}) ` +
        `n:(${nrm.x.toFixed(2)},${nrm.y.toFixed(2)},${nrm.z.toFixed(2)}) | ` +
        `T:${f.thumb.curl.toFixed(2)}/opp:${(f.thumb.opposition ?? 0).toFixed(2)} ` +
        `I:${f.index.curl.toFixed(2)} M:${f.middle.curl.toFixed(2)} ` +
        `R:${f.ring.curl.toFixed(2)} P:${f.pinky.curl.toFixed(2)}`
      );
    }
  }, 400);

  window.stopHandTest = () => { clearInterval(interval); console.log("Stopped."); };
}

// ── Assertion 1: fist ramp — curl must reach ≥0.9, monotonic ──
export function testFistRamp() {
  console.log("\n✊ FIST RAMP TEST — slowly close your fist over ~3 seconds...");
  const t0 = performance.now();
  const samples = {};   // finger -> { peak, declines, prev }
  for (const name of ["thumb", "index", "middle", "ring", "pinky"])
    samples[name] = { peak: 0, declines: 0, prev: 0 };

  const interval = setInterval(() => {
    const hand = window._lastData?.hands?.right || window._lastData?.hands?.left;
    if (!hand) return;
    for (const [name, s] of Object.entries(samples)) {
      const c = hand.fingers[name].curl;
      if (c > s.peak) s.peak = c;
      if (c < s.prev - 0.08 && s.peak < 0.9) s.declines++;  // big dip before completion
      s.prev = c;
    }
    if (performance.now() - t0 > 5000) {
      clearInterval(interval);
      console.log("\n— Fist ramp results —");
      let pass = true;
      for (const [name, s] of Object.entries(samples)) {
        const ok = s.peak >= 0.9 && s.declines <= 1;
        if (!ok) pass = false;
        console.log(`${ok ? "✅" : "❌"} ${name}: peak ${s.peak.toFixed(2)} (need ≥0.90), dips ${s.declines}`);
      }
      console.log(pass ? "PASS" : "FAIL — if peak ≈0.5–0.6, curl ceiling bug is back; if dips, check filters");
    }
  }, 100);
  window.stopFistRamp = () => clearInterval(interval);
}

// ── Assertion 2: wrist-circle invariance — fist + rotate wrist, curl must hold ──
export function testWristInvariance() {
  console.log("\n🔄 WRIST INVARIANCE — make a fist, then rotate/tilt your wrist for 4 seconds...");
  const t0 = performance.now();
  const xs = [];
  const interval = setInterval(() => {
    const hand = window._lastData?.hands?.right || window._lastData?.hands?.left;
    if (hand) xs.push(hand.fingers.index.curl);
    if (performance.now() - t0 > 4000) {
      clearInterval(interval);
      if (xs.length < 20) return console.log("❌ No hand data captured");
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
      const ok = sd < 0.05;
      console.log(`${ok ? "✅ PASS" : "❌ FAIL"} — index curl sd ${sd.toFixed(3)} over ${xs.length} frames (need <0.05)`);
      if (!ok) console.log("High variance under wrist rotation = 2D-angle curl math or broken palm frame.");
    }
  }, 100);
  window.stopWristTest = () => clearInterval(interval);
}

// ── Assertion 4: left/right mirror symmetry — the reflection-bug regression test ──
export function testHandSymmetry() {
  const avatar = window.avatar;
  if (!avatar?.bones?.leftHand) return console.log("❌ No avatar/bones loaded");

  console.log("\n🪞 SYMMETRY TEST — hold both hands out, mirrored, palms down, fingers spread...");
  const _a = new (avatar.bones.leftHand.position.constructor)();
  const _b = _a.clone();

  const tipRel = (side) => {
    const hand = avatar.bones[`${side}Hand`];
    const tip = avatar.bones[`${side}IndexDistal`];
    if (!hand || !tip) return null;
    avatar.vrm.scene.updateMatrixWorld(true);
    return tip.getWorldPosition(new _a.constructor).sub(hand.getWorldPosition(new _a.constructor));
  };

  let frames = 0, totalErr = 0;
  const t0 = performance.now();
  const interval = setInterval(() => {
    const L = tipRel("left"), R = tipRel("right");
    if (L && R) {
      // mirror left fingertip across X, compare against right
      const mx = -L.x, my = L.y, mz = L.z;
      const err = Math.hypot(mx - R.x, my - R.y, mz - R.z);
      totalErr += err; frames++;
    }
    if (performance.now() - t0 > 4000) {
      clearInterval(interval);
      if (!frames) return console.log("❌ Couldn't read fingertips");
      const avg = totalErr / frames;
      const ok = avg < 0.03;   // 3cm — loose (human mirror pose isn't exact); reflection bugs produce ~2×bone-length error
      console.log(`${ok ? "✅ PASS" : "❌ FAIL"} — avg mirrored fingertip offset ${ (avg * 100).toFixed(1) }cm over ${frames} frames`);
      if (!ok) console.log("Large offset = left/right basis chirality mismatch (the baked-bake bug class).");
    }
  }, 200);
  window.stopSymmetryTest = () => clearInterval(interval);
}

// ── Force fist on avatar (fingers only — wrist decays to rest by design) ──
export function testFingerDriver() {
  const avatar = window.avatar;
  if (!avatar) return console.log("No avatar loaded");

  console.log("✊ Forcing full fist (fingers isolated; wrist at rest).");
  console.log("Expected: closed fist, ≥90° MCP bend, thumb tucked via opposition.");

  const F1 = { curl: 1.0, mcp: 1.0, pip: 1.0, opposition: 0 };
  const FT = { curl: 1.0, mcp: 1.0, pip: 1.0, opposition: 1.0 };
  const mockHand = () => ({
    handedness: "Left",
    // wrist vectors deliberately OMITTED → wrist block skipped, decays to rest.
    // To test the WRIST itself, paste real vectors from testHands() output here.
    fingers: { thumb: FT, index: { ...F1 }, middle: { ...F1 }, ring: { ...F1 }, pinky: { ...F1 } },
  });
  const mockHands = { left: mockHand(), right: { ...mockHand(), handedness: "Right" } };

  const origUpdate = avatar.update.bind(avatar);
  avatar.update = function (data, dt) {
    data = data || {};
    data.hands = mockHands;
    origUpdate(data, dt);
  };

  window.stopFingerDriverTest = () => {
    avatar.update = origUpdate;
    window.stopFingerDriverTest = undefined;
    console.log("Restored normal tracking.");
  };
}