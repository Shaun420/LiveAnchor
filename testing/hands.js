export function testHands() {
  console.log("\n🖐️ LIVE HAND & WRIST TEST");
  console.log("Move your wrist around (twist/tilt) and make a fist.\n");

  const interval = setInterval(() => {
    const data = window._lastData;
    if (!data?.hands || Object.keys(data.hands).length === 0) {
      console.log("❌ No hands in view");
      return;
    }

    for (const [side, hand] of Object.entries(data.hands)) {
      const f = hand.fingers;
      const fwd = hand.handForward;
      console.log(
        `[${side.toUpperCase()}] ` +
        `Wrist Dir:(${fwd.x.toFixed(2)}, ${fwd.y.toFixed(2)}, ${fwd.z.toFixed(2)}) | ` +
        `Curls: Thumb:${f.thumb.curl.toFixed(2)} Index:${f.index.curl.toFixed(2)} Mid:${f.middle.curl.toFixed(2)}`
      );
    }
  }, 400);

  window.stopHandTest = () => {
    clearInterval(interval);
    console.log("Hand test stopped.");
  };
}

export function testFingerDriver() {
  const avatar = window.avatar;
  if (!avatar) return console.log("No avatar loaded");

  console.log("✊ Forcing full fist on avatar...");

  const mockHands = {
    left: {
      handedness: "Left",
      handForward: { x: 0, y: 0, z: -1 },
      fingers: {
        thumb: { curl: 1.0 }, index: { curl: 1.0 }, middle: { curl: 1.0 }, ring: { curl: 1.0 }, pinky: { curl: 1.0 }
      }
    },
    right: {
      handedness: "Right",
      handForward: { x: 0, y: 0, z: -1 },
      fingers: {
        thumb: { curl: 1.0 }, index: { curl: 1.0 }, middle: { curl: 1.0 }, ring: { curl: 1.0 }, pinky: { curl: 1.0 }
      }
    }
  };

  const origUpdate = avatar.update.bind(avatar);
  avatar.update = function(data, dt) {
    data = data || {};
    data.hands = mockHands;
    origUpdate(data, dt);
  };

  window.stopFingerDriverTest = () => {
    avatar.update = origUpdate;
    console.log("Restored normal tracking.");
  };
}