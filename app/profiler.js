// profiler.js
// Zero-dependency Performance HUD for LiveAnchor.
// Measures Main Thread FPS, ONNX Worker Inference Latency, JS Heap Memory, and Gemini Connection Health.
// Updates every 500ms. No external dependencies (no stats.js, no third-party libs).

export class PerformanceProfiler {
  constructor() {
    this.fps = 0;
    this.frames = 0;
    this.lastFpsUpdate = performance.now();
    
    this.inferenceLatencies = [];
    this.avgInferenceMs = 0;
    
    this.memoryUsedMB = 0;
    this.memoryLimitMB = 0;
    this.deviceRAM = navigator.deviceMemory || '?'; // Total device RAM (e.g., 4, 8)
    
    this.geminiConnected = false;
    this.workerActive = false;
    
    this._initUI();
    this._startFpsLoop();
    this._startUpdateLoop();
  }

  _initUI() {
    this.hud = document.createElement('div');
    this.hud.id = 'perf-hud';
    this.hud.style.cssText = `
      position: fixed; top: 10px; left: 10px; z-index: 9999;
      background: rgba(0,0,0,0.85); color: #0f0; font-family: monospace;
      font-size: 13px; padding: 10px; border-radius: 6px; pointer-events: none;
      line-height: 1.6; min-width: 200px; border: 1px solid #333;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(this.hud);
  }

  // Runs independently of the render loop to ensure we measure true browser FPS
  _startFpsLoop() {
    const loop = () => {
      this.frames++;
      const now = performance.now();
      if (now - this.lastFpsUpdate >= 500) {
        this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsUpdate));
        this.frames = 0;
        this.lastFpsUpdate = now;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _startUpdateLoop() {
    setInterval(() => this._updateUI(), 500);
  }

  // Hook: Called by PoseLifter when the worker replies
  recordInferenceLatency(ms) {
    this.inferenceLatencies.push(ms);
    if (this.inferenceLatencies.length > 30) this.inferenceLatencies.shift(); // Rolling 30-frame average
    this.avgInferenceMs = Math.round(
      this.inferenceLatencies.reduce((a, b) => a + b, 0) / this.inferenceLatencies.length
    );
    this.workerActive = true;
  }

  // Hook: Called by GeminiClient
  setGeminiStatus(isConnected) {
    this.geminiConnected = isConnected;
  }

  _updateMemory() {
    // Chrome-only API for exact JS Heap usage
    if (performance.memory) {
      this.memoryUsedMB = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
      this.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / (1024 * 1024));
    }
  }

  _updateUI() {
    this._updateMemory();
    
    // Color coding based on performance thresholds
    const fpsColor = this.fps >= 55 ? '#0f0' : this.fps >= 30 ? '#ff0' : '#f00';
    const infColor = this.avgInferenceMs < 33 ? '#0f0' : this.avgInferenceMs < 66 ? '#ff0' : '#f00';
    const memColor = this.memoryLimitMB && (this.memoryUsedMB / this.memoryLimitMB > 0.85) ? '#f00' : '#fff';

    this.hud.innerHTML = `
      <div style="color:${fpsColor}; font-weight:bold;">FPS: ${this.fps}</div>
      <div style="color:${infColor}">ONNX Inf: ${this.avgInferenceMs} ms</div>
      <div style="color:${memColor}">Mem: ${this.memoryUsedMB}${this.memoryLimitMB ? ' / ' + this.memoryLimitMB + ' MB' : ' MB'}</div>
      <div>Device RAM: ${this.deviceRAM} GB</div>
      <div>Gemini: ${this.geminiConnected ? '<span style="color:#0f0">▶ Live</span>' : '<span style="color:#f00">◼ Offline</span>'}</div>
      <div>Worker: ${this.workerActive ? '<span style="color:#0f0">▶ Active</span>' : '<span style="color:#888">⚪ Idle</span>'}</div>
    `;
  }
}