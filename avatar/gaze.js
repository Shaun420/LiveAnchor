// avatar/gaze.js
// Anatomical eye-gaze solver: raw MediaPipe iris landmarks → normalized,
// de-crossed gaze offsets. Fixes the "crosseyed" screen-convergence look.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class EyeGazeSolver {
  constructor(opts = {}) {
    this.deCross  = opts.deCross  ?? 0.10; // outward bias, cancels near-field convergence
    this.deadZone = opts.deadZone ?? 0.04; // ignores microsaccade jitter
  }

  /** @param lm MediaPipe face landmarks (478 × {x,y,z}) in [0,1] image space */
  solve(lm) {
    if (!lm || lm.length < 478) return null;

    const left  = this._eye(lm[468], lm[33],  lm[133]);
    const right = this._eye(lm[473], lm[362], lm[263]);
    if (!left || !right) return null;

    // De-crossing: push each eye OUTWARD to cancel screen convergence
    left.x  += this.deCross;
    right.x -= this.deCross;

    return { leftX: left.x, leftY: left.y, rightX: right.x, rightY: right.y };
  }

  _eye(iris, cA, cB) {
    if (!iris || !cA || !cB) return null;
    const w = Math.hypot(cA.x - cB.x, cA.y - cB.y); // eye width → distance-invariant
    if (w < 1e-5) return null;

    let rx = (iris.x - (cA.x + cB.x) / 2) / w;
    let ry = (iris.y - (cA.y + cB.y) / 2) / w;

    if (Math.abs(rx) < this.deadZone) rx = 0;
    if (Math.abs(ry) < this.deadZone) ry = 0;

    return { x: clamp(rx * 2, -1, 1), y: clamp(ry * 2, -1, 1) };
  }
}