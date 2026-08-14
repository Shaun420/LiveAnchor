export class Recorder {
  constructor(stageEl) {
    this.stageEl = stageEl;
    this.recorder = null;
    this.chunks = [];
    this.recording = false;
    this.startTime = 0;
  }

  start() {
    if (this.recording) return;

    // Capture the entire stage
    const canvas = document.createElement("canvas");
    const stage = this.stageEl;
    canvas.width = stage.clientWidth;
    canvas.height = stage.clientHeight;

    const ctx = canvas.getContext("2d");
    const video = stage.querySelector("video");
    const overlay = stage.querySelector("#overlay");

    const drawFrame = () => {
      if (!this.recording) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
      requestAnimationFrame(drawFrame);
    };

    const stream = canvas.captureStream(30);
    this.recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: 5000000,
    });

    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `liveAnchor_${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };

    this.recorder.start(100);
    this.recording = true;
    this.startTime = Date.now();
    drawFrame();
  }

  stop() {
    if (!this.recording) return;
    this.recorder.stop();
    this.recording = false;
  }

  getDuration() {
    if (!this.recording) return "";
    const sec = Math.floor((Date.now() - this.startTime) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
}