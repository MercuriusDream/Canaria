export type EventSource = "KMA" | "JMA";

export interface EventRecord {
  eventId: string;
  source: EventSource;
  type: string;
  reportType: number | string | null;
  time: string; // Event origin time
  issueTime: string | null; // When the report was issued by authority
  receiveTime: string; // When Canaria received/ingested the data
  receiveSource: string; // Specific source (WolfX, P2P, KMA)
  latitude: number | null;
  longitude: number | null;
  magnitude: number | null;
  depth: number | null;
  intensity: number | null;
  region: string | null;
  advisory: string | null;
  revision: string | null;
}

export interface Heartbeat {
  kmaConnection: boolean;
  lastParseTime: string;
  lastEventTime: string | null;
  delayMs: number;
  error: string | null;
  // Optional statistics
  stats?: {
    totalParses: number;
    successfulParses: number;
    failedParses: number;
    eventsIngested: number;
    averageDelayMs: number;
    uptime: number;
  };
}

export interface IngestPayload {
  heartbeat?: Heartbeat;
  events?: EventRecord[];
}

export interface StatusSnapshot {
  parser: Heartbeat | null;
  jmaFeeds: {
    wolfx: FeedState;
    p2p: FeedState;
  };
  stats: {
    eventsStored: number;
    clientsConnected: number;
    lastStoredAt: string | null;
  };
}

export interface FeedState {
  status: "connecting" | "connected" | "disconnected";
  lastMessage: string | null;
  lastError: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  reconnectCount: number;
  totalUptime: number;
  lastHeartbeat: string | null;
}

export interface ListQuery {
  since?: string;
  until?: string;
  limit?: number;
  source?: EventSource;
  type?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface HealthCheckResponse {
  healthy: boolean;
  checks: {
    parser: boolean;
    feeds: boolean;
    database: boolean;
  };
}

export interface EnhancedStatusSnapshot extends StatusSnapshot {
  overall: "healthy" | "degraded" | "down";
  sources: {
    KMA: {
      status: "healthy" | "degraded" | "down";
      lastEvent: string | null;
      heartbeatAgeSeconds: number;
    };
    JMA: {
      status: "healthy" | "degraded" | "down";
      feeds: {
        wolfx: {
          connected: boolean;
          lastMessage: string | null;
          lastError: string | null;
        };
        p2p: {
          connected: boolean;
          lastMessage: string | null;
          lastError: string | null;
        };
      };
    };
  };
}

export interface MetricsPrometheusFormat {
  format: "prometheus";
  data: string;
}

export interface MetricsJSONFormat {
  format: "json";
  data: {
    events: {
      total: { KMA: number; JMA: number };
      rate: number;
    };
    requests: {
      total: { [endpoint: string]: { [status: string]: number } };
      ratePerMinute: number;
    };
    websockets: {
      active: number;
    };
    feeds: {
      wolfx: { connected: boolean };
      p2p: { connected: boolean };
    };
    parser: {
      heartbeatAge: number;
    };
    latency: {
      [endpoint: string]: {
        p50: number;
        p95: number;
        p99: number;
      };
    };
    rateLimit: {
      violations: number;
    };
  };
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
}

export interface TimeSeriesResponse {
  metric: string;
  interval: string;
  dataPoints: TimeSeriesDataPoint[];
}

export interface AdminDashboardResponse {
  system: {
    uptime: number;
    currentTime: string;
    version: string;
    nextCleanup: string;
    lastRollup: string;
  };
  events: {
    total: number;
    bySource: { KMA: number; JMA: number };
    recent: EventRecord[];
    perMinute: number;
    oldestEvent: string | null;
  };
  parser: {
    alive: boolean;
    lastHeartbeat: string | null;
    heartbeatAgeSeconds: number;
    lastError: string | null;
  };
  feeds: {
    wolfx: {
      status: string;
      lastMessage: string | null;
      lastError: string | null;
      uptimePercent: number;
      reconnectCount: number;
    };
    p2p: {
      status: string;
      lastMessage: string | null;
      lastError: string | null;
      uptimePercent: number;
      reconnectCount: number;
    };
  };
  clients: {
    websocketCount: number;
    history: { timestamp: string; count: number }[];
  };
  ratelimit: {
    topIPs: { ip: string; requests: number; blocked: number }[];
    totalBlocked: number;
  };
  database: {
    eventCount: number;
    estimatedSizeKB: number;
    tableStats: {
      events: number;
      metrics_rollup: number;
      request_logs: number;
      rate_limits: number;
    };
  };
  config: {
    metrics: {
      rollupInterval: string;
      retentionDays: number;
      rollupRetentionDays: number;
    };
    rateLimit: {
      enabled: boolean;
    };
    monitoring: {
      parserTimeoutSeconds: number;
      feedTimeoutSeconds: number;
    };
  };
}

export interface AdminActionRequest {
  action: "reconnect_feed" | "clear_old_events" | "reset_ratelimit" | "trigger_rollup" | "cleanup_now";
  params?: {
    feed?: "wolfx" | "p2p";
    ip?: string;
    daysOld?: number;
  };
}

export interface AdminActionResponse {
  success: boolean;
  message: string;
  result?: unknown;
}

export interface ParserMetrics {
  totalParses: number;
  successfulParses: number;
  failedParses: number;
  eventsIngested: number;
  successRate: number;
  averageDelayMs: number;
  uptime: number;
  uptimeFormatted: string;
  recentErrors: Array<{
    timestamp: string;
    error: string;
  }>;
}

export interface DetailedMonitoringResponse {
  timestamp: string;
  system: {
    uptime: number;
    uptimeFormatted: string;
  };
  parser: {
    connected: boolean;
    lastParseTime: string | null;
    lastEventTime: string | null;
    lastHeartbeat: string | null;
    heartbeatAgeSeconds: number;
    delayMs: number;
    error: string | null;
    metrics?: ParserMetrics;
  };
  feeds: {
    wolfx: FeedConnectionDetails;
    p2p: FeedConnectionDetails;
  };
  clients: {
    websocketCount: number;
    totalConnections: number;
  };
  events: {
    total: number;
    bySource: { KMA: number; JMA: number };
    lastStoredAt: string | null;
  };
  health: {
    overall: "healthy" | "degraded" | "down";
    parser: "healthy" | "degraded" | "down";
    feeds: "healthy" | "degraded" | "down";
  };
}

export interface FeedConnectionDetails {
  status: "connecting" | "connected" | "disconnected";
  connected: boolean;
  lastMessage: string | null;
  lastHeartbeat: string | null;
  lastError: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  currentSessionUptime: number;
  totalUptime: number;
  reconnectCount: number;
  uptimePercent: number;
}
