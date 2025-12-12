import type { EventRecord, FeedState } from "@canaria/types";
import { normalizeP2pEvent, normalizeWolfxEvent } from "./normalizers";

interface FeedManagerOptions {
  onEvent: (event: EventRecord) => Promise<void> | void;
  onStatus: (name: "wolfx" | "p2p", state: FeedState) => void;
}

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;
const INACTIVITY_TIMEOUT_MS = 120000;
const PING_INTERVAL_MS = 30000;

export class FeedManager {
  private wolfxConnector: WebSocketConnector;
  private p2pConnector: WebSocketConnector;

  constructor(private readonly options: FeedManagerOptions) {
    this.wolfxConnector = new WebSocketConnector(
      "wolfx",
      "wss://ws-api.wolfx.jp/jma_eew",
      (data) => this.handleWolfxMessage(data),
      (state) => options.onStatus("wolfx", state),
    );

    this.p2pConnector = new WebSocketConnector(
      "p2p",
      "wss://api.p2pquake.net/v2/ws",
      (data) => this.handleP2pMessage(data),
      (state) => options.onStatus("p2p", state),
    );
  }

  startAll(): void {
    this.wolfxConnector.start();
    this.p2pConnector.start();
    this.fetchP2pHistory();
  }

  private async fetchP2pHistory() {
    try {
      const response = await fetch(
        "https://api.p2pquake.net/v2/history?codes=551&codes=552&codes=556&codes=561&limit=100",
      );
      if (!response.ok) return;

      const history = await response.json();
      if (Array.isArray(history)) {
        // Reverse to process oldest to newest
        for (const item of history.reverse()) {
          const event = normalizeP2pEvent(item);
          if (event) {
            await this.options.onEvent(event);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch P2P history:", err);
    }
  }

  getStates(): { wolfx: FeedState; p2p: FeedState } {
    return {
      wolfx: this.wolfxConnector.stateSnapshot(),
      p2p: this.p2pConnector.stateSnapshot(),
    };
  }

  private handleWolfxMessage(data: unknown): void {
    if (
      data &&
      typeof data === "object" &&
      "type" in data &&
      data.type === "heartbeat"
    ) {
      this.wolfxConnector.send({ type: "pong", ts: Date.now() });
      // Message handler already updates lastHeartbeat via lastMessage
      return;
    }

    const event = normalizeWolfxEvent(data);
    if (event) {
      this.options.onEvent(event);
    }
  }

  private handleP2pMessage(data: unknown): void {
    if (!data) return;

    // Filter: Only allow specific codes
    // 551: Earthquake Information
    // 552: Tsunami Forecast
    // 556: EEW (Warning)
    // 561: User Earthquake Perception
    // 561: User Earthquake Perception
    const ALLOWED_CODES = [551, 552, 556, 561];
    if (
      typeof data === "object" &&
      "code" in data &&
      typeof data.code === "number" &&
      !ALLOWED_CODES.includes(data.code)
    )
      return;

    const event = normalizeP2pEvent(data);
    if (event) {
      this.options.onEvent(event);
    }
  }
}

class WebSocketConnector {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = BASE_BACKOFF_MS;
  private state: FeedState = {
    status: "connecting",
    lastMessage: null,
    lastError: null,
    connectedAt: null,
    disconnectedAt: null,
    reconnectCount: 0,
    totalUptime: 0,
    lastHeartbeat: null,
  };

  constructor(
    readonly _name: "wolfx" | "p2p",
    private readonly url: string,
    private readonly onMessage: (data: unknown) => void,
    private readonly onStateChange: (state: FeedState) => void,
  ) {}

  start(): void {
    if (this.state.status === "connected") return;
    this.connect();
  }

  stateSnapshot(): FeedState {
    return { ...this.state };
  }

  send(payload: unknown): void {
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (_error) {
      this.handleClose("send_error");
    }
  }

  private connect(): void {
    try {
      this.updateState({ status: "connecting" });

      const ws = new WebSocket(this.url);
      this.socket = ws;

      ws.addEventListener("open", () => {
        this.backoff = BASE_BACKOFF_MS;
        const now = new Date().toISOString();
        const updates: Partial<FeedState> = {
          status: "connected",
          lastError: null,
          connectedAt: now,
          lastHeartbeat: now,
        };
        // Only increment reconnect count if we had a previous disconnection
        if (this.state.disconnectedAt) {
          updates.reconnectCount = this.state.reconnectCount + 1;
        }
        this.updateState(updates);
        this.armPing();
        this.resetInactivityTimer();
      });

      ws.addEventListener("message", (event) => {
        const now = new Date().toISOString();
        this.updateState({
          lastMessage: now,
          lastHeartbeat: now,
          lastError: null,
        });
        this.resetInactivityTimer();
        try {
          const data = safeJson(event.data);
          this.onMessage(data);
        } catch (_error) {
          this.updateState({ lastError: "invalid_message" });
        }
      });

      ws.addEventListener("close", () => this.handleClose("closed"));
      ws.addEventListener("error", () => this.handleClose("error"));
    } catch (error) {
      this.updateState({
        status: "disconnected",
        lastError: stringifyError(error),
      });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleClose(reason: string): void {
    // Calculate uptime for this session if we were connected
    if (this.state.connectedAt && this.state.status === "connected") {
      const sessionUptime =
        Date.now() - new Date(this.state.connectedAt).getTime();
      this.state.totalUptime += sessionUptime;
    }

    this.cleanupSocket();
    this.updateState({
      status: "disconnected",
      lastError: reason,
      disconnectedAt: new Date().toISOString(),
    });
    this.scheduleReconnect();
  }

  private cleanupSocket(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
    }
    this.socket = null;
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      this.updateState({ lastError: "inactivity_timeout" });
      this.handleClose("inactivity");
    }, INACTIVITY_TIMEOUT_MS);
  }

  private armPing(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      try {
        this.send({ type: "ping", ts: Date.now() });
      } catch {}
    }, PING_INTERVAL_MS);
  }

  private updateState(partial: Partial<FeedState>): void {
    this.state = { ...this.state, ...partial };
    this.onStateChange(this.state);
  }
}

function safeJson(value: unknown): unknown {
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
