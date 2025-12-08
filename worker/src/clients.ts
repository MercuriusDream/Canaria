export class ClientHub {
  private readonly clients = new Set<WebSocket>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private totalConnections = 0;

  constructor(private readonly pingIntervalMs: number) {}

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
      } catch (error) {
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
