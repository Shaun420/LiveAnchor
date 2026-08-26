export class GeminiLiveThrottler {
  constructor() {
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.canvas.width = 640;
    this.canvas.height = 360;
    this.canvas.width = 640;
    this.canvas.height = 360;
    this.ctx = this.canvas.getContext('2d');
    this.intervalId = null;
    this.videoElement = null;
    
    this.onHeartbeat = null; // Renamed from onFrame
  }

  init(videoElement) {
    this.videoElement = videoElement;
    
    this.intervalId = setInterval(() => {
      if (this.videoElement && this.videoElement.readyState >= 2 && this.onHeartbeat) {
        this.ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
        const base64 = this.canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        
        // Trigger the Heartbeat (Video + Text)
        this.onHeartbeat(base64);
      }
    }, 1000); // 1 FPS
    
    console.log('[Throttler] 1 FPS Heartbeat active');
  }

  dispose() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.onHeartbeat = null;
    this.videoElement = null;
  }
}