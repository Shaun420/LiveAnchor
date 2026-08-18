const ORT_VERSION = "1.20.1";
const ORT_DIST = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const CACHE_NAME = "depth-models-v1";
const MODEL_URL = "https://huggingface.co/Heliosoph/midas-small-onnx/resolve/main/midas_v21_small_256.onnx";
const SIZE = 256;

let ort = null;
let session = null;
let inName = null;
let outName = null;
let ready = false;

// Reusable buffers
const inputBuffer = new Float32Array(3 * SIZE * SIZE);
const grabCanvas = document.createElement("canvas");
grabCanvas.width = SIZE;
grabCanvas.height = SIZE;
const grabCtx = grabCanvas.getContext("2d", { willReadFrequently: true });

// Depth map state
let lastDepthData = null;
let lastDepthMin = 0;
let lastDepthMax = 1;
let lastVideoWidth = 1280;
let lastVideoHeight = 720;
let inferenceCount = 0;

// ============================================================
// Load
// ============================================================

function loadOrtScript() {
  return new Promise((resolve, reject) => {
    if (window.ort) return resolve(window.ort);
    const s = document.createElement("script");
    s.src = ORT_DIST + "ort.all.min.js";
    s.crossOrigin = "anonymous";
    s.onload = () => resolve(window.ort);
    s.onerror = () => reject(new Error("Failed to load onnxruntime-web"));
    document.head.appendChild(s);
  });
}

async function fetchWithCache(url) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    console.log("[Depth] Model loaded from cache");
    return await cached.arrayBuffer();
  }
  console.log("[Depth] Downloading model...");
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await cache.put(url, response.clone());
  console.log("[Depth] Model cached");
  return await response.arrayBuffer();
}

export async function initDepth() {
  if (ready) return;
  console.log("[Depth] Initializing MiDaS Small...");
  ort = await loadOrtScript();
  ort.env.wasm.wasmPaths = ORT_DIST;
  ort.env.wasm.numThreads = 1;

  const buffer = await fetchWithCache(MODEL_URL);
  session = await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
  });
  inName = session.inputNames[0];
  outName = session.outputNames[0];

  // Warmup
  const warmup = new ort.Tensor("float32", new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]);
  await session.run({ [inName]: warmup });

  ready = true;
  console.log("[Depth] MiDaS ready (256x256, WASM)");
}

// ============================================================
// Grab + preprocess
// ============================================================

function grabFrame(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  let sx, sy, sw, sh;
  if (vw > vh) {
    sh = vh; sw = vh;
    sx = (vw - sw) / 2; sy = 0;
  } else {
    sw = vw; sh = vw;
    sx = 0; sy = (vh - sh) / 2;
  }
  grabCtx.drawImage(video, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
  return grabCtx.getImageData(0, 0, SIZE, SIZE);
}

function preprocess(imageData) {
  const { data } = imageData;
  const N = SIZE * SIZE;
  for (let i = 0; i < N; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    inputBuffer[i] = (b - 0.406) / 0.225;
    inputBuffer[N + i] = (g - 0.456) / 0.224;
    inputBuffer[2 * N + i] = (r - 0.485) / 0.229;
  }
  return inputBuffer;
}

// ============================================================
// Inference
// ============================================================

export async function estimateDepth(video) {
  if (!ready) return null;

  lastVideoWidth = video.videoWidth;
  lastVideoHeight = video.videoHeight;

  const imageData = grabFrame(video);
  const input = preprocess(imageData);
  const tensor = new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]);
  const t0 = performance.now();
  const results = await session.run({ [inName]: tensor });
  const ms = performance.now() - t0;
  const depthData = results[outName].data;

  // Min/max
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < depthData.length; i++) {
    if (depthData[i] < min) min = depthData[i];
    if (depthData[i] > max) max = depthData[i];
  }

  lastDepthData = depthData;
  lastDepthMin = min;
  lastDepthMax = max;

  inferenceCount++;
  if (inferenceCount <= 3 || inferenceCount % 60 === 0) {
    console.log(`[Depth] #${inferenceCount} ${ms.toFixed(0)}ms | range: ${min.toFixed(1)}..${max.toFixed(1)} | delta: ${(max - min).toFixed(1)}`);
  }

  return depthData;
}

// ============================================================
// Sample depth at normalized video coordinates
// Returns 0..1 where 0 = far, 1 = near
// ============================================================

export function sampleDepth(xNorm, yNorm) {
  if (!lastDepthData) return 0.5;

  const videoAspect = lastVideoWidth / lastVideoHeight;
  let cropXNorm, cropYNorm;

  if (videoAspect > 1) {
    // Landscape: center-crop horizontally
    const cropWidthNorm = 1 / videoAspect;
    const cropStartX = (1 - cropWidthNorm) / 2;
    cropXNorm = (xNorm - cropStartX) / cropWidthNorm;
    cropYNorm = yNorm;
  } else {
    const cropHeightNorm = videoAspect;
    const cropStartY = (1 - cropHeightNorm) / 2;
    cropXNorm = xNorm;
    cropYNorm = (yNorm - cropStartY) / cropHeightNorm;
  }

  cropXNorm = Math.max(0, Math.min(1, cropXNorm));
  cropYNorm = Math.max(0, Math.min(1, cropYNorm));

  const px = Math.floor(cropXNorm * (SIZE - 1));
  const py = Math.floor(cropYNorm * (SIZE - 1));
  const idx = py * SIZE + px;

  const raw = lastDepthData[idx] || 0;
  const range = (lastDepthMax - lastDepthMin) || 1;

  // MiDaS: higher value = nearer
  return (raw - lastDepthMin) / range;
}

export function getDepthInfo() {
  return {
    ready,
    hasData: !!lastDepthData,
    size: SIZE,
    min: lastDepthMin,
    max: lastDepthMax,
    range: lastDepthMax - lastDepthMin,
    inferenceCount,
    videoSize: `${lastVideoWidth}x${lastVideoHeight}`,
  };
}