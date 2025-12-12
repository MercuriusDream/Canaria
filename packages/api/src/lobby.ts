export class Lobby {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, any>;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.sessions = new Map();
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/websocket")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.handleSession(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Lobby DO", { status: 200 });
  }

  handleSession(webSocket: WebSocket) {
    webSocket.accept();

    // Create a random ID for this peer
    const peerId = crypto.randomUUID();
    this.sessions.set(webSocket, { peerId });

    webSocket.addEventListener("message", async (msg) => {
      try {
        const data = JSON.parse(msg.data as string);

        switch (data.type) {
          case "list-peers": {
            // Return a random subset of peers (random walk)
            const peers = Array.from(this.sessions.values())
              .filter((p) => p.peerId !== peerId)
              .map((p) => p.peerId);

            // Shuffle and slice
            const randomPeers = peers
              .sort(() => 0.5 - Math.random())
              .slice(0, 5);

            webSocket.send(
              JSON.stringify({
                type: "peer-list",
                peers: randomPeers,
              }),
            );
            break;
          }
          case "signal": {
            // Forward signaling message to specific peer
            const targetPeerId = data.target;
            const payload = data.payload;

            for (const [ws, session] of this.sessions.entries()) {
              if (session.peerId === targetPeerId) {
                ws.send(
                  JSON.stringify({
                    type: "signal",
                    source: peerId,
                    payload,
                  }),
                );
                break;
              }
            }
            break;
          }
        }
      } catch (err) {
        // Ignore malformed
      }
    });

    webSocket.addEventListener("close", () => {
      this.sessions.delete(webSocket);
    });
  }
}
