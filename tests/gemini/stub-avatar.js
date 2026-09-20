/**
 * Recording avatar — the frozen contract of what gemini-client.js wires to.
 * If init.js wires a different callback name, rename the method here.
 */

export class RecordingAvatar {
  calls = [];
  handOverrides = { left: null, right: null };
  activeGestures = { left: null, right: null };

  setEmotion(emotion, intensity = 1.0) {
    this.calls.push({ type: 'setEmotion', arg: { emotion, intensity } });
  }

  triggerGesture(gesture, hand) {
    this.calls.push({ type: 'triggerGesture', arg: { gesture, hand } });
    if (hand === 'both') {
      this.activeGestures.left = gesture;
      this.activeGestures.right = gesture;
    } else if (hand === 'left' || hand === 'right') {
      this.activeGestures[hand] = gesture;
    }
  }

  spawnProp(propName, hand) {
    this.calls.push({ type: 'spawnProp', arg: { propName, hand } });
  }

  setHandIKTarget(hand, target) {
    this.calls.push({ type: 'setHandIKTarget', arg: { hand, target } });
    this.handOverrides[hand] = target === 'release' ? null : target;
  }
}
