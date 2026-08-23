// ============================================================
// OneEuro Filter
// Géry Casiez, Nicolas Roussel, Daniel Vogel (2012)
// "1€ Filter: A Simple Speed-based Low-pass Filter for
//  Noisy Input in Interactive Systems"
//
// Key properties:
//   - Low lag during fast motion
//   - Low noise during slow/no motion
//   - Single tuning knob (beta) for motion sensitivity
// ============================================================

class LowPassFilter {
  constructor(alpha) {
    this._alpha = alpha;
    this._y = null;
    this._s = null;
  }

  setAlpha(alpha) {
    this._alpha = Math.max(0, Math.min(1, alpha));
  }

  filter(value, alpha) {
    if (alpha !== undefined) this.setAlpha(alpha);
    if (this._y === null) {
      this._y = value;
      this._s = value;
      return value;
    }
    const result = this._alpha * value + (1 - this._alpha) * this._s;
    this._y = value;
    this._s = result;
    return result;
  }

  lastValue() {
    return this._s;
  }

  reset() {
    this._y = null;
    this._s = null;
  }
}

export class OneEuroFilter {
  /**
   * @param {number} freq     - Sampling frequency in Hz (e.g. 30)
   * @param {number} minCutoff- Min cutoff frequency (smoothness at rest, default 1.0)
   * @param {number} beta     - Speed coefficient (responsiveness, default 0.007)
   * @param {number} dCutoff  - Cutoff for derivative (default 1.0)
   */
  constructor(freq = 30, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this._freq = Math.max(1, freq);
    this._minCutoff = minCutoff;
    this._beta = beta;
    this._dCutoff = dCutoff;
    this._xFilter = new LowPassFilter(this._alpha(minCutoff));
    this._dxFilter = new LowPassFilter(this._alpha(dCutoff));
    this._lastTime = null;
  }

  _alpha(cutoff) {
    const te = 1.0 / this._freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  reset() {
    this._xFilter.reset();
    this._dxFilter.reset();
    this._lastTime = null;
  }

  /**
   * Filter a single scalar value.
   * @param {number} x     - New value
   * @param {number} [ts]  - Timestamp in seconds (optional)
   * @returns {number}       Filtered value
   */
  filter(x, ts) {
    // Update frequency estimate if timestamps provided
    if (this._lastTime !== null && ts !== undefined) {
      const dt = ts - this._lastTime;
      if (dt > 0) this._freq = 1.0 / dt;
    }
    this._lastTime = ts;

    // Derivative
    const prevX = this._xFilter.lastValue();
    const dx = prevX === null ? 0.0 : (x - prevX) * this._freq;
    const edx = this._dxFilter.filter(dx, this._alpha(this._dCutoff));

    // Adaptive cutoff
    const cutoff = this._minCutoff + this._beta * Math.abs(edx);

    return this._xFilter.filter(x, this._alpha(cutoff));
  }
}

// ============================================================
// OneEuroFilterVec3
// Filters a {x, y, z} object with independent per-axis filters
// ============================================================

export class OneEuroFilterVec3 {
  constructor(freq = 30, minCutoff = 1.0, beta = 0.007) {
    this.fx = new OneEuroFilter(freq, minCutoff, beta);
    this.fy = new OneEuroFilter(freq, minCutoff, beta);
    this.fz = new OneEuroFilter(freq, minCutoff, beta);
  }

  filter(v, ts) {
    return {
      x: this.fx.filter(v.x, ts),
      y: this.fy.filter(v.y, ts),
      z: this.fz.filter(v.z, ts),
    };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

// ============================================================
// OneEuroFilterPose
// Manages a bank of OneEuro filters for a complete pose
// Each named value gets its own filter instance
// ============================================================

export class OneEuroFilterPose {
  /**
   * @param {Object} config - { minCutoff, beta, freq }
   */
  constructor(config = {}) {
    this._freq = config.freq || 30;
    this._minCutoff = config.minCutoff ?? 1.0;
    this._beta = config.beta ?? 0.007;
    this._filters = new Map();
  }

  /**
   * Filter a flat object of named scalar values.
   * New keys are automatically initialized.
   *
   * @param {Object} values  - e.g. { yaw: 0.1, pitch: -0.2, roll: 0.05 }
   * @param {number} [ts]    - timestamp in seconds
   * @returns {Object}         Filtered values with same keys
   */
  filter(values, ts) {
    const result = {};
    for (const [key, val] of Object.entries(values)) {
      if (typeof val !== "number") {
        result[key] = val;
        continue;
      }
      if (!this._filters.has(key)) {
        this._filters.set(
          key,
          new OneEuroFilter(this._freq, this._minCutoff, this._beta)
        );
      }
      result[key] = this._filters.get(key).filter(val, ts);
    }
    return result;
  }

  /**
   * Filter a vec3 by key name.
   */
  filterVec3(key, v, ts) {
    const kx = key + "_x", ky = key + "_y", kz = key + "_z";
    return {
      x: this.filterScalar(kx, v.x, ts),
      y: this.filterScalar(ky, v.y, ts),
      z: this.filterScalar(kz, v.z, ts),
    };
  }

  filterScalar(key, val, ts) {
    if (!this._filters.has(key)) {
      this._filters.set(
        key,
        new OneEuroFilter(this._freq, this._minCutoff, this._beta)
      );
    }
    return this._filters.get(key).filter(val, ts);
  }

  reset() {
    for (const f of this._filters.values()) f.reset();
  }

  /**
   * Update filter parameters dynamically
   * (e.g. when user changes smoothing slider)
   */
  setParams(minCutoff, beta) {
    this._minCutoff = minCutoff;
    this._beta = beta;
    // Recreate all filters with new params
    for (const [key] of this._filters) {
      this._filters.set(
        key,
        new OneEuroFilter(this._freq, minCutoff, beta)
      );
    }
  }
}