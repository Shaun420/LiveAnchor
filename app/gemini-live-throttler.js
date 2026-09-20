// app/gemini-live-throttler.js
// Production-ready 1 FPS Throttler: Async Encoding, Dynamic Aspect Ratio, Privacy Mask Support

export class GeminiLiveThrottler {
  constructor() {
    // SSR / test environment guard
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.ctx = this.canvas ? this.canvas.getContext('2d', { willReadFrequently: false }) : null;
    
    if (this.canvas) {
      this.canvas.width = 640; 
      this.canvas.height = 360; 
    }
    
    this.timeoutId = null;
    this.isProcessing = false;
    this.isRunning = false;
    this.isSized = false;
    
    this.source = null; 
    this.onHeartbeat = null; 
    this._debugFlash = null;
    this._lastFrameHash = null;
  }

  init(source) {
    // Prevent stacking intervals if init() is called multiple times
    this.dispose(); 
    
    this.source = source;
    this.isRunning = true;
    this.isSized = false;
    
    // Use recursive setTimeout instead of setInterval to prevent async pile-up
    const tick = () => {
      if (!this.isRunning) return;
      
      // Skip if the previous frame is still encoding (prevents memory pile-up on slow devices)
      if (this.isProcessing) {
        this.timeoutId = setTimeout(tick, 1000);
        return;
      }

      if (!this.source || !this.onHeartbeat) {
        this.timeoutId = setTimeout(tick, 1000);
        return;
      }
      
      // 1. Dynamic Aspect Ratio Sizing (Fixes the squished 16:9 webcam bug)
            if (!this.isSized) {
              const srcW = this.source.videoWidth || this.source.width;
              const srcH = this.source.videoHeight || this.source.height;
              if (srcW && srcH) {
                const aspect = srcW / srcH;
                this.canvas.width = 640;
                this.canvas.height = Math.round(640 / aspect);
                this.isSized = true;
                console.log('[Throttler] Sized canvas to:', this.canvas.width, 'x', this.canvas.height, '(source:', srcW, 'x', srcH, ')');
              } else {
                console.log('[Throttler] Waiting for video dimensions... (videoWidth:', this.source.videoWidth, 'videoHeight:', this.source.videoHeight, ')');
              }
            }

      // 2. Draw Frame
                        try {
                          if (this.source instanceof HTMLCanvasElement) {
                            this.ctx.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);
                          } else if (this.source.readyState >= 2) {
                            this.ctx.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);
                          } else {
                            console.log('[Throttler] Video not ready (readyState:', this.source.readyState, '), waiting...');
                            this.timeoutId = setTimeout(tick, 100);
                            return; 
                          }
                          console.log('[Throttler] Frame drawn successfully, canvas size:', this.canvas.width, 'x', this.canvas.height);
                        } catch (err) {
                          console.warn('[Throttler] drawImage failed (CORS/Tainted?):', err);
                          this.timeoutId = setTimeout(tick, 1000);
                          return;
                        }

                        // 🔍 Frame deduplication: skip if frame hasn't changed (prevents frozen webcam from spamming API)
                        if (this.ctx) {
                          const imgData = this.ctx.getImageData(0, 0, 16, 9); // Tiny sample for fast hash
                          let hash = 0;
                          for (let i = 0; i < imgData.data.length; i += 4) {
                            hash = ((hash << 5) - hash) + imgData.data[i] + imgData.data[i+1] + imgData.data[i+2];
                            hash |= 0; // 32-bit int
                          }
                          if (hash === this._lastFrameHash) {
                            // Frame unchanged - skip encoding, but still schedule next tick
                            this.timeoutId = setTimeout(tick, 1000);
                            return;
                          }
                          this._lastFrameHash = hash;
                          console.log('[Throttler] Frame hash:', hash);
                        }

      // 3. Async Encode
      this.isProcessing = true;
      this.canvas.toBlob((blob) => {
        this.isProcessing = false;
        
        if (!blob) {
          console.warn('[Throttler] toBlob returned null. Canvas is likely tainted by CORS.');
          this.timeoutId = setTimeout(tick, 1000);
          return;
        }
        
        // 🟢 Trigger visual flash (capture local reference to prevent ghost flashes)
        const flashEl = this._debugFlash;
        if (flashEl) {
          flashEl.style.opacity = '1';
          setTimeout(() => { flashEl.style.opacity = '0'; }, 150);
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.error || !reader.result) {
            console.warn('[Throttler] FileReader error:', reader.error);
          } else {
            const base64 = reader.result.split(',')[1];
            this.onHeartbeat(base64);
          }
          // Schedule next frame ONLY after this one is fully processed
          this.timeoutId = setTimeout(tick, 1000);
        };
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.7); 
    };

    // Start the loop
    tick();
    console.log('[Throttler] 1 FPS Async Heartbeat active (Privacy-aware)');
  }

  // 👁️ DEBUG VIEW: Renders the exact feed sent to Gemini
    showDebug() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('gemini-debug-container')) return;

    const container = document.createElement('div');
    container.id = 'gemini-debug-container';
    container.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      width: 240px; height: 135px; /* 16:9 aspect ratio container */
      border: 3px solid #00ff00; border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 255, 0, 0.4);
      overflow: hidden; background: #000;
      font-family: monospace;
    `;

    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.objectFit = 'cover'; // Ensures no letterboxing in the PiP
    container.appendChild(this.canvas);

    const label = document.createElement('div');
    label.innerText = '👁️ GEMINI VIEW (1 FPS)';
    label.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0;
      background: rgba(0,0,0,0.7); color: #0f0; font-size: 11px; font-weight: bold;
      text-align: center; padding: 4px 0; pointer-events: none;
    `;
    container.appendChild(label);

    this._debugFlash = document.createElement('div');
    this._debugFlash.style.cssText = `
      position: absolute; inset: 0; background: rgba(0, 255, 0, 0.4);
      opacity: 0; transition: opacity 0.15s ease-out; pointer-events: none;
    `;
    container.appendChild(this._debugFlash);

    const dlBtn = document.createElement('button');
    dlBtn.innerText = '⬇ Save';
    dlBtn.style.cssText = `
      position: absolute; bottom: 6px; right: 6px;
      background: rgba(0,0,0,0.8); color: #0f0; border: 1px solid #0f0;
      font-size: 10px; font-weight: bold; padding: 3px 8px; cursor: pointer;
      border-radius: 4px;
    `;
    dlBtn.onclick = (e) => {
      e.stopPropagation();
      try {
        const link = document.createElement('a');
        link.download = `gemini_frame_${Date.now()}.jpg`;
        link.href = this.canvas.toDataURL('image/jpeg', 0.95);
        link.click();
      } catch (err) {
        console.error('[Throttler] Save failed (Canvas tainted?):', err);
      }
    };
    container.appendChild(dlBtn);

    document.body.appendChild(container);
    console.log('[Throttler] Debug PiP enabled. Green flash = frame sent to API.');
  }

  hideDebug() {
      if (typeof document === 'undefined') return;
      const container = document.getElementById('gemini-debug-container');
      if (container) container.remove();
      this._debugFlash = null;
      console.log('[Throttler] Debug PiP disabled.');
    }

  dispose() {
      this.isRunning = false;
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.isProcessing = false;
      this.onHeartbeat = null;
      this.source = null;
      if (typeof document !== 'undefined') {
        this.hideDebug();
      }
    }
}