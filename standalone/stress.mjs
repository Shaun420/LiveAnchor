/**
 * Stress harness for the standalone GeminiLiveClient.
 * Mirrors tests/gemini/fake-server.js from LiveAnchor.
 * Usage: node stress.mjs <api-key>
 */

import { GeminiLiveClient } from './app.js';

class FakeSocket {
  constructor(server) {
    this.server = server;
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }
  send(raw) {
    if (this.readyState !== 1) return;
    this.sent.push(JSON.parse(raw));
    this.server._onClientMessage(this, this.sent[this.sent.length - 1]);
  }
  close() { this.readyState = 3; if (this.onclose) this.onclose({ reason: 'client' }); }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  emit(o) { if (this.onmessage) this.onmessage({ data: JSON.stringify(o) }); }
  drop() { this.readyState = 3; if (this.onclose) this.onclose({ reason: 'drop' }); }
}

class FakeServer {
  constructor() {
    this.sockets = [];
    this.handshakes = 0;
    this.heartbeatsReceived = 0;
  }
  factory() {
    const server = this;
    return function FakeWS(url) {
      const sock = new FakeSocket(server);
      sock.url = url;
      server.sockets.push(sock);
      queueMicrotask(() => server._handshake(sock));
      return sock;
    };
  }
  _handshake(sock) {
    this.handshakes += 1;
    sock.open();
    setTimeout(() => sock.emit({ setupComplete: {} }), 0);
  }
  _onClientMessage(sock, msg) {
    const beat = msg?.clientContent?.turns?.[0]?.parts?.some((p) => p.inlineData);
    if (beat) this.heartbeatsReceived += 1;
  }
}

const server = new FakeServer();
const client = new GeminiLiveClient('fake-key', { socketFactory: server.factory() });
client.connect();

await new Promise((r) => setTimeout(r, 50));

console.log(`Handshakes: ${server.handshakes}, Sockets: ${server.sockets.length}`);
console.log(`Setup sent: ${server.sockets[0].sent.length > 0 ? '✓' : '✗'}`);

// Send 10 heartbeats
for (let i = 0; i < 10; i += 1) {
  client.sendHeartbeat('AAAA');
}
await new Promise((r) => setTimeout(r, 10));
console.log(`Heartbeats received: ${server.heartbeatsReceived} (expected 1 due to pendingTurn lock)`);

// Fire tool call
server.sockets[0].emit({
  toolCall: {
    functionCalls: [
      { id: '1', name: 'trigger_gesture', args: { gesture: 'peace_sign', hand: 'right' } },
      { id: '2', name: 'trigger_gestures', args: {} }, // typo
    ],
  },
});
await new Promise((r) => setTimeout(r, 10));
console.log(`Tool responses sent: ${server.sockets[0].sent.filter((m) => m.toolResponse).length}`);

// Verify typo'd tool was rejected
const lastResponse = server.sockets[0].sent.filter((m) => m.toolResponse).pop();
console.log(`Last tool response:`, JSON.stringify(lastResponse, null, 2));
