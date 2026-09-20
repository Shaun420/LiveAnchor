export class PoseLifter {
  constructor() { this.worker = null; this.joints17 = null; this.busy = false; }

  init(modelPath = './models/lifting/mobile_human_pose_working_well_256x256.onnx') {
    this.worker = new Worker(new URL('./poseLifterWorker.js', import.meta.url), { type: 'module' });
    this.worker.postMessage({ type: 'INIT', payload: { modelPath } });
    this.worker.onmessage = (e) => {
      if (e.data.type === 'RESULT') { this.joints17 = e.data.payload.joints; this.busy = false; }
    };
  }

  process(video, lm) {
    if (!this.worker || this.busy || !video.videoWidth) return; // fire-and-forget, never queue
    // Compute torso-centered 256×256 crop
    const cx = ((lm[23].x + lm[24].x) / 2) * video.videoWidth;
    const cy = ((lm[23].y + lm[24].y) / 2) * video.videoHeight;
    const torso = Math.hypot(lm[11].x - lm[23].x, lm[11].y - lm[23].y) * video.videoWidth;
    const side = Math.max(128, Math.min(video.videoWidth, video.videoHeight, torso * 3.5));

    const cropCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (cropCanvas) { cropCanvas.width = cropCanvas.height = 256; }
    const cropCtx = cropCanvas?.getContext('2d', { willReadFrequently: true });
    if (!cropCtx) return;

    cropCtx.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, 256, 256);
    const pixels = cropCtx.getImageData(0, 0, 256, 256).data;

    this.busy = true;
    this.worker.postMessage({ type: 'PROCESS_2D', payload: { pixels } }, [pixels.buffer]);
  }

  dispose() { this.worker?.terminate(); this.worker = null; }
}