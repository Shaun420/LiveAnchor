# Gemini Live API — Standalone

A self-contained, single-page app that connects directly to **Gemini Robotics ER-2 Streaming API** via WebSocket and streams 1 FPS video heartbeats from your webcam. Mirrors the production LiveAnchor AI Director architecture.

## What it does

- Streams 1 FPS JPEG from your webcam → Gemini ER-2
- Receives tool calls: `trigger_gesture`, `set_hand_ik_target`, `spawn_prop`, `ack`
- Shows live event log, stats, and connection status
- Includes a stress harness (`stress.mjs`) that tests the client without hitting the real API

## Why a standalone version?

LiveAnchor's `app/gemini-client.js` is part of a 7-layer VTuber architecture with MediaPipe, Three.js, VRM avatars, and ONNX 3D lifting — lots of moving parts. This standalone app:

- **Strips out the avatar pipeline** so you can see exactly what Gemini is doing
- **No build step** — just open `index.html` or serve it
- **Easy to debug** — single file, ~400 lines
- **Same production-grade client code** — same `pendingTurn` lock, same frame deduplication, same tool-call validation

## Quick start

```bash
# Option 1: Just open the file
open index.html
# (Some browsers block getUserMedia on file:// — use Option 2 if so)

# Option 2: Static server
python -m http.server 8000
# Visit http://localhost:8000

# Option 3: Vite/serve
npx serve .
```

Then:
1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Paste it into the input field (or append `?key=YOUR_KEY` to the URL)
3. Click **Connect**
4. Grant camera permission
5. Watch the event log fill up with heartbeats and tool calls

## Architecture

```
[Webcam] ──1 FPS──> [Throttler] ──base64 JPEG──> [GeminiLiveClient]
                          │                              │
                          ▼                              ▼
                   Frame dedup                    pendingTurn lock
                   Aspect crop                    Tool validation
                          │                              │
                          └──────────WebSocket───────────┘
                                         │
                                         ▼
                               [Gemini ER-2 Streaming]
                                         │
                                         ▼
                              toolCall / ack / text
```

## Stress harness

The `stress.mjs` script tests the client against a fake server — no API key needed, no network calls. Useful for verifying behavior after code changes.

```bash
node stress.mjs
```

Expected output:
```
Handshakes: 1, Sockets: 1
Setup sent: ✓
Heartbeats received: 1 (expected 1 due to pendingTurn lock)
Tool responses sent: 1
Last tool response: { toolResponse: { functionResponses: [
  { name: 'trigger_gesture', id: '1', response: { status: 'success' } },
  { name: 'trigger_gestures', id: '2', response: { error: 'unknown or unsupported tool: trigger_gestures' } }
] } }
```

The typo'd tool name (`trigger_gestures` vs `trigger_gesture`) gets rejected with a typed error — same validation that protects against Gemini hallucinations.

## Tool reference

| Tool | When Gemini calls it | Args |
|------|---------------------|------|
| `trigger_gesture` | User makes a clear hand sign | `{ gesture: 'peace_sign' \| 'thumbs_up' \| 'pointing' \| 'open_palm' \| 'rock_on', hand: 'left' \| 'right' \| 'both' }` |
| `set_hand_ik_target` | Hand occluded / behind back / holding object | `{ hand: 'left' \| 'right', target: 'hip' \| 'mouth' \| 'behind_back' \| 'chin' \| 'chest' \| 'release' }` |
| `spawn_prop` | User holding a real object | `{ prop_name: string, hand: 'left' \| 'right' }` |
| `ack` | Hands visible, no override needed | `{ status?: string }` |

## File layout

```
gemini-live-standalone/
├── index.html       # UI + styles (single file, no build)
├── app.js           # GeminiLiveClient + Throttler + boot logic
├── stress.mjs       # Fake-server stress harness (run with `node`)
└── README.md        # You are here
```

## Differences from LiveAnchor

| Aspect | LiveAnchor | Standalone |
|--------|-----------|------------|
| Avatar rendering | Three.js + VRM | None (logs tool calls only) |
| Pose source | MediaPipe BlazePose (face/body/hands) | Just webcam frame |
| File structure | 7 layers, ~30 modules | 2 files, ~450 lines |
| 3D lifting | ONNX MobileHumanPose | None |
| Stress tests | Vitest + FakeServer | `stress.mjs` standalone script |
| Build step | Vite + npm | None (or static server) |

Everything else — the WebSocket client, throttler, tool validation, pendingTurn lock, frame deduplication — is the **same code**, just extracted.
