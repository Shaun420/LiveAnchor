// poseLifter.js
// Lightweight asynchronous wrapper that communicates with poseLifterWorker.js (Web Worker).
// Responsibilities:
// - Instantiate and manage the background worker
// - Send 2D normalized landmarks to the worker for ONNX 3D lifting
// - Receive 3D joints via postMessage resolve/reject pattern
// - Provide a clean API compatible with the existing avatar driver pipeline
// - Never block the main thread's requestAnimationFrame loop

export class PoseLifter {
  constructor() {
    // The background worker that handles ONNX inference
    this.worker = null;

    // Flag indicating whether the worker has successfully loaded the ONNX model
    this.isReady = false;

    // Queue of pending promises. When the worker posts a RESULT message,
    // we resolve the oldest pending promise with the 3D joints data.
    // This pattern allows fire-and-forget calls from the animation loop.
    this.resolveQueue = [];
  }

  /**
   * Initialize the Web Worker and load the VideoPose3D ONNX model.
   * @param {string} modelPath - Path to the ONNX model (e.g., '/models/videopose3d_27f.onnx')
   * @returns {Promise<void>} Resolves when the worker is ready.
   */
  async init(modelPath) {
    // 1. Instantiate the Web Worker (type: 'module' enables importmaps/ESM in worker)
    this.worker = new Worker(new URL('./poseLifterWorker.js', import.meta.url), {
      type: 'module'
    });

    // 2. Listen for messages from the worker
    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;

      if (type === 'STATUS') {
        // Worker reports it has loaded the model successfully
        console.log(`[PoseLifter] ${payload}`);
        this.isReady = true;
      } else if (type === 'ERROR') {
        // Worker failed to load the ONNX model
        console.error(`[PoseLifter] ${payload}`);
      } else if (type === 'RESULT') {
        // Worker finished inference (or buffer not full); resolve the oldest pending promise
        if (this.resolveQueue.length > 0) {
          const resolve = this.resolveQueue.shift();
          // payload is either an array of 17 {x,y,z} objects, or null
          resolve(payload);
        }
      }
    };

    // 3. Tell the worker to load the ONNX model
    this.worker.postMessage({ type: 'INIT', payload: { modelPath } });

    // 4. Wait for the worker to report readiness.
    // We use a simple polling loop (could be improved with a one-shot resolve).
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (this.isReady) {
          clearInterval(check);
          resolve();
        }
      }, 100); // Check every 100ms
    });
  }

  /**
   * Asynchronously lift 2D normalized landmarks to 3D using the ONNX worker.
   * This method does NOT block the main thread.
   *
   * @param {Array} normalized2DLandmarks - Array of 17 {x, y} coordinates, typically normalized to [-1, 1] space.
   * @returns {Promise<Array|void>} Resolves to an array of 17 {x, y, z} objects,
   *                               or null if the buffer wasn't full yet or inference failed.
   */
  lift(normalized2DLandmarks) {
    if (!this.isReady) {
      // If worker isn't ready yet, immediately resolve with null
      // (main thread will use last known 3D pose)
      return Promise.resolve(null);
    }

    // CRITICAL FIX: Prevent queue buildup.
    // If the worker is too slow (inference takes longer than frame interval),
    // drop the oldest pending request so the avatar's 3D pose doesn't lag
    // further and further behind reality.
    if (this.resolveQueue.length > 2) {
      const staleResolve = this.resolveQueue.shift();
      staleResolve(null); // Drop the stale frame silently
    }

    // 1. Queue a new promise that will be resolved when the worker replies
    this.resolveQueue.push(Promise.resolve());

    // 2. Send the 2D landmark data to the worker for processing
    this.worker.postMessage({
      type: 'PROCESS_2D',
      payload: normalized2DLandmarks
    });

    // 3. Return a promise that will resolve when the worker posts 'RESULT'.
    // We return the last promise in the queue (the one we just pushed).
    // This promise will be resolved inside the onmessage handler above.
    return this.resolveQueue[this.resolveQueue.length - 1];
  }

  /**
   * Clean up the worker when the component unmounts or is no longer needed.
   * Terminates the background thread and clears the queue.
   */
  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.resolveQueue = [];
  }
}