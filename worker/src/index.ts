import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { html } from "@elysiajs/html";
import { ClientHub } from "./clients";
import { SqliteAdapter } from "./adapter";
import { FeedManager } from "./feeds";
import { API_DOCS_HTML } from "./docs";
import { EventStore } from "./storage";
import { EventRecord, Heartbeat, ListQuery, AdminActionRequest } from "./types";
import { IngestPayloadSchema } from "./schemas";

import { ConfigManager, Config } from "./config";
import { RateLimiter } from "./ratelimit";
import { MetricsCollector } from "./metrics";
import { HealthMonitor } from "./monitoring";
import { AdminHandler } from "./admin";

interface Env {
  CANARIA_DO: DurableObjectNamespace;
  ADMIN_SECRET?: string;
  METRICS_ROLLUP_INTERVAL?: string;
  METRICS_RETENTION_DAYS?: string;
  ROLLUP_RETENTION_DAYS?: string;
  RATE_LIMIT_ENABLED?: string;
}

// --- Worker Entry Point (Elysia) ---
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.CANARIA_DO.idFromName("singleton");
    const stub = env.CANARIA_DO.get(id);
    return stub.fetch(request);
  },
};

// --- Durable Object (Elysia Internal) ---
export class CanariaSqlDurableObject {
  private readonly store: EventStore;
  private readonly clients = new ClientHub(60_000);
  private readonly feedManager: FeedManager;
  private readonly config: ConfigManager;
  private readonly rateLimiter: RateLimiter;
  private readonly metrics: MetricsCollector;
  private readonly healthMonitor: HealthMonitor;
  private readonly adminHandler: AdminHandler;

  // State
  private parserHeartbeat: Heartbeat | null = null;
  private feedStates = {
    wolfx: {
      status: "connecting" as const,
      lastMessage: null,
      lastError: null,
      connectedAt: null,
      disconnectedAt: null,
      reconnectCount: 0,
      totalUptime: 0,
      lastHeartbeat: null,
    },
    p2p: {
      status: "connecting" as const,
      lastMessage: null,
      lastError: null,
      connectedAt: null,
      disconnectedAt: null,
      reconnectCount: 0,
      totalUptime: 0,
      lastHeartbeat: null,
    },
  };

  private feedsStarted = false;
  private lastStoredAt: string | null = null;
  private lastRollupCheck: number = 0;
  private parserErrorHistory: Array<{ timestamp: string; error: string }> = [];
  private readonly MAX_PARSER_ERRORS = 10;
  private startTime: number = Date.now();
  private needsKmaSync: boolean = true;

  // The Inner Elysia App
  private app: any;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    const rawDb = this.state.storage.sql;
    const db = new SqliteAdapter(rawDb);
    this.store = new EventStore(db);

    const envVars = {
      METRICS_ROLLUP_INTERVAL: env.METRICS_ROLLUP_INTERVAL,
      METRICS_RETENTION_DAYS: env.METRICS_RETENTION_DAYS,
      ROLLUP_RETENTION_DAYS: env.ROLLUP_RETENTION_DAYS,
      RATE_LIMIT_ENABLED: env.RATE_LIMIT_ENABLED,
    };

    this.config = new ConfigManager(db, envVars);
    this.rateLimiter = new RateLimiter(db, this.config);
    this.metrics = new MetricsCollector(db, this.config);
    this.healthMonitor = new HealthMonitor(this.config);
    this.adminHandler = new AdminHandler(this.config, this.store, this.metrics, this.rateLimiter, this.startTime);

    this.feedManager = new FeedManager({
      onEvent: (ev) => this.handleIncomingEvents([ev]),
      onStatus: (name, state) => {
        // @ts-ignore - dynamic key assignment matching the structure
        this.feedStates = { ...this.feedStates, [name]: state };
        this.metrics.recordFeedEvent(name, state.status, state.lastError || state.lastMessage || "");
      },
    });

    // Initialize Elysia App
    this.app = new Elysia({ aot: false })
      .use(cors())
      .use(swagger({
        documentation: {
          info: {
            title: 'Canaria API',
            version: '1.0.0'
          }
        }
      }))
      .use(html())

      // Global Tasks & Updates
      .onRequest(({ request }) => {
        this.ensureFeeds();
        this.performPeriodicTasks();
      })

      // Rate Limiting Middleware
      .onBeforeHandle(({ request, set }: { request: Request; set: any }) => {
        const url = new URL(request.url);
        const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
        const userAgent = request.headers.get("User-Agent") || "";

        // Skip rate limit for websockets upgrade initiation
        if (request.headers.get("Upgrade") === "websocket") return;

        const endpoint = `${request.method} ${url.pathname}`;
        const limitRes = this.rateLimiter.check(ip, endpoint);

        if (!limitRes.allowed) {
          set.status = 429;
          set.headers["X-RateLimit-Limit"] = String(limitRes.limit);
          set.headers["X-RateLimit-Remaining"] = String(limitRes.remaining);
          set.headers["X-RateLimit-Reset"] = String(limitRes.resetAt);
          set.headers["Retry-After"] = String(limitRes.resetAt - Math.floor(Date.now() / 1000));

          this.metrics.logRequest(url.pathname, request.method, 429, 0, ip, userAgent);
          return {
            error: "Rate limit exceeded",
            limit: limitRes.limit,
            remaining: limitRes.remaining,
            resetAt: limitRes.resetAt
          };
        }
      })

      // After Handle (Metrics)
      .onAfterHandle(({ request, set }: { request: Request; set: any }) => {
        const url = new URL(request.url);
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const userAgent = request.headers.get("User-Agent") || "";
        const status = set.status || 200;
        const duration = Date.now() - this.startTime; // Approximate per-request handling not tracking duration super precisely here without context-local start time
        // Note: Elysia doesn't easily pass start time to onAfterHandle without a plugin, 
        // so we will just log the request completion. 
        // For precise duration, we'd need a derive.
        this.metrics.logRequest(url.pathname, request.method, typeof status === 'number' ? status : 200, 0, ip, userAgent);
      })

      // Routes
      .get("/api_docs.html", ({ html }) => html(API_DOCS_HTML))

      .group("/v1", (app) => app
        .get("/ws", ({ request, set }: { request: Request; set: any }) => this.handleClientWebSocket(request, set))

        // Ingest
        .post("/events", async ({ body, set }) => {
          const payload = body;

          if (payload.heartbeat) {
            this.parserHeartbeat = payload.heartbeat;
            if (payload.heartbeat.error) {
              this.parserErrorHistory.unshift({
                timestamp: payload.heartbeat.lastParseTime,
                error: payload.heartbeat.error,
              });
              if (this.parserErrorHistory.length > this.MAX_PARSER_ERRORS) {
                this.parserErrorHistory = this.parserErrorHistory.slice(0, this.MAX_PARSER_ERRORS);
              }
            }
          }
          if (payload.events && payload.events.length) {
            // @ts-ignore - Schema validation ensures structural compatibility
            await this.handleIncomingEvents(payload.events);
          }

          if (this.needsKmaSync && payload.heartbeat?.kmaConnection) {
            this.needsKmaSync = false;
            set.status = 200;
            return { sync: true };
          }

          set.status = 204;
          return null;
        }, {
          body: IngestPayloadSchema
        })

        .get("/events/latest", () => {
          const event = this.store.latest();
          if (!event) return new Response(null, { status: 204 });
          return event;
        })

        .get("/events", ({ query }: { query: Record<string, string | undefined> }) => {
          // @ts-ignore
          const q: ListQuery = {
            since: query.since,
            until: query.until,
            source: query.source as any,
            type: query.type,
            limit: query.limit ? parseInt(query.limit as string) : undefined
          };
          const events = this.store.list(q);
          return { events };
        })

        .get("/status", () => {
          const health = this.healthMonitor.checkHealth(this.parserHeartbeat, this.feedStates, this.store);
          return {
            status: health.healthy ? "ok" : "degraded",
            summary: health.healthy ? "All systems operational" : "Some systems are experiencing issues",
            timestamp: new Date().toISOString()
          };
        })

        .get("/connections", () => {
          this.metrics.recordWSClientCount(this.clients.size());
          return this.healthMonitor.getEnhancedStatus(
            this.parserHeartbeat,
            this.feedStates,
            this.store.count(),
            this.clients.size(),
            this.lastStoredAt,
            this.store
          );
        })

        .get("/health", ({ set }: { set: any }) => {
          const health = this.healthMonitor.checkHealth(this.parserHeartbeat, this.feedStates, this.store);
          set.status = health.healthy ? 200 : 503;
          return health;
        })

        .get("/metrics", ({ query, set }: { query: Record<string, string | undefined>; set: any }) => {
          const format = query.format || "prometheus";
          const eventsTotal = { KMA: this.store.countBySource("KMA"), JMA: this.store.countBySource("JMA") };
          const wsClientCount = this.clients.size();
          const heartbeatAge = this.parserHeartbeat
            ? Math.floor((Date.now() - new Date(this.parserHeartbeat.lastParseTime).getTime()) / 1000)
            : Infinity;

          if (format === "json") {
            const data = this.metrics.getJSONMetrics(eventsTotal, wsClientCount, this.feedStates, heartbeatAge);
            return { format: "json", data };
          } else {
            const data = this.metrics.getPrometheusMetrics(eventsTotal, wsClientCount, this.feedStates, heartbeatAge);
            set.headers["Content-Type"] = "text/plain; version=0.0.4";
            return data;
          }
        })

        .get("/metrics/timeseries", ({ query }: { query: Record<string, string | undefined> }) => {
          return {
            metric: query.metric || "unknown",
            interval: query.interval || "1m",
            dataPoints: []
          };
        })

        .get("/monitoring", () => {
          this.metrics.recordWSClientCount(this.clients.size());
          return this.healthMonitor.getDetailedMonitoring(
            this.parserHeartbeat,
            this.feedStates,
            this.store,
            this.clients.size(),
            this.clients.totalConnectionCount(),
            this.lastStoredAt,
            this.startTime,
            this.parserErrorHistory
          );
        })
      )

      .group("/admin", (app) => app
        .onBeforeHandle(({ request, query, set }: { request: Request; query: Record<string, string | undefined>; set: any }) => {
          const adminSecret = this.env.ADMIN_SECRET || "change-this-secret";
          const authHeader = request.headers.get("Authorization");
          const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : query.auth;

          if (token !== adminSecret) {
            set.status = 401;
            return { error: "Unauthorized" };
          }
        })
        .get("/dashboard", () => {
          return this.adminHandler.getDashboard(this.parserHeartbeat, this.feedStates, this.clients.size());
        })
        .get("/config", () => {
          return this.config.get();
        })
        .put("/config", async ({ body }: { body: any }) => {
          // @ts-ignore
          const partial = body as Partial<Config>;
          this.config.update(partial);
          return { success: true, message: "Configuration updated", config: this.config.get() };
        })
        .post("/actions", async ({ body }: { body: any }) => {
          // @ts-ignore
          const action = body as AdminActionRequest;
          return this.adminHandler.handleAction(action, this.feedManager);
        })
      );
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  private ensureFeeds(): void {
    if (this.feedsStarted) return;
    this.feedsStarted = true;
    this.feedManager.startAll();
    this.clients.startPings();
  }

  private async handleIncomingEvents(events: EventRecord[]): Promise<void> {
    if (!events.length) return;
    try {
      const inserted = this.store.insert(events);
      if (inserted > 0) {
        this.lastStoredAt = new Date().toISOString();
        this.clients.broadcast({ events });
      }
    } catch (error) {
      console.error("[worker] Failed to store events", error);
    }
  }

  private handleClientWebSocket(request: Request, set?: any): Response | string {
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
    this.clients.register(server);

    const latest = this.store.latest();
    if (latest) {
      server.send(JSON.stringify({ event: latest }));
    }

    // This is the mandated way to upgrade a websocket in Cloudflare Workers
    // even within Elysia when managing the upgrade manually inside a DO.
    return new Response(null, { status: 101, webSocket: client });
  }

  private performPeriodicTasks(): void {
    const now = Date.now();

    if (this.metrics.shouldRollup()) {
      try {
        this.metrics.performRollup();
      } catch (error) {
        console.error("[worker] Failed to perform rollup", error);
      }
    }

    if (this.metrics.shouldCleanup()) {
      try {
        this.metrics.performCleanup();
        this.rateLimiter.cleanup();
      } catch (error) {
        console.error("[worker] Failed to perform cleanup", error);
      }
    }

    if (now - this.lastRollupCheck > 60_000) {
      this.metrics.recordWSClientCount(this.clients.size());
      this.lastRollupCheck = now;
    }
  }
}
