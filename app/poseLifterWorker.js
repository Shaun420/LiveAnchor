// app/poseLifterWorker.js
import * as ort from 'onnxruntime-web';

let session = null;
const SIZE = 256;

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      ort.env.wasm.wasmPaths = msg.wasmPaths || '/ort/';
      session = await ort.InferenceSession.create(msg.modelPath, { executionProviders: ['wasm'] });
      console.log('[Lifter] ONNX loaded. Inputs:', session.inputNames, 'Outputs:', session.outputNames);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (msg.type === 'frame' && session) {
    const { pixels } = msg; // Uint8ClampedArray RGBA, 256*256*4
    const n = SIZE * SIZE;
    const input = new Float32Array(3 * n);

    // ✅ EXACT NORMALIZATION FROM convert_script.txt: data / 255
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      input[i]         = pixels[o]     / 255.0; // R
      input[n + i]     = pixels[o + 1] / 255.0; // G
      input[2 * n + i] = pixels[o + 2] / 255.0; // B
    }

    const t0 = performance.now();
    const feeds = {
      [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE])
    };
    
    const out = await session.run(feeds);
    const raw = out[session.outputNames[0]].data; // Expect 51 floats (17 * 3)
    
    self.postMessage({ 
      type: 'pose3d', 
      joints: Array.from(raw), 
      latency: performance.now() - t0 
    });
  }
};