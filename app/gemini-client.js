// gemini-client.js
// Production-ready WebSocket client for Gemini Robotics ER-2 Streaming API
// Focused purely on Semantic Hand/Gesture Overrides (Local models handle face/emotion)

export class GeminiLiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    this.model = "models/gemini-robotics-er-2-streaming-preview";
    
    this.ws = null;
    this.isConnected = false;
    this.pendingTurn = false;
    this._pendingTimer = null;

    // Callbacks to bridge AI commands to your Three.js app
    // (Emotion and Props removed - handled locally)
    this.onConnectionChange = null; // (isConnected) => void
    this.onGesture = null;          // (gesture, hand) => void — semantic gesture override
    this.onHandIKTarget = null;     // (hand, target) => void — semantic IK anchor override 
    this.onPropSpawn = null;
  }

  connect() {
    console.log("[GeminiClient] Initializing WebSocket (Robotics ER-2)...");
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log("[GeminiClient] WebSocket Connected. Sending setup...");
      this._sendSetupMessage();
    };

    this.ws.onmessage = async (event) => {
      let rawData = event.data;
      
      if (rawData instanceof Blob) {
        rawData = await rawData.text();
      } else if (rawData instanceof ArrayBuffer) {
        rawData = new TextDecoder().decode(rawData);
      }
      
      this._handleMessage(rawData);
    };

    this.ws.onerror = (error) => console.error("[GeminiClient] WebSocket Error:", error);
    
    this.ws.onclose = (event) => {
      console.log("[GeminiClient] WebSocket Closed:", event.reason);
      this.isConnected = false;
      if (this.onConnectionChange) this.onConnectionChange(false);
    };
  }

  _sendSetupMessage() {
    const setupMessage = {
      setup: {
        model: this.model,
        
        generationConfig: {
          responseModalities: ["TEXT"] 
        },
        
        systemInstruction: {
          parts: [{ 
            // Refocused purely on hand occlusion and gestures
            text: "You are the AI tracking supervisor for a 3D VTuber avatar. Local models handle the face and body perfectly, but they struggle with hand occlusions and complex gestures. You receive 1 FPS video heartbeats. Your ONLY goal is to monitor the user's hands. Use the provided tools to trigger perfect gestures or lock hands to IK targets when they are occluded or holding objects. If the hands are visible and moving naturally, call 'ack'." 
          }]
        },
        tools: [{
          functionDeclarations: [
            {
              name: "trigger_gesture",
              description: "Overrides the hand tracking to form a specific, perfect gesture. Use this when the user makes a clear hand sign like peace_sign, thumbs_up, or pointing.",
              behavior: "BLOCKING",
              parameters: {
                type: "OBJECT",
                properties: {
                  gesture: { type: "STRING", enum: ["peace_sign", "thumbs_up", "pointing", "open_palm", "rock_on"] },
                  hand: { type: "STRING", enum: ["left", "right", "both"] }
                },
                required: ["gesture", "hand"]
              }
            },
            {
              name: "set_hand_ik_target",
              description: "Overrides raw hand tracking and locks the hand to a specific body anchor. Use when the hand is occluded, behind the back, or holding an object steadily where finger tracking fails. Use 'release' to return control to the local tracker.",
              behavior: "BLOCKING",
              parameters: {
                type: "OBJECT",
                properties: {
                  hand: { type: "STRING", enum: ["left", "right"] },
                  target: { type: "STRING", enum: ["hip", "mouth", "behind_back", "chin", "chest", "release"] }
                },
                required: ["hand", "target"]
              }
            },
            {
              name: "spawn_prop",
              description: "Spawns a 3D prop in the avatar's hand and switches it to a procedural grip. Call when the user picks up or is steadily holding a real object.",
              behavior: "BLOCKING",
              parameters: {
                type: "OBJECT",
                properties: {
                  prop_name: { type: "STRING" },
                  hand: { type: "STRING", enum: ["left", "right"] }
                },
                required: ["prop_name", "hand"]
              }
            },
            {
              name: "ack",
              description: "Acknowledge the current state. Call this if the user's hands are visible, unoccluded, and no overrides are needed.",
              behavior: "BLOCKING",
              parameters: {
                type: "OBJECT",
                properties: {
                  status: { type: "STRING", description: "Brief status note, e.g., 'Hands visible and tracking normally.'" }
                }
              }
            }
          ]
        }]
      }
    };

    this.ws.send(JSON.stringify(setupMessage));
  }

  // 🫀 THE HEARTBEAT: Sends Image + Text Prompt to trigger reasoning
  sendHeartbeat(base64Jpeg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.pendingTurn) return; 

    this.pendingTurn = true;
    clearTimeout(this._pendingTimer);
    this._pendingTimer = setTimeout(() => { this.pendingTurn = false; }, 6000);

    const heartbeatMessage = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [
              { inlineData: { data: base64Jpeg, mimeType: "image/jpeg" } },
              // Updated prompt: strictly focused on hands/gestures/occlusion
              { text: "[HEARTBEAT] Call exactly one tool. Priority: 1) clear hand sign (peace/thumbs/pointing) → 'trigger_gesture'; 2) hand steadily holding an object → 'spawn_prop' + 'set_hand_ik_target' with 'chest'; 3) hand hidden, behind back, or out of frame → 'set_hand_ik_target' with a body anchor; 4) a previously anchored hand is now visible and free → 'set_hand_ik_target' with 'release'; 5) nothing changed → 'ack'." }
            ]
          }
        ],
        turnComplete: true
      }
    };

    this.ws.send(JSON.stringify(heartbeatMessage));
  }

  _handleMessage(rawData) {
    try {
      const response = JSON.parse(rawData);

      if (response.setupComplete) {
        console.log("[GeminiClient] ✅ Setup complete. ER-2 Live session active!");
        this.isConnected = true;
        if (this.onConnectionChange) this.onConnectionChange(true);
        return;
      }

      if (response.serverContent?.turnComplete || response.serverContent?.interrupted) {
        this.pendingTurn = false;
      }

      if (response.toolCall) {
        this.pendingTurn = false;
        this._handleToolCall(response.toolCall);
        return;
      }

      if (response.serverContent?.modelTurn?.parts) {
        for (const part of response.serverContent.modelTurn.parts) {
          if (part.text) {
            console.log("[Gemini AI Supervisor]:", part.text);
          }
        }
      }
    } catch (err) {
      console.warn("[GeminiClient] Failed to parse message:", rawData, err);
    }
  }

  _handleToolCall(toolCall) {
    const functionResponses = [];

    for (const fc of toolCall.functionCalls) {
      console.log(`[GeminiClient] AI called tool: ${fc.name}`, fc.args);

      let result = { status: "success" };
      try {
        if (fc.name === "trigger_gesture" && this.onGesture) {
          this.onGesture(fc.args.gesture, fc.args.hand);
        }
        else if (fc.name === "set_hand_ik_target" && this.onHandIKTarget) {
          this.onHandIKTarget(fc.args.hand, fc.args.target);
        }
        else if (fc.name === "spawn_prop" && this.onPropSpawn) {
          this.onPropSpawn(fc.args.prop_name, fc.args.hand);
        }
        else if (fc.name === "ack") {
          // Do nothing, just acknowledge
        }
      } catch (e) {
        console.error(`Error executing tool ${fc.name}:`, e);
        result = { error: e.message };
      }

      functionResponses.push({
        name: fc.name,
        id: fc.id,
        response: result
      });
    }

    const toolResponseMessage = {
      toolResponse: {
        functionResponses: functionResponses
      }
    };

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(toolResponseMessage));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    clearTimeout(this._pendingTimer);
    if (this.onConnectionChange) this.onConnectionChange(false);
    console.log("[GeminiClient] Disconnected.");
  }
}