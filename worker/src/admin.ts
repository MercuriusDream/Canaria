import { ConfigManager } from "./config";
import { EventStore } from "./storage";
import { MetricsCollector } from "./metrics";
import { RateLimiter } from "./ratelimit";
import { AdminDashboardResponse, AdminActionRequest, AdminActionResponse, Heartbeat, FeedState } from "./types";

type SqlDatabase = {
  exec: (statement: string, params?: unknown[]) => unknown;
  prepare: (statement: string) => {
    run: (...params: unknown[]) => { changes?: number } | void;
    first: (...params: unknown[]) => Record<string, unknown> | null | undefined;
    all: (...params: unknown[]) => Record<string, unknown>[];
  };
};

export class AdminHandler {
  private config: ConfigManager;
  private store: EventStore;
  private metrics: MetricsCollector;
  private rateLimiter: RateLimiter;
  private db: SqlDatabase;
  private startTime: number;

  constructor(config: ConfigManager, store: EventStore, metrics: MetricsCollector, rateLimiter: RateLimiter, startTime: number) {
    this.config = config;
    this.store = store;
    this.metrics = metrics;
    this.rateLimiter = rateLimiter;
    this.db = store.getDatabase();
    this.startTime = startTime;
  }

  getDashboard(parserHeartbeat: Heartbeat | null, feedStates: { wolfx: FeedState; p2p: FeedState }, clientsConnected: number): AdminDashboardResponse {
    const currentConfig = this.config.get();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const heartbeatAge = getHeartbeatAge(parserHeartbeat);

    const totalEvents = this.store.count();
    const kmaEvents = this.store.countBySource("KMA");
    const jmaEvents = this.store.countBySource("JMA");
    const recentEvents = this.store.list({ limit: 20 });
    const oldestEvent = this.store.getOldestEvent();

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    const recentEventCount = this.db
      .prepare("SELECT COUNT(*) as c FROM events WHERE CAST((julianday(time) - 2440587.5) * 86400.0 AS INTEGER) >= ?")
      .first(fiveMinutesAgo);
    const eventsPerMinute = recentEventCount && typeof recentEventCount.c === "number" ? recentEventCount.c / 5 : 0;

    const wsHistory = this.db.prepare("SELECT timestamp, count FROM ws_client_history ORDER BY timestamp DESC LIMIT 60").all();
    const clientHistory = wsHistory.map((row) => ({
      timestamp: new Date((row.timestamp as number) * 1000).toISOString(),
      count: typeof row.count === "number" ? row.count : 0,
    }));

    const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - 86400;
    const wolfxEvents = this.db.prepare("SELECT event FROM feed_events WHERE feed = 'wolfx' AND timestamp >= ?").all(twentyFourHoursAgo);
    const p2pEvents = this.db.prepare("SELECT event FROM feed_events WHERE feed = 'p2p' AND timestamp >= ?").all(twentyFourHoursAgo);

    const wolfxReconnects = wolfxEvents.filter((e) => e.event === "connected").length;
    const p2pReconnects = p2pEvents.filter((e) => e.event === "connected").length;

    const wolfxConnectedTime = calculateUptime(wolfxEvents.map((e) => String(e.event)));
    const p2pConnectedTime = calculateUptime(p2pEvents.map((e) => String(e.event)));

    const topIPs = this.rateLimiter.getTopIPs(10);
    const blockedCount = this.db.prepare("SELECT COUNT(*) as c FROM request_logs WHERE status = 429").first();
    const totalBlocked = blockedCount && typeof blockedCount.c === "number" ? blockedCount.c : 0;

    const tableStats = this.store.getTableStats();

    const lastRollup = this.metrics.getLastRollup();
    const lastCleanup = this.metrics.getLastCleanup();
    const nextCleanup = lastCleanup + this.config.getCleanupIntervalMs();

    return {
      system: {
        uptime,
        currentTime: new Date().toISOString(),
        version: "1.0.0",
        nextCleanup: new Date(nextCleanup).toISOString(),
        lastRollup: lastRollup > 0 ? new Date(lastRollup).toISOString() : "Never",
      },
      events: {
        total: totalEvents,
        bySource: { KMA: kmaEvents, JMA: jmaEvents },
        recent: recentEvents,
        perMinute: eventsPerMinute,
        oldestEvent: oldestEvent ? oldestEvent.time : null,
      },
      parser: {
        alive: heartbeatAge < this.config.getParserTimeoutSeconds(),
        lastHeartbeat: parserHeartbeat ? parserHeartbeat.lastParseTime : null,
        heartbeatAgeSeconds: heartbeatAge,
        lastError: parserHeartbeat?.error || null,
      },
      feeds: {
        wolfx: {
          status: feedStates.wolfx.status,
          lastMessage: feedStates.wolfx.lastMessage,
          lastError: feedStates.wolfx.lastError,
          uptimePercent: wolfxConnectedTime,
          reconnectCount: wolfxReconnects,
        },
        p2p: {
          status: feedStates.p2p.status,
          lastMessage: feedStates.p2p.lastMessage,
          lastError: feedStates.p2p.lastError,
          uptimePercent: p2pConnectedTime,
          reconnectCount: p2pReconnects,
        },
      },
      clients: {
        websocketCount: clientsConnected,
        history: clientHistory,
      },
      ratelimit: {
        topIPs,
        totalBlocked,
      },
      database: {
        eventCount: totalEvents,
        estimatedSizeKB: estimateDatabaseSize(tableStats),
        tableStats,
      },
      config: {
        metrics: {
          rollupInterval: currentConfig.metrics.rollupInterval,
          retentionDays: currentConfig.metrics.retentionDays,
          rollupRetentionDays: currentConfig.metrics.rollupRetentionDays,
        },
        rateLimit: {
          enabled: currentConfig.rateLimit.enabled,
        },
        monitoring: {
          parserTimeoutSeconds: currentConfig.monitoring.parserTimeoutSeconds,
          feedTimeoutSeconds: currentConfig.monitoring.feedTimeoutSeconds,
        },
      },
    };
  }

  handleAction(action: AdminActionRequest, feedManager?: any): AdminActionResponse {
    try {
      switch (action.action) {
        case "reconnect_feed":
          if (!action.params?.feed) return { success: false, message: "Feed parameter required" };
          if (feedManager && typeof feedManager.reconnect === "function") {
            feedManager.reconnect(action.params.feed);
            return { success: true, message: `Reconnecting ${action.params.feed} feed` };
          }
          return { success: false, message: "Feed manager not available" };

        case "clear_old_events":
          const daysOld = action.params?.daysOld || 30;
          const deleted = this.store.deleteOldEvents(daysOld);
          return { success: true, message: `Deleted ${deleted} events older than ${daysOld} days`, result: { deleted } };

        case "reset_ratelimit":
          if (!action.params?.ip) return { success: false, message: "IP parameter required" };
          this.rateLimiter.reset(action.params.ip);
          return { success: true, message: `Reset rate limit for IP ${action.params.ip}` };

        case "trigger_rollup":
          this.metrics.performRollup();
          return { success: true, message: "Metrics rollup triggered" };

        case "cleanup_now":
          this.metrics.performCleanup();
          this.rateLimiter.cleanup();
          return { success: true, message: "Cleanup completed" };

        default:
          return { success: false, message: "Unknown action" };
      }
    } catch (error) {
      return { success: false, message: `Action failed: ${error}` };
    }
  }
}



function getHeartbeatAge(parserHeartbeat: Heartbeat | null): number {
  if (!parserHeartbeat) return Infinity;
  try {
    return Math.floor((Date.now() - new Date(parserHeartbeat.lastParseTime).getTime()) / 1000);
  } catch {
    return Infinity;
  }
}

function calculateUptime(events: string[]): number {
  const connectedCount = events.filter((e) => e === "connected").length;
  const disconnectedCount = events.filter((e) => e === "disconnected").length;

  if (connectedCount === 0 && disconnectedCount === 0) return 100;

  const totalEvents = connectedCount + disconnectedCount;
  if (totalEvents === 0) return 100;

  return Math.round((connectedCount / totalEvents) * 100);
}

function estimateDatabaseSize(tableStats: { events: number; metrics_rollup: number; request_logs: number; rate_limits: number }): number {
  const eventsSize = tableStats.events * 0.5;
  const metricsSize = tableStats.metrics_rollup * 0.2;
  const logsSize = tableStats.request_logs * 0.15;
  const rateLimitsSize = tableStats.rate_limits * 0.1;

  return Math.round(eventsSize + metricsSize + logsSize + rateLimitsSize);
}
