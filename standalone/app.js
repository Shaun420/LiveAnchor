// Gemini Live API — Standalone client
// Mirrors the production LiveAnchor AI Director architecture:
// - 1 FPS JPEG throttler with frame deduplication
// - Gemini ER-2 Streaming API via WebSocket
// - Tool calls: trigger_gesture, set_hand_ik_target, spawn_prop, ack
// - pendingTurn lock, auto-reconnect, ack/no-op handling

const MODEL = 'models/gemini-robotics-er-2-streaming-preview';
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'trigger_gesture',
        description: 'User makes a clear hand sign. Returns the gesture name + hand.',
        parameters: {
          type: 'OBJECT',
          properties: {
            gesture: { type: 'STRING', enum: ['peace_sign', 'thumbs_up', 'pointing', 'open_palm', 'rock_on'] },
            hand: { type: 'STRING', enum: ['left', 'right', 'both'] },
          },
          required: ['gesture', 'hand'],
        },
      },
      {
        name: 'set_hand_ik_target',
        description: 'Hand is occluded, behind back, or holding object. Locks to body anchor.',
        parameters: {
          type: 'OBJECT',
          properties: {
            hand: { type: 'STRING', enum: ['left', 'right'] },
            target: { type: 'STRING', enum: ['hip', 'mouth', 'behind_back', 'chin', 'chest', 'release'] },
          },
          required: ['hand', 'target'],
        },
      },
      {
        name: 'spawn_prop',
        description: 'User is holding a real object. Spawns a 3D prop in avatar hand.',
        parameters: {
          type: 'OBJECT',
          properties: {
            prop_name: { type: 'STRING' },
            hand: { type: 'STRING', enum: ['left', 'right'] },
          },
          required: ['prop_name', 'hand'],
        },
      },
      {
        name: 'ack',
        description: 'Hands visible and tracking normally. No action needed.',
        parameters: {
          type: 'OBJECT',
          properties: { status: { type: 'STRING', description: 'Brief status note' } },
        },
      },
    ],
  },
];

const SYSTEM_INSTRUCTION = `AI vision supervisor. You receive 1 FPS webcam frames.
Monitor hands. Call ONE tool per frame:
- clear hand sign → trigger_gesture
- hand steady on object → spawn_prop + set_hand_ik_target("chest")
- hand hidden → set_hand_ik_target(body anchor)
- anchored hand now free → set_hand_ik_target("release")
- normal → ack

Decisive. No prose.`;

const PROMPT_TEXT = `[HEARTBEAT] Observe the user's hands. Call exactly one tool: clear hand sign → trigger_gesture; hand holding object → spawn_prop + set_hand_ik_target('chest'); hand hidden → set_hand_ik_target(body anchor); previously anchored hand now free → set_hand_ik_target('release'); otherwise → ack.`;

// ─────────────────────────── State ───────────────────────────

const state = {
  ws: null,
  isConnected: false,
  pendingTurns: 0,
  pendingTimer: null,
  pendingTimerMs: 6000,
  throttler: null,
  stats: { sent: 0, recv: 0, tools: 0, lastLatency: null, fps: 0 },
  reconnectAttempts: 0,
  reconnectTimer: null,
};

// ─────────────────────────── DOM helpers ───────────────────────────

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const log = (msg, kind = 'sys') => {
  if (typeof document === 'undefined') return; // Node — no DOM
  const el = $('log');
  if (!el) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${kind}`;
  const ts = new Date().toLocaleTimeString();
  entry.textContent = `[${ts}] ${msg}`;
  el.appendChild(entry);
  el.scrollTop = el.scrollHeight;
};

function setStatus(live, text) {
  $('statusDot').className = `dot ${live ? 'live' : ''}`;
  $('statusText').textContent = text;
  $('connectBtn').disabled = live;
  $('disconnectBtn').disabled = !live;
  $('testBtn').disabled = !live;
}

function updateStats() {
  const ids = ['sentCount', 'recvCount', 'toolCount', 'latency', 'fps'];
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    if (id === 'sentCount') el.textContent = state.stats.sent;
    else if (id === 'recvCount') el.textContent = state.stats.recv;
    else if (id === 'toolCount') el.textContent = state.stats.tools;
    else if (id === 'latency') el.textContent = state.stats.lastLatency ?? '—';
    else if (id === 'fps') el.textContent = state.stats.fps.toFixed(1);
  }
}

// ─────────────────────────── 1 FPS Throttler ───────────────────────────

class GeminiThrottler {
  constructor() {
    if (typeof document !== 'undefined') this.canvas = document.createElement('canvas');
    if (this.canvas) {
      this.canvas.width = 640;
    this.canvas.height = 360;
    }
    this.ctx = this.canvas ? this.canvas.getContext('2d', { willReadFrequently: false }) : null;
    this.source = null;
    this.onFrame = null;
    this.timeoutId = null;
    this.isRunning = false;
    this.lastFrameHash = null;
    this.frameCount = 0;
    this.fpsTimer = performance.now();
  }

  init(source, onFrame) {
    this.dispose();
    this.source = source;
    this.onFrame = onFrame;
    this.isRunning = true;
    // Reset canvas sizing so first frame triggers a resize.
    this._sizedFor = '';

    const tick = async () => {
      if (!this.isRunning) return;
      if (!this.source || !this.onFrame) {
        this.timeoutId = setTimeout(tick, 1000);
        return;
      }
      const srcW = this.source.videoWidth || this.source.width;
      const srcH = this.source.videoHeight || this.source.height;
      if (!srcW || !srcH) {
        this.timeoutId = setTimeout(tick, 100);
        return;
      }
      // Resize canvas to match source aspect ratio (once, or if dimensions changed).
      const sizeKey = `${srcW}x${srcH}`;
      if (this._sizedFor !== sizeKey) {
        const aspect = srcW / srcH;
        this.canvas.width = 640;
        this.canvas.height = Math.round(640 / aspect);
        this._sizedFor = sizeKey;
      }
      if (!this.canvas.width || !this.canvas.height) {
        this.timeoutId = setTimeout(tick, 100);
        return;
      }
      try {
        if (this.source.readyState >= 2) {
          this.ctx.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);
        } else {
          this.timeoutId = setTimeout(tick, 100);
          return;
        }
      } catch (err) {
        log(`drawImage failed: ${err.message}`, 'err');
        this.timeoutId = setTimeout(tick, 1000);
        return;
      }
      // Frame deduplication — safe-guard against zero-sized canvas.
      let imgData;
      try {
        imgData = this.ctx.getImageData(0, 0, 16, 9).data;
      } catch (err) {
        log(`getImageData failed: ${err.message}`, 'err');
        this.timeoutId = setTimeout(tick, 1000);
        return;
      }
      if (!imgData || !imgData.length) {
        this.timeoutId = setTimeout(tick, 1000);
        return;
      }
      let hash = 0;
      // imgData is already a Uint8ClampedArray (the .data property of ImageData).
      for (let i = 0; i < imgData.length; i += 4) {
        hash = ((hash << 5) - hash) + imgData[i] + imgData[i+1] + imgData[i+2];
        hash |= 0;
      }
      if (hash !== this.lastFrameHash) {
              this.lastFrameHash = hash;
        
              // ⚡ OPT #12: JPEG quality 0.5 instead of 0.7 — saves ~30% frame size
              this.canvas.toBlob((blob) => {
          if (!blob) {
            log('toBlob returned null (canvas tainted?)', 'err');
            this.timeoutId = setTimeout(tick, 1000);
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            this.onFrame(base64);
            this.timeoutId = setTimeout(tick, 1000);
          };
          reader.readAsDataURL(blob);
                  }, 'image/jpeg', 0.5);
                  this.frameCount += 1;
        const now = performance.now();
        if (now - this.fpsTimer > 500) {
          state.stats.fps = this.frameCount * 1000 / (now - this.fpsTimer);
          this.frameCount = 0;
          this.fpsTimer = now;
          updateStats();
        }
      } else {
        this.timeoutId = setTimeout(tick, 1000);
      }
    };

    tick();
    log('Throttler: 1 FPS active', 'sys');
  }

  dispose() {
    this.isRunning = false;
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = null;
    this.source = null;
    this.onFrame = null;
  }
}

// ─────────────────────────── Gemini WebSocket client ───────────────────────────

class GeminiLiveClient {
  constructor(apiKey, opts = {}) {
    this.apiKey = apiKey;
    this.wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    this.ws = null;
    this.pendingTurn = false;
    this.pendingTimer = null;
    this.pendingTimerMs = 6000;
    this.heartbeatSentAt = null;
    this.onConnectionChange = null;
    this.onToolCall = null;
    // Allow tests/Node to inject a custom WebSocket factory.
    this.socketFactory = opts.socketFactory || function (url) { return new globalThis.WebSocket(url); };
  }

  connect() {
    log(`Connecting to ${MODEL}...`, 'sys');
    this.ws = this.socketFactory(this.wsUrl);

    this.ws.onopen = () => {
      log('WebSocket opened. Sending setup.', 'sys');
      this._sendSetup();
    };

    this.ws.onmessage = async (event) => {
      let raw = event.data;
      if (raw instanceof Blob) raw = await raw.text();
      else if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
      this._handleMessage(raw);
    };

    this.ws.onerror = (err) => {
      log(`WebSocket error: ${err?.message ?? err}`, 'err');
    };

    this.ws.onclose = (event) => {
      log(`WebSocket closed: ${event.reason || '(no reason)'}`, 'sys');
      this.pendingTurn = false;
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      if (this.onConnectionChange) this.onConnectionChange(false);
    };
  }

  _sendSetup() {
    const msg = {
      setup: {
        model: MODEL,
        generationConfig: {
                  responseModalities: ['TEXT'],
                  maxOutputTokens: 100,
                  temperature: 0.2,
                },
        // ⚡ OPT #1: Low media resolution saves ~60% image tokens
        mediaResolution: 'MEDIA_RESOLUTION_LOW',
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        tools: TOOLS,
      },
    };
    this.ws.send(JSON.stringify(msg));
    log('Setup message sent.', 'send');
  }

  // ⚡ OPT #3: Async heartbeat — fire-and-forget with sliding-window backpressure.
  // The GeminiLiveClient no longer gates on a single pendingTurn lock; instead it
  // tracks a count and drops only when the pipeline is overwhelmed. Responses
  // arrive whenever they arrive and apply to whatever's current.
  sendHeartbeat(base64Jpeg) {
    if (!this.ws || this.ws.readyState !== 1) return;
    if (this.pendingTurns >= 5) {
      // Backpressure: max 5 inflight responses. Adjust as needed.
      return;
    }
    this.pendingTurns += 1;

    this.heartbeatSentAt = performance.now();
    const msg = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: [
            { inlineData: { data: base64Jpeg, mimeType: 'image/jpeg' } },
            { text: PROMPT_TEXT },
          ],
        }],
        turnComplete: true,
      },
    };
    this.ws.send(JSON.stringify(msg));
    state.stats.sent += 1;
    updateStats();
    log(`Heartbeat #${state.stats.sent} sent (${(base64Jpeg.length / 1024).toFixed(1)}kB)`, 'send');
  }

  _handleMessage(raw) {
    let response;
    try {
      response = JSON.parse(raw);
    } catch (err) {
      log(`JSON parse error: ${err.message}`, 'err');
      return;
    }
    if (!response || typeof response !== 'object') return;

    state.stats.recv += 1;
    if (this.heartbeatSentAt) {
      state.stats.lastLatency = Math.round(performance.now() - this.heartbeatSentAt);
    }
    updateStats();

    if (response.setupComplete) {
      log('✅ Setup complete — ER-2 Live session active!', 'sys');
      this.isConnected = true;
      if (this.onConnectionChange) this.onConnectionChange(true);
      return;
    }

    if (response.serverContent?.turnComplete || response.serverContent?.interrupted) {
          this.pendingTurns = Math.max(0, this.pendingTurns - 1);
          return;
        }

        if (response.toolCall) {
          this.pendingTurns = Math.max(0, this.pendingTurns - 1);
          this._handleToolCall(response.toolCall);
          return;
        }

    if (response.serverContent?.modelTurn?.parts) {
      for (const part of response.serverContent.modelTurn.parts) {
        if (part.text) log(`[AI]: ${part.text}`, 'recv');
      }
    }
  }

  _handleToolCall(toolCall) {
    const functionResponses = [];
    const VALID_HAND = new Set(['left', 'right', 'both']);
    const VALID_IK = new Set(['hip', 'mouth', 'behind_back', 'chin', 'chest', 'release']);
    const VALID_GESTURE = new Set(['peace_sign', 'thumbs_up', 'pointing', 'open_palm', 'rock_on']);
    const KNOWN_TOOLS = new Set(['trigger_gesture', 'set_hand_ik_target', 'spawn_prop', 'ack']);

    for (const fc of toolCall.functionCalls || []) {
      log(`🔧 Tool call: ${fc.name}(${JSON.stringify(fc.args)})`, 'tool');
      state.stats.tools += 1;
      updateStats();

      let result = { status: 'success' };
      try {
        if (!KNOWN_TOOLS.has(fc.name)) {
          throw new Error(`unknown or unsupported tool: ${fc.name}`);
        }
        const args = fc.args || {};
        if (fc.name === 'trigger_gesture') {
          if (!VALID_GESTURE.has(args.gesture)) throw new Error(`unknown gesture: ${args.gesture}`);
          if (!VALID_HAND.has(args.hand)) throw new Error(`unknown hand: ${args.hand}`);
        } else if (fc.name === 'set_hand_ik_target') {
          if (!VALID_HAND.has(args.hand) || args.hand === 'both') throw new Error(`invalid hand: ${args.hand}`);
          if (!VALID_IK.has(args.target)) throw new Error(`unknown IK target: ${args.target}`);
        } else if (fc.name === 'spawn_prop') {
          if (typeof args.prop_name !== 'string') throw new Error('prop_name must be string');
          if (!VALID_HAND.has(args.hand) || args.hand === 'both') throw new Error(`invalid hand: ${args.hand}`);
        }
        if (this.onToolCall) this.onToolCall(fc.name, args);
      } catch (err) {
        log(`Tool error: ${err.message}`, 'err');
        result = { error: err.message };
      }

      functionResponses.push({ name: fc.name, id: fc.id, response: result });
    }

    if (functionResponses.length === 0) return;
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
    }
  }

  disconnect() {
      if (this.ws) this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.pendingTurns = 0;
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
}

// ─────────────────────────── Boot ───────────────────────────

async function start() {  const apiKey = $('apiKey').value.trim();
  if (!apiKey) {
    log('Please enter an API key.', 'err');
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    $('webcam').srcObject = state.stream;
    await $('webcam').play();
    $('overlay').textContent = `${state.stream.getVideoTracks()[0].label || 'Camera'}`;
    log(`Camera started: ${$('webcam').videoWidth}x${$('webcam').videoHeight}`, 'sys');
  } catch (err) {
    log(`Camera error: ${err.message}`, 'err');
    return;
  }

  state.client = new GeminiLiveClient(apiKey);
  state.client.onConnectionChange = (live) => setStatus(live, live ? 'Live' : 'Offline');
  state.client.onToolCall = (name, args) => {
    // In a real app, this would drive an avatar. Here we just log.
    void name; void args;
  };
  state.client.connect();

  state.throttler = new GeminiThrottler();
  state.throttler.init($('webcam'), (base64) => state.client.sendHeartbeat(base64));
}

function stop() {
  if (state.throttler) state.throttler.dispose();
  if (state.client) state.client.disconnect();
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  setStatus(false, 'Offline');
}

// ─────────────────────────── Boot ───────────────────────────

let domReady = false;
let bootAttempts = 0;

async function bootIfBrowser() {
  // Only run DOM-dependent boot when document is available.
  if (typeof document === 'undefined') return;
  // Wait for DOMContentLoaded if not ready yet.
  if (document.readyState === 'loading') {
    await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }
  domReady = true;

  $('connectBtn').addEventListener('click', start);
  $('disconnectBtn').addEventListener('click', stop);
  $('clearLogBtn').addEventListener('click', () => ($('log').innerHTML = ''));
  $('testBtn').addEventListener('click', () => {
    if (!state.client || !state.client.ws || state.client.ws.readyState !== 1) {
      log('Not connected.', 'err');
      return;
    }
    const c = document.createElement('canvas');
    c.width = 320; c.height = 240;
    c.getContext('2d').fillRect(0, 0, 320, 240);
    c.toBlob((blob) => {
      const r = new FileReader();
      r.onloadend = () => state.client.sendHeartbeat(r.result.split(',')[1]);
      r.readAsDataURL(blob);
    }, 'image/jpeg', 0.7);
  });

  const params = new URLSearchParams(location.search);
  if (params.get('key')) $('apiKey').value = params.get('key');

  updateStats();
  log('Ready. Enter your API key and click Connect.', 'sys');
}

bootIfBrowser().catch((err) => console.error('[Boot]', err));

// ES module exports for stress testing
export { GeminiThrottler, GeminiLiveClient };
