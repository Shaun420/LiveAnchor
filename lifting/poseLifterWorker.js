self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    const { modelPath, wasmPaths } = payload;
    // ort is already globally available from the ORT WASM build
    self.session = await ort.InferenceSession.create({ debug: false, wasmPaths });
    self.session.loadModel(modelPath);
    self.isInitialized = true;
    self.postMessage({ type: 'STATUS', payload: 'Model loaded successfully' });
  }

  if (type === 'PROCESS_2D' && self.isInitialized) {
    const { pixels } = payload; // Uint8ClampedArray RGBA 256*256*4
    const n = 256 * 256;
    const input = new Float32Array(3 * n);

    // Exact normalization: 'data / 255'
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      input[i]     = pixels[o]     / 255;
      input[n + i] = pixels[o + 1] / 255;
      input[2 * n + i] = pixels[o + 2] / 255;
    }

    const feeds = {
      [self.session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 256, 256])
    };

    const t0 = performance.now();
    const out = await self.session.run(feeds);
    const latency = performance.now() - t0;

    self.postMessage({
      type: 'RESULT',
      payload: { joints: Array.from(out[self.session.outputNames[0]].data), latency }
    });
  }
};