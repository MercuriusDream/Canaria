import type { FeedState, MetricsJSONFormat } from "@canaria/types";
import type { ConfigManager } from "./config";

type SqlDatabase = {
  exec: (statement: string, params?: unknown[]) => unknown;
  prepare: (statement: string) => {
    run: (...params: unknown[]) => { changes?: number } | undefined;
    first: (...params: unknown[]) => Record<string, unknown> | null | undefined;
    all: (...params: unknown[]) => Record<string, unknown>[];
  };
};

export class MetricsCollector {
  private db: SqlDatabase;
  private config: ConfigManager;
  private lastRollup = 0;
  private lastCleanup = 0;

  constructor(db: SqlDatabase, config: ConfigManager) {
    this.db = db;
    this.config = config;
  }

  logRequest(
    endpoint: string,
    method: string,
    status: number,
    durationMs: number,
    ip: string,
    userAgent: string,
  ): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        "INSERT INTO request_logs (timestamp, endpoint, method, status, duration_ms, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(now, endpoint, method, status, durationMs, ip, userAgent || "");
  }

  recordWSClientCount(count: number): void {
    const now = Math.floor(Date.now() / 1000);
    const minute = now - (now % 60);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO ws_client_history (timestamp, count) VALUES (?, ?)",
      )
      .run(minute, count);
  }

  recordFeedEvent(feed: string, event: string, details: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        "INSERT INTO feed_events (timestamp, feed, event, details) VALUES (?, ?, ?, ?)",
      )
      .run(now, feed, event, details);
  }

  shouldRollup(): boolean {
    return Date.now() - this.lastRollup >= this.config.getRollupIntervalMs();
  }

  shouldCleanup(): boolean {
    return Date.now() - this.lastCleanup >= this.config.getCleanupIntervalMs();
  }

  performRollup(): void {
    const intervalSeconds = this.config.getRollupIntervalSeconds();
    const now = Math.floor(Date.now() / 1000);
    const currentWindow = now - (now % intervalSeconds);

    const requestRows = this.db
      .prepare(
        `SELECT endpoint, status, COUNT(*) as count, AVG(duration_ms) as avg_duration
        FROM request_logs
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY endpoint, status`,
      )
      .all(currentWindow - intervalSeconds, currentWindow);

    for (const row of requestRows) {
      const labels = JSON.stringify({
        endpoint: row.endpoint,
        status: String(row.status),
      });
      this.db
        .prepare(
          "INSERT OR REPLACE INTO metrics_rollup (timestamp, interval_seconds, metric_name, labels, value, count) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          currentWindow - intervalSeconds,
          intervalSeconds,
          "requests_total",
          labels,
          typeof row.count === "number" ? row.count : 0,
          1,
        );

      if (typeof row.avg_duration === "number") {
        const latencyLabels = JSON.stringify({ endpoint: row.endpoint });
        this.db
          .prepare(
            "INSERT OR REPLACE INTO metrics_rollup (timestamp, interval_seconds, metric_name, labels, value, count) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            currentWindow - intervalSeconds,
            intervalSeconds,
            "request_duration_avg",
            latencyLabels,
            row.avg_duration,
            typeof row.count === "number" ? row.count : 0,
          );
      }
    }

    this.lastRollup = Date.now();
  }

  performCleanup(): void {
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare("DELETE FROM request_logs WHERE timestamp < ?")
      .run(now - Math.floor(this.config.getRetentionMs() / 1000));
    this.db
      .prepare("DELETE FROM metrics_rollup WHERE timestamp < ?")
      .run(now - Math.floor(this.config.getRollupRetentionMs() / 1000));
    this.db
      .prepare("DELETE FROM ws_client_history WHERE timestamp < ?")
      .run(now - 86400);
    this.db
      .prepare("DELETE FROM feed_events WHERE timestamp < ?")
      .run(now - 7 * 86400);

    this.lastCleanup = Date.now();
  }

  getPrometheusMetrics(
    eventsTotal: { KMA: number; JMA: number },
    wsClientCount: number,
    feedStates: Record<string, FeedState>,
    parserHeartbeatAge: number,
  ): string {
    const lines: string[] = [];

    lines.push("# TYPE canaria_events_total counter");
    lines.push(`canaria_events_total{source="KMA"} ${eventsTotal.KMA}`);
    lines.push(`canaria_events_total{source="JMA"} ${eventsTotal.JMA}`);

    lines.push("# TYPE canaria_websocket_clients gauge");
    lines.push(`canaria_websocket_clients ${wsClientCount}`);

    lines.push("# TYPE canaria_parser_heartbeat_age_seconds gauge");
    lines.push(`canaria_parser_heartbeat_age_seconds ${parserHeartbeatAge}`);

    lines.push("# TYPE canaria_feed_connected gauge");
    lines.push(
      `canaria_feed_connected{feed="wolfx"} ${feedStates.wolfx?.status === "connected" ? 1 : 0}`,
    );
    lines.push(
      `canaria_feed_connected{feed="p2p"} ${feedStates.p2p?.status === "connected" ? 1 : 0}`,
    );

    const requestMetrics = this.db
      .prepare(
        "SELECT metric_name, labels, SUM(value) as total FROM metrics_rollup WHERE metric_name = 'requests_total' GROUP BY metric_name, labels",
      )
      .all();

    if (requestMetrics.length > 0) {
      lines.push("# TYPE canaria_requests_total counter");
      for (const row of requestMetrics) {
        const labels = JSON.parse(String(row.labels || "{}")) as Record<
          string,
          string
        >;
        const labelStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        lines.push(
          `canaria_requests_total{${labelStr}} ${typeof row.total === "number" ? row.total : 0}`,
        );
      }
    }

    const durationMetrics = this.db
      .prepare(
        "SELECT labels, AVG(value) as avg FROM metrics_rollup WHERE metric_name = 'request_duration_avg' GROUP BY labels",
      )
      .all();

    if (durationMetrics.length > 0) {
      lines.push("# TYPE canaria_request_duration_seconds gauge");
      for (const row of durationMetrics) {
        const labels = JSON.parse(String(row.labels || "{}")) as Record<
          string,
          string
        >;
        const labelStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        const avgSeconds = typeof row.avg === "number" ? row.avg / 1000 : 0;
        lines.push(
          `canaria_request_duration_seconds{${labelStr}} ${avgSeconds.toFixed(6)}`,
        );
      }
    }

    return `${lines.join("\n")}\n`;
  }

  getJSONMetrics(
    eventsTotal: { KMA: number; JMA: number },
    wsClientCount: number,
    feedStates: Record<string, FeedState>,
    parserHeartbeatAge: number,
  ): MetricsJSONFormat["data"] {
    const requestRows = this.db
      .prepare(
        "SELECT labels, SUM(value) as total FROM metrics_rollup WHERE metric_name = 'requests_total' GROUP BY labels",
      )
      .all();

    const requestTotals: { [endpoint: string]: { [status: string]: number } } =
      {};

    for (const row of requestRows) {
      const labels = JSON.parse(String(row.labels || "{}")) as Record<
        string,
        string
      >;
      const endpoint = labels.endpoint || "unknown";
      const status = String(labels.status || "unknown");
      const count = typeof row.total === "number" ? row.total : 0;

      if (!requestTotals[endpoint]) requestTotals[endpoint] = {};
      requestTotals[endpoint][status] = count;
    }

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    const recentRequests = this.db
      .prepare("SELECT COUNT(*) as c FROM request_logs WHERE timestamp >= ?")
      .first(fiveMinutesAgo);
    const recentCount =
      recentRequests && typeof recentRequests.c === "number"
        ? recentRequests.c
        : 0;

    const latency: {
      [endpoint: string]: { p50: number; p95: number; p99: number };
    } = {};
    const endpoints = this.db
      .prepare(
        "SELECT DISTINCT endpoint FROM request_logs WHERE timestamp >= ?",
      )
      .all(fiveMinutesAgo);

    for (const endpointRow of endpoints) {
      const endpoint = String(endpointRow.endpoint || "unknown");
      const durations = this.db
        .prepare(
          "SELECT duration_ms FROM request_logs WHERE endpoint = ? AND timestamp >= ? ORDER BY duration_ms ASC",
        )
        .all(endpoint, fiveMinutesAgo);

      if (durations.length > 0) {
        const values = durations.map((d) =>
          typeof d.duration_ms === "number" ? d.duration_ms : 0,
        );
        latency[endpoint] = {
          p50: percentile(values, 0.5) / 1000,
          p95: percentile(values, 0.95) / 1000,
          p99: percentile(values, 0.99) / 1000,
        };
      }
    }

    const violationsRow = this.db
      .prepare("SELECT COUNT(*) as c FROM request_logs WHERE status = 429")
      .first();
    const violations =
      violationsRow && typeof violationsRow.c === "number"
        ? violationsRow.c
        : 0;

    return {
      events: { total: eventsTotal, rate: 0 },
      requests: { total: requestTotals, ratePerMinute: recentCount / 5 },
      websockets: { active: wsClientCount },
      feeds: {
        wolfx: { connected: feedStates.wolfx?.status === "connected" },
        p2p: { connected: feedStates.p2p?.status === "connected" },
      },
      parser: { heartbeatAge: parserHeartbeatAge },
      latency,
      rateLimit: { violations },
    };
  }

  getLastRollup(): number {
    return this.lastRollup;
  }

  getLastCleanup(): number {
    return this.lastCleanup;
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, index)];
}
