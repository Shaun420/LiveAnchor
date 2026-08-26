// poseLifterWorker.js
// Runs entirely in a Web Worker background thread.
// Responsibilities:
// - Manage the 27-frame ring buffer for VideoPose3D receptive field
// - Initialize and run ONNX inference session
// - Post 3D joint data back to main thread via postMessage
// - Never block the main thread's requestAnimationFrame loop

import * as ort from 'onnxruntime-web';

let session = null;
let buffer = [];
const BUFFER_SIZE = 27; // VideoPose3D standard receptive field
let isInitialized = false;

// Handle messages from the main thread
self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    try {
      // Configure ONNX execution providers: WebGPU first, then WASM fallback
      ort.env.wasm.numThreads = 1; // Keep worker threads clean (single-core enough for ONNX)
      ort.env.wasm.simd = true;

      session = await ort.InferenceSession.create(payload.modelPath, {
        executionProviders: ['webgpu', 'wasm']
      });

      isInitialized = true;
      self.postMessage({ type: 'STATUS', payload: 'ONNX model loaded successfully' });
    } catch (err) {
      console.error('[Worker] ONNX init error:', err);
      self.postMessage({ type: 'ERROR', payload: `ONNX init failed: ${err.message}` });
    }
  }

  if (type === 'PROCESS_2D' && isInitialized) {
    const normalizedFrame = payload; // Array of 17 [x, y] coordinates, normalized [-1, 1]

    // 1. Update Ring Buffer (FIFO)
    buffer.push(normalizedFrame);
    if (buffer.length > BUFFER_SIZE) {
      buffer.shift(); // Drop oldest frame
    }

    // 2. Wait until buffer is full before inferring
    // This ensures the TCN has its full receptive field
    if (buffer.length < BUFFER_SIZE) {
      // Post null result; main thread will use last known 3D pose
      self.postMessage({ type: 'RESULT', payload: null });
      return;
    }

    // 3. Run ONNX Inference
    try {
      // Flatten the 27-frame buffer into [1, 27, 17, 2] tensor
      // buffer is an array of 27 frames, each frame is 17 joints × 2 coords (x, y)
      const flatData = new Float32Array(buffer.flat().flat());

      // Create ONNX tensor: [batch=1, seq=27, joints=17, coords=2]
      const inputTensor = new ort.Tensor('float32', flatData, [1, BUFFER_SIZE, 17, 2]);

      // Run inference — use first input name and first output name dynamically
      const feeds = {};
      feeds[session.inputNames[0]] = inputTensor;

      const results = await session.run(feeds);
      const output = results[session.outputNames[0]].data; // [1, 27, 17, 3] float32

      // 4. Extract the latest frame (most recent prediction) from the buffer
      // The last frame starts at index: (BUFFER_SIZE - 1) * 17 * 3
      const lastFrameStart = (BUFFER_SIZE - 1) * 17 * 3;

      const joints3d = [];
      for (let i = 0; i < 17; i++) {
        const idx = lastFrameStart + i * 3; // Each joint is 3 values (x, y, z)
        // Convert from ONNX coordinate system to Three.js Y-up:
        // ONNX: typically Z-up, Y-down or similar; we map:
        //   x -> x (right)
        //   y -> -z (forward → up in Three.js)
        //   z -> -y (up → left/right in Three.js, depending on convention)
        // The most common/straightforward mapping for VideoPose3D → Three.js:
 joints3d.push({
          x: output[idx],           // X coordinate (right-handed)
          y: -output[idx + 2],    // Z → Y in Three.js (invert Z to become Y)
          z: output[idx + 1]       // Y → Z in Three.js (invert Y to become Z)
        });
      }

      // 5. Post result back to main thread
      self.postMessage({ type: 'RESULT', payload: joints3d });
    } catch (err) {
      console.error('[Worker] Inference error:', err);
      // On error, post null so main thread gracefully degrades to last known pose
      self.postMessage({ type: 'RESULT', payload: null });
    }
  }
};