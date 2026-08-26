// testing/gaze.js
import { EyeGazeSolver } from "../avatar/gaze.js";

export function registerGazeTests() {
  window.testGaze = () => {
    const s = new EyeGazeSolver({ deCross: 0.10, deadZone: 0.04 });

    const base = () => {
      const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
      lm[33]  = { x: 0.30, y: 0.45, z: 0 };  lm[133] = { x: 0.40, y: 0.45, z: 0 };
      lm[362] = { x: 0.60, y: 0.45, z: 0 };  lm[263] = { x: 0.70, y: 0.45, z: 0 };
      return lm;
    };
    const iris = (lm, lx, ly, rx, ry) => {
      lm[468] = { x: lx, y: ly, z: 0 }; lm[473] = { x: rx, y: ry, z: 0 };
    };

    const cases = [];
    let lm = base(); iris(lm, 0.350, 0.450, 0.650, 0.450); cases.push(["center (expect ±0.100 bias only)", lm]);
    lm = base(); iris(lm, 0.320, 0.450, 0.620, 0.450); cases.push(["look image-left", lm]);
    lm = base(); iris(lm, 0.380, 0.450, 0.680, 0.450); cases.push(["look image-right", lm]);
    lm = base(); iris(lm, 0.350, 0.420, 0.650, 0.420); cases.push(["look up", lm]);
    lm = base(); iris(lm, 0.350, 0.480, 0.650, 0.480); cases.push(["look down", lm]);
    lm = base(); iris(lm, 0.351, 0.451, 0.651, 0.449); cases.push(["micro-jitter (expect dead-zone → 0)", lm]);
    lm = base(); iris(lm, 0.300, 0.450, 0.600, 0.450); cases.push(["extreme (expect clamp ±1)", lm]);

    console.table(cases.map(([name, l]) => {
      const g = s.solve(l);
      return {
        case: name,
        leftX: g.leftX.toFixed(3),  leftY: g.leftY.toFixed(3),
        rightX: g.rightX.toFixed(3), rightY: g.rightY.toFixed(3),
      };
    }));
    console.log("[testGaze] Pass criteria: center row ≈ ±0.100/0.000 · jitter row = bias only · extreme row clamped at ±1.");
  };
}