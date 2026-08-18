import {
  ImageSegmenter,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs";

let segmenter = null;
let lastMask = null;
let ready = false;

export async function initSegmenter() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
  );

  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });

  ready = true;
  console.log("[Segmenter] Ready (selfie_segmenter)");
}

export function isSegmenterReady() {
  return ready;
}

export function segmentFrame(video, timestamp) {
  if (!ready || !segmenter) return null;

  const result = segmenter.segmentForVideo(video, timestamp);

  if (result.categoryMask) {
    lastMask = {
      data: result.categoryMask.getAsUint8Array(),
      width: result.categoryMask.width,
      height: result.categoryMask.height,
    };

    // Important: close the mask to free WebGL resources
    result.categoryMask.close();
  }

  return lastMask;
}

export function getLastMask() {
  return lastMask;
}