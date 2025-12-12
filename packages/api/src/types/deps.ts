import type { FeedState } from "@canaria/types";
import type { AdminHandler } from "../admin";
import type { ConnectionManager } from "../clients";
import type { ConfigManager } from "../config";
import type { FeedManager } from "../feeds";
import type { IngestService } from "../ingest";
import type { MetricsCollector } from "../metrics";
import type { HealthMonitor } from "../monitoring";
import type { RateLimiter } from "../ratelimit";
import type { EventStore } from "../storage";

export interface ApiDependencies {
  // Services
  store: EventStore;
  connectionManager: ConnectionManager;
  config: ConfigManager;
  rateLimiter: RateLimiter;
  metrics: MetricsCollector;
  healthMonitor: HealthMonitor;
  adminHandler: AdminHandler;
  feedManager: FeedManager;

  // New Service
  ingestService: IngestService;

  // Environment / Config
  adminSecret: string;
  startTime: number;

  // Deprecated/Legacy State access
  // feedStates: Record<string, FeedState>; 

  // Expose methods that routes specifically need
  ensureSystemRunning(): void;
  performPeriodicTasks(): void;
}
