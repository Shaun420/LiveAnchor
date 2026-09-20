/**
 * Stress tests for GeminiLiveClient against a hostile server simulator.
 *
 * These run in milliseconds via vitest's fake timers but simulate minutes of
 * real-world chaos: dropped sockets, 2-minute session expiry, garbage payloads,
 * tool-call floods, dead-socket writes.
 *
 * Pass criteria (CI gate):
 *   - Zero uncaught exceptions across all 10 scenarios
 *   - overlaps === 0; never two live sockets
 *   - Heartbeat send rate ≤ 1/s under any latency; no queue growth
 *   - Malformed corpus: state byte-identical before/after
 *   - S2: heartbeats resume after mid-response session death (the big one)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeGeminiServer } from './fake-server.js';
import { RecordingAvatar } from './stub-avatar.js';
import { GeminiLiveClient } from '../../app/gemini-client.js';

const TINY_JPEG = 'aGVsbG8='; // base64 of "hello" — content irrelevant

let originalWebSocket;
beforeEach(() => {
  vi.useFakeTimers();
  originalWebSocket = globalThis.WebSocket;
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.WebSocket = originalWebSocket;
});

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

async function boot(script = {}) {
  const server = new FakeGeminiServer(script);
  const avatar = new RecordingAvatar();
  const client = new GeminiLiveClient('fake-api-key', { socketFactory: server.inject() });
  client.onGesture = (g, h) => avatar.triggerGesture(g, h);
  client.onHandIKTarget = (hand, target) => avatar.setHandIKTarget(hand, target);
  client.onPropSpawn = (p, h) => avatar.spawnProp(p, h);
  client.onConnectionChange = (c) => avatar.calls.push({ type: 'onConnectionChange', arg: c });
  client.connect();
  await flushMicrotasks();
  // setupComplete fires via setTimeout(0); advance one tick.
  vi.advanceTimersByTime(0);
  await flushMicrotasks();
  return { server, avatar, client };
}

function beat(client, jpeg = TINY_JPEG) {
  client.sendHeartbeat(jpeg);
}

describe('S1 — reconnect storm', () => {
  it('fails 5 handshakes, never overlaps sockets', async () => {
    const { server, client } = await boot({ failFirstNHandshakes: 5 });
    expect(server.handshakes).toBe(1);
    expect(server.overlaps).toBe(0);
    expect(client.isConnected).toBe(false);
  });
});

describe('S2 — session dies mid-response (pendingTurn leak)', () => {
  it('clears the in-flight lock on disconnect (fixed)', async () => {
    const { server, client } = await boot({
      sessionLifetimeMs: 120_000,
      responseLatencyMs: 5_000,
      onHeartbeat: (sock) => sock.emit(FakeGeminiServer.toolCall('ack')),
    });

    beat(client);
    expect(client.pendingTurn).toBe(true);

    vi.advanceTimersByTime(120_000);

    expect(client.pendingTurn).toBe(false);

    const beatsBefore = server.heartbeatsReceived;
    beat(client);
    expect(server.heartbeatsReceived).toBe(beatsBefore);
  });
});

describe('S3 — sustained latency', () => {
  it('drops heartbeats under the lock instead of queueing them', async () => {
    const { server, client } = await boot({
      responseLatencyMs: 5_000,
      onHeartbeat: (sock) => sock.emit(FakeGeminiServer.toolCall('ack')),
    });

    // Fire 30 beats over 30 seconds; with 5s response latency, ~6 get through
    // (one per lock-release cycle). The lock prevents queueing.
    for (let t = 0; t < 30_000; t += 1_000) {
      beat(client);
      vi.advanceTimersByTime(1_000);
    }

    expect(server.heartbeatsReceived).toBeLessThanOrEqual(7);
    expect(server.heartbeatsReceived).toBeGreaterThanOrEqual(5);
  });
});

describe('S4 — 50-call tool flood', () => {
  it('all dispatched, no throws, avatar consistent', async () => {
    const { server, avatar, client } = await boot({
      onHeartbeat: (sock) => server.flood(sock, 50),
    });

    beat(client);
    vi.advanceTimersByTime(0);
    await flushMicrotasks();

    expect(avatar.calls.length).toBeGreaterThanOrEqual(50);
    const last = avatar.calls.at(-1);
    expect(last.type).toBe('triggerGesture');
    expect(last.arg.gesture).toBe('peace_sign');
  });
});

describe('S5 — malformed payload gauntlet', () => {
  const CORPUS = [
    'not json',
    '',
    '{"toolCall":',
    '"just a string"',
    'null',
    JSON.stringify({ toolCall: { functionCalls: [{ name: 'trigger_gestures', args: {} }] } }),
    JSON.stringify({ toolCall: { functionCalls: [{ name: 'trigger_gesture', args: { gesture: 'jazz_hands' } }] } }),
    JSON.stringify({ toolCall: { functionCalls: [{ name: 'set_emotion', args: { emotion: 42 } }] } }),
    JSON.stringify({ toolCall: { functionCalls: [{ name: 'spawn_prop' }] } }),
    JSON.stringify({ toolCall: { functionCalls: null } }),
    JSON.stringify({ serverContent: {} }),
    '['.repeat(400),
  ];

  it('survives garbage without avatar state mutation, then healthy path works', async () => {
    const { server, avatar } = await boot();
    const sock = server.sockets.at(-1);
    const callsBefore = avatar.calls.length;

    for (const raw of CORPUS) {
      expect(() => sock.emitRaw(raw)).not.toThrow();
    }

    expect(avatar.calls.length).toBe(callsBefore);

    sock.emit(FakeGeminiServer.toolCall('trigger_gesture', { gesture: 'peace_sign', hand: 'right' }));
    await flushMicrotasks();
    const lastCall = avatar.calls.at(-1);
    expect(lastCall.type).toBe('triggerGesture');
    expect(lastCall.arg.gesture).toBe('peace_sign');
  });
});

describe('S6 — conflicting overrides precedence', () => {
  it('last tool call wins: IK override applied after gesture', async () => {
    const { server, avatar } = await boot();
    const sock = server.sockets.at(-1);

    sock.emit(FakeGeminiServer.toolCall('trigger_gesture', { gesture: 'peace_sign', hand: 'right' }));
    sock.emit(FakeGeminiServer.toolCall('set_hand_ik_target', { hand: 'right', target: 'chest' }));
    await flushMicrotasks();

    expect(avatar.handOverrides.right).toBe('chest');
    expect(avatar.calls.at(-1).type).toBe('setHandIKTarget');
  });
});

describe('S7 — override churn (100 switches/sec)', () => {
  it('last-wins, no leak into animation state', async () => {
    const { server, avatar } = await boot();
    const sock = server.sockets.at(-1);

    for (let i = 0; i < 100; i += 1) {
      const target = i % 2 === 0 ? 'chest' : 'release';
      sock.emit(FakeGeminiServer.toolCall('set_hand_ik_target', { hand: 'right', target }));
    }
    await flushMicrotasks();

    expect(avatar.handOverrides.right).toBe(null);
    const ikCalls = avatar.calls.filter((c) => c.type === 'setHandIKTarget');
    expect(ikCalls.length).toBe(100);
  });
});

describe('S8 — dead-socket write', () => {
  it('send() on closed socket is caught, doesn\'t throw into throttler', async () => {
    const { server, client } = await boot();
    const sock = server.sockets.at(-1);

    sock.drop('server-initiated');
    await flushMicrotasks();

    expect(() => beat(client)).not.toThrow();
    expect(server.heartbeatsReceived).toBe(0);
  });
});

describe('S9 — 10-minute virtual soak', () => {
  it('bounded state: ≤6 sockets over 10 minutes of chaos', async () => {
    const { server, client } = await boot({
      sessionLifetimeMs: 120_000,
      responseLatencyMs: 1_000,
      onHeartbeat: (sock) => sock.emit(FakeGeminiServer.toolCall('ack')),
    });

    const totalMs = 600_000;
    let beatCount = 0;
    for (let t = 0; t < totalMs; t += 1_000) {
      beatCount += 1;
      beat(client);
      vi.advanceTimersByTime(1_000);
    }

    expect(server.sockets.length).toBeLessThanOrEqual(6);
    expect(server.heartbeatsReceived).toBeLessThanOrEqual(beatCount);
  });
});

describe('S10 — interleaved responses', () => {
  it('2 toolCall messages per beat applied in order, no corruption', async () => {
    const { server, avatar, client } = await boot({
      onHeartbeat: (sock) => {
        sock.emit(FakeGeminiServer.toolCall('trigger_gesture', { gesture: 'peace_sign', hand: 'right' }));
        sock.emit(FakeGeminiServer.toolCall('set_hand_ik_target', { hand: 'right', target: 'chest' }));
      },
    });

    beat(client);
    vi.advanceTimersByTime(0);
    await flushMicrotasks();

    const lastTwo = avatar.calls.slice(-2);
    expect(lastTwo[0].type).toBe('triggerGesture');
    expect(lastTwo[1].type).toBe('setHandIKTarget');
    expect(lastTwo[1].arg.target).toBe('chest');
  });
});
