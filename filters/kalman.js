// ============================================================
// Simple 1D Kalman filter
// Used to predict joint positions during occlusion
// ============================================================

export class KalmanFilter1D {
  /**
   * @param {number} R - Measurement noise (higher = trust measurements less)
   * @param {number} Q - Process noise (higher = expect faster changes)
   */
  constructor(R = 0.01, Q = 0.0001) {
    this.R = R; // measurement noise
    this.Q = Q; // process noise
    this.P = 1; // error covariance
    this.x = null; // state estimate
    this.K = 0; // Kalman gain
  }

  filter(measurement) {
    if (this.x === null) {
      this.x = measurement;
      return measurement;
    }

    // Predict
    this.P = this.P + this.Q;

    // Update
    this.K = this.P / (this.P + this.R);
    this.x = this.x + this.K * (measurement - this.x);
    this.P = (1 - this.K) * this.P;

    return this.x;
  }

  predict() {
    // Predict without measurement (during occlusion)
    this.P = this.P + this.Q;
    return this.x;
  }

  reset() {
    this.x = null;
    this.P = 1;
  }
}

export class KalmanFilterVec3 {
  constructor(R = 0.01, Q = 0.0001) {
    this.kx = new KalmanFilter1D(R, Q);
    this.ky = new KalmanFilter1D(R, Q);
    this.kz = new KalmanFilter1D(R, Q);
  }

  filter(v) {
    return {
      x: this.kx.filter(v.x),
      y: this.ky.filter(v.y),
      z: this.kz.filter(v.z),
    };
  }

  predict() {
    return {
      x: this.kx.predict(),
      y: this.ky.predict(),
      z: this.kz.predict(),
    };
  }

  reset() {
    this.kx.reset();
    this.ky.reset();
    this.kz.reset();
  }
}