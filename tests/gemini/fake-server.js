/**
 * Hostile server simulator for GeminiLiveClient stress tests.
 * Mimics the WebSocket API surface used by app/gemini-client.js so that
 * we can drive the client with fake timers and scriptable failures.
 *
 * IMPORTANT: gemini-client.js hardcodes `new WebSocket(url)` in connect().
 * We patch globalThis.WebSocket in each spec to inject this factory.
 */

export class FakeSocket {
  readyState = 0; // 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  sent = [];
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;

  constructor(server) {
    this.server = server;
  }

  // --- Client-facing (subset of WebSocket API the client touches) ---
  send(raw) {
    if (this.readyState !== 1) return; // mirror real WS: throw on closed
    this.sent.push(JSON.parse(raw));
    this.server._onClientMessage(this, this.sent[this.sent.length - 1]);
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.onclose) this.onclose({ reason: 'client-close' });
  }

  // --- Test-facing controls ---
  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }

  emit(obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
  }

  emitRaw(text) {
    if (this.onmessage) this.onmessage({ data: text });
  }

  drop(reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.onclose) this.onclose({ reason });
  }

  error() {
    if (this.onerror) this.onerror(new Error('fake-error'));
    this.drop('error');
  }
}

export class FakeGeminiServer {
  sockets = [];
  handshakes = 0;
  heartbeatsReceived = 0;
  overlaps = 0;

  constructor(script = {}) {
    this.script = {
      setupDelayMs: 0,
      responseLatencyMs: 0,
      sessionLifetimeMs: 0,
      failFirstNHandshakes: 0,
      ...script,
    };
  }

  inject() {
    const server = this;
    function FakeWebSocket(url) {
      const live = server.sockets.filter((s) => s.readyState === 1).length;
      if (live > 0) server.overlaps += 1;
      const sock = new FakeSocket(server);
      sock.url = url;
      server.sockets.push(sock);
      queueMicrotask(() => server._handshake(sock));
      return sock;
    }
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;
    return FakeWebSocket;
  }

  _handshake(sock) {
    this.handshakes += 1;
    if (this.handshakes <= (this.script.failFirstNHandshakes || 0)) {
      sock.error();
      return;
    }
    sock.open();
    if (this.script.setupDelayMs > 0) {
      setTimeout(() => sock.emit({ setupComplete: {} }), this.script.setupDelayMs);
    } else {
      sock.emit({ setupComplete: {} });
    }
    if (this.script.sessionLifetimeMs > 0) {
      setTimeout(() => {
        if (sock.readyState === 1) sock.drop('session-expired');
      }, this.script.sessionLifetimeMs);
    }
  }

  _onClientMessage(sock, msg) {
    const beat = msg?.clientContent?.turns?.[0]?.parts?.some((p) => p.inlineData);
    if (!beat) return;
    this.heartbeatsReceived += 1;
    const respond = () => {
      if (this.script.onHeartbeat) this.script.onHeartbeat(sock);
    };
    if (this.script.responseLatencyMs > 0) {
      setTimeout(respond, this.script.responseLatencyMs);
    } else {
      respond();
    }
  }

  static toolCall(name, args = {}) {
    return { toolCall: { functionCalls: [{ id: `fc_${Math.random().toString(36).slice(2, 8)}`, name, args }] } };
  }

  flood(sock, n) {
    for (let i = 0; i < n; i += 1) {
      sock.emit(FakeGeminiServer.toolCall('trigger_gesture', { gesture: 'peace_sign', hand: 'right' }));
    }
  }
}
