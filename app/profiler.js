export class PerformanceProfiler {
  constructor() {
    this.fps = 0;
    this._frames = 0;
    this._lastFps = performance.now();

    this.trackMs = 0;
    this._trackSamples = [];
    this.memoryUsedMB = 0;
    this.memoryLimitMB = 0;
    this.deviceRAM = navigator.deviceMemory || "?";

    this.geminiConnected = false;
    this.workerActive = false;
    this._lastLatencyAt = 0;
    this.tracking = false;
    this.lastToolCall = null;
    this._toolFlashUntil = 0;

    this._initUI();
    this._startFpsLoop();
    this._uiTimer = typeof setInterval !== "undefined" ? setInterval(() => this._updateUI(), 500) : null;
  }

  _initUI() {
    if (typeof document === "undefined") return;
    this.hud = document.createElement("div");
    this.hud.id = "perf-hud";
    this.hud.style.cssText = `
      position: fixed; top: 10px; left: 10px; z-index: 9999;
      background: rgba(0,0,0,0.85); color: #0f0; font-family: monospace;
      font-size: 13px; padding: 10px; border-radius: 6px; pointer-events: none;
      line-height: 1.6; min-width: 200px; border: 1px solid #333;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(this.hud);
  }

  tick(now, data, procMs = 0) {
    this.tracking = !!(data?.face || data?.body);
    this._trackSamples.push(procMs);
    if (this._trackSamples.length > 30) this._trackSamples.shift();
  }

  _startFpsLoop() {
    if (typeof requestAnimationFrame === "undefined") return;
    const loop = () => {
      this._frames++;
      const now = performance.now();
      if (now - this._lastFps >= 500) {
        this.fps = Math.round((this._frames * 1000) / (now - this._lastFps));
        this._frames = 0;
        this._lastFps = now;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  recordInferenceLatency(ms) {
    this._lastLatencyAt = performance.now();
    this.workerActive = true;
    this._infMs = ms;
  }

  setGeminiStatus(isConnected) {
    this.geminiConnected = isConnected;
  }

  setLastToolCall(label) {
    this.lastToolCall = label;
    this._toolFlashUntil = Date.now() + 800;
  }

  _updateMemory() {
    if (typeof performance !== "undefined" && performance.memory) {
      this.memoryUsedMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
      this.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
    }
  }

  _updateUI() {
    if (!this.hud) return;
    this._updateMemory();
    if (performance.now() - this._lastLatencyAt > 2000) this.workerActive = false;
    if (this._trackSamples.length) {
      this.trackMs = Math.round(this._trackSamples.reduce((a, b) => a + b, 0) / this._trackSamples.length);
    }

    const fpsColor = this.fps >= 55 ? "#0f0" : this.fps >= 30 ? "#ff0" : "#f00";
    const trkColor = this.trackMs < 20 ? "#0f0" : this.trackMs < 33 ? "#ff0" : "#f00";
    const memColor = this.memoryLimitMB && this.memoryUsedMB / this.memoryLimitMB > 0.85 ? "#f00" : "#fff";
    const flashing = this._toolFlashUntil && Date.now() < this._toolFlashUntil;
    this.hud.style.borderColor = flashing ? "#ffdd44" : "#333";
    const toolStr = this.lastToolCall
      ? `<span style="color:${flashing ? "#ffdd44" : "#aaa"};font-weight:bold">${this.lastToolCall}</span>`
      : '<span style="color:#555">—</span>';

    this.hud.innerHTML = `
      <div style="color:${fpsColor}; font-weight:bold;">FPS: ${this.fps}</div>
      <div style="color:${trkColor}">Track: ${this.trackMs} ms</div>
      <div>Tracking: ${this.tracking ? '<span style="color:#0f0">●</span>' : '<span style="color:#888">○</span>'}</div>
      <div style="color:${memColor}">Mem: ${this.memoryUsedMB}${this.memoryLimitMB ? " / " + this.memoryLimitMB + " MB" : " MB"}</div>
      <div>RAM: ${this.deviceRAM} GB</div>
      <div>Gemini: ${this.geminiConnected ? '<span style="color:#0f0">▶ Live</span>' : '<span style="color:#f00">◼ Offline</span>'}</div>
      <div>Worker: ${this.workerActive ? '<span style="color:#0f0">▶ Active</span>' : '<span style="color:#888">⚪ Idle</span>'}</div>
      <div>Last Tool: ${toolStr}</div>
    `;
  }

  dispose() {
    if (this._uiTimer) clearInterval(this._uiTimer);
    this.hud?.remove();
    this.hud = null;
  }
}
