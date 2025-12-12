import { EventStore } from "./storage";

export class ConnectionManager {
  private readonly clients = new Set<WebSocket>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private totalConnections = 0;

  constructor(
    private readonly pingIntervalMs: number,
    // Optional dependency, only needed if we want to send initial state on connect,
    // but looking at index.ts, it was sending latest event.
    // We can pass it in handleUpgrade if preferable, or here.
    private readonly store?: EventStore
  ) { }

  startPings(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => this.pingAll(), this.pingIntervalMs);
  }

  stopPings(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Elysia Context types
  public handleClientWebSocket(request: Request, set?: any): Response | string {
    if (request.headers.get("Upgrade") !== "websocket") {
      if (set) {
        set.status = 426;
        return "Expected Upgrade: websocket";
      }
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.register(server);

    if (this.store) {
      const latest = this.store.latest();
      if (latest) {
        server.send(JSON.stringify({ event: latest }));
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  register(socket: WebSocket): void {
    this.clients.add(socket);
    this.totalConnections++;
    socket.addEventListener("close", () => this.clients.delete(socket));
    socket.addEventListener("error", () => this.clients.delete(socket));
  }

  broadcast(payload: unknown): void {
    const serialized = JSON.stringify(payload);

    for (const client of Array.from(this.clients)) {
      try {
        client.send(serialized);
      } catch (_error) {
        this.clients.delete(client);
      }
    }
  }

  size(): number {
    return this.clients.size;
  }

  totalConnectionCount(): number {
    return this.totalConnections;
  }

  private pingAll(): void {
    const serialized = JSON.stringify({ type: "ping", ts: Date.now() });

    for (const client of Array.from(this.clients)) {
      try {
        client.send(serialized);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
