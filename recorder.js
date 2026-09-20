export class Recorder {
  constructor(stageEl) {
    this.stageEl = stageEl;
    this.mirror = true;
    this.recorder = null;
    this.chunks = [];
    this.recording = false;
    this.startTime = 0;
  }

  start() {
    if (this.recording) return;
    const stage = this.stageEl;
    const video = stage.querySelector("video");
    const overlay = stage.querySelector("#overlay");
    const avatar = stage.querySelector("#avatarCanvas");

    const canvas = document.createElement("canvas");
    canvas.width = stage.clientWidth;
    canvas.height = stage.clientHeight;
    const ctx = canvas.getContext("2d");

    const drawFrame = () => {
      if (!this.recording) return;
      const w = canvas.width, h = canvas.height;
      if (this.mirror) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        if (video) ctx.drawImage(video, 0, 0, w, h);
        if (overlay) ctx.drawImage(overlay, 0, 0, w, h);
        ctx.restore();
      } else {
        if (video) ctx.drawImage(video, 0, 0, w, h);
        if (overlay) ctx.drawImage(overlay, 0, 0, w, h);
      }
      if (avatar) ctx.drawImage(avatar, 0, 0, w, h);
      requestAnimationFrame(drawFrame);
    };

    const mime =
      (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) ? "video/webm;codecs=vp9" :
      (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm")) ? "video/webm" : "";

    const stream = canvas.captureStream(30);
    this.recorder = new MediaRecorder(stream, {
      ...(mime && { mimeType: mime }),
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
    if (!this.recording || !this.recorder) return;
    this.recorder.stop();
    this.recording = false;
  }

  getDuration() {
    if (!this.recording) return "";
    const sec = Math.floor((Date.now() - this.startTime) / 1000);
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
  }
}
