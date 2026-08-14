import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs";
import { Avatar } from "./avatar.js";

const video = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");
const vrmInput = document.getElementById("vrmInput");

let faceLandmarker = null;
let avatar = null;
let stream = null;
let running = false;
let lastVideoTime = -1;

const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const NOSE_TIP = 1;
const CHIN = 152;
const FOREHEAD = 10;
const UPPER_LIP = 13;
const LOWER_LIP = 14;

async function loadModel() {
  statusEl.textContent = "Loading face landmarker...";
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    outputFaceBlendshapes: false,
    runningMode: "VIDEO",
    numFaces: 1,
  });
  statusEl.textContent = "Model ready";
}

async function startCamera() {
  if (running) return;

  await loadModel();

  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: false,
  });

  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
  await video.play();

  avatar = new Avatar(overlay);

  // Try to load a default VRM
  try {
    await avatar.loadVRM("./models/avatar.vrm");
    statusEl.textContent = "VRM loaded";
  } catch (e) {
    console.warn("No default VRM found, please upload one", e);
    statusEl.textContent = "No VRM found — please upload one";
  }

  running = true;
  startBtn.textContent = "Stop Camera";
  requestAnimationFrame(loop);
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  startBtn.textContent = "Start Camera";
  statusEl.textContent = "Idle";
}

startBtn.addEventListener("click", () => {
  if (running) stopCamera();
  else startCamera();
});

vrmInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !avatar) return;

  const url = URL.createObjectURL(file);
  await avatar.loadVRM(url);
  statusEl.textContent = "Custom VRM loaded";
});

function get2D(landmark, w, h) {
  return [landmark.x * w, landmark.y * h];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function extractAnchor(landmarks, w, h) {
  const leftEye = get2D(landmarks[LEFT_EYE_OUTER], w, h);
  const rightEye = get2D(landmarks[RIGHT_EYE_OUTER], w, h);
  const nose = get2D(landmarks[NOSE_TIP], w, h);
  const chin = get2D(landmarks[CHIN], w, h);
  const upperLip = get2D(landmarks[UPPER_LIP], w, h);
  const lowerLip = get2D(landmarks[LOWER_LIP], w, h);

  const eyeCenter = [
    (leftEye[0] + rightEye[0]) / 2,
    (leftEye[1] + rightEye[1]) / 2,
  ];
  const faceCenter = [
    (eyeCenter[0] + nose[0]) / 2,
    (eyeCenter[1] + chin[1]) / 2,
  ];
  const eyeDistance = distance(leftEye, rightEye);
  const mouthOpen = distance(upperLip, lowerLip) / eyeDistance;

  const dx = rightEye[0] - leftEye[0];
  const dy = rightEye[1] - leftEye[1];
  const roll = (Math.atan2(dy, dx) * 180) / Math.PI;

  return {
    x: faceCenter[0],
    y: faceCenter[1],
    eyeDistance: eyeDistance,
    roll: roll,
    mouthOpen: mouthOpen,
  };
}

function loop() {
  if (!running) return;

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const w = video.videoWidth;
    const h = video.videoHeight;

    if (w && h && faceLandmarker) {
      const results = faceLandmarker.detectForVideo(video, performance.now());

      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const anchor = extractAnchor(results.faceLandmarks[0], w, h);

        const sx = overlay.clientWidth / w;
        const sy = overlay.clientHeight / h;

        const canvasAnchor = {
          x: overlay.clientWidth - anchor.x * sx,
          y: anchor.y * sy,
          eyeDistance: anchor.eyeDistance * sx,
          roll: -anchor.roll,
          mouthOpen: anchor.mouthOpen,
        };

        avatar.setAnchor(canvasAnchor);
      }
    }
  }

  avatar.update();
  avatar.render();
  requestAnimationFrame(loop);
}

window.addEventListener("resize", () => {
  if (avatar) avatar.resize();
});