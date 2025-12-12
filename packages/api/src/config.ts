type SqlDatabase = {
  exec: (statement: string, params?: unknown[]) => unknown;
  prepare: (statement: string) => {
    run: (...params: unknown[]) => { changes?: number } | undefined;
    first: (...params: unknown[]) => Record<string, unknown> | null | undefined;
    all: (...params: unknown[]) => Record<string, unknown>[];
  };
};

export type RollupInterval = "1m" | "5m" | "15m" | "1h";

export interface Config {
  metrics: {
    rollupInterval: RollupInterval;
    retentionDays: number;
    rollupRetentionDays: number;
  };
  rateLimit: {
    enabled: boolean;
    limits: {
      [endpoint: string]: {
        maxRequests: number;
        windowSeconds: number;
      };
    };
  };
  monitoring: {
    parserTimeoutSeconds: number;
    feedTimeoutSeconds: number;
    cleanupIntervalHours: number;
  };
}

const DEFAULT_CONFIG: Config = {
  metrics: {
    rollupInterval: "1m",
    retentionDays: 7,
    rollupRetentionDays: 90,
  },
  rateLimit: {
    enabled: true,
    limits: {
      "POST /v1/events": { maxRequests: 60, windowSeconds: 60 },
      "GET /v1/events/latest": { maxRequests: 120, windowSeconds: 60 },
      "GET /v1/events": { maxRequests: 60, windowSeconds: 60 },
      "GET /v1/ws": { maxRequests: 10, windowSeconds: 300 },
      "GET /v1/status": { maxRequests: 120, windowSeconds: 60 },
      "GET /v1/health": { maxRequests: 120, windowSeconds: 60 },
      "GET /v1/monitoring": { maxRequests: 120, windowSeconds: 60 },
      "GET /v1/metrics": { maxRequests: 60, windowSeconds: 60 },
      "GET /v1/metrics/timeseries": { maxRequests: 30, windowSeconds: 60 },
      "GET /admin/dashboard": { maxRequests: 60, windowSeconds: 60 },
      "GET /admin/config": { maxRequests: 60, windowSeconds: 60 },
      "PUT /admin/config": { maxRequests: 30, windowSeconds: 60 },
      "POST /admin/actions": { maxRequests: 30, windowSeconds: 60 },
    },
  },
  monitoring: {
    parserTimeoutSeconds: 60,
    feedTimeoutSeconds: 30,
    cleanupIntervalHours: 1,
  },
};

export class ConfigManager {
  private db: SqlDatabase;
  private cache: Config;

  constructor(db: SqlDatabase, envVars?: Record<string, string | undefined>) {
    this.db = db;
    this.ensureTable();
    this.cache = this.loadOrInitialize(envVars);
  }

  get(): Config {
    return JSON.parse(JSON.stringify(this.cache));
  }

  update(partial: Partial<Config>): void {
    if (partial.metrics) {
      this.cache.metrics = { ...this.cache.metrics, ...partial.metrics };
    }
    if (partial.rateLimit) {
      if (partial.rateLimit.enabled !== undefined) {
        this.cache.rateLimit.enabled = partial.rateLimit.enabled;
      }
      if (partial.rateLimit.limits) {
        this.cache.rateLimit.limits = {
          ...this.cache.rateLimit.limits,
          ...partial.rateLimit.limits,
        };
      }
    }
    if (partial.monitoring) {
      this.cache.monitoring = {
        ...this.cache.monitoring,
        ...partial.monitoring,
      };
    }
    this.persist();
  }

  getRollupIntervalMs(): number {
    const intervals = {
      "1m": 60_000,
      "5m": 300_000,
      "15m": 900_000,
      "1h": 3_600_000,
    };
    return intervals[this.cache.metrics.rollupInterval] || 60_000;
  }

  getRollupIntervalSeconds(): number {
    return Math.floor(this.getRollupIntervalMs() / 1000);
  }

  getRetentionMs(): number {
    return this.cache.metrics.retentionDays * 24 * 60 * 60 * 1000;
  }

  getRollupRetentionMs(): number {
    return this.cache.metrics.rollupRetentionDays * 24 * 60 * 60 * 1000;
  }

  getRateLimit(
    endpoint: string,
  ): { maxRequests: number; windowSeconds: number } | null {
    if (!this.cache.rateLimit.enabled) return null;
    return this.cache.rateLimit.limits[endpoint] || null;
  }

  isRateLimitEnabled(): boolean {
    return this.cache.rateLimit.enabled;
  }

  getParserTimeoutSeconds(): number {
    return this.cache.monitoring.parserTimeoutSeconds;
  }

  getFeedTimeoutSeconds(): number {
    return this.cache.monitoring.feedTimeoutSeconds;
  }

  getCleanupIntervalMs(): number {
    return this.cache.monitoring.cleanupIntervalHours * 60 * 60 * 1000;
  }

  private ensureTable(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    )`);
  }

  private loadOrInitialize(
    envVars?: Record<string, string | undefined>,
  ): Config {
    const row = this.db
      .prepare("SELECT value FROM config WHERE key = ?")
      .first("app_config");

    if (row && typeof row.value === "string") {
      try {
        return JSON.parse(row.value) as Config;
      } catch {}
    }

    const config: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

    if (envVars) {
      const interval = envVars.METRICS_ROLLUP_INTERVAL as RollupInterval;
      if (interval && ["1m", "5m", "15m", "1h"].includes(interval)) {
        config.metrics.rollupInterval = interval;
      }

      const retention = parseInt(envVars.METRICS_RETENTION_DAYS || "", 10);
      if (Number.isFinite(retention) && retention >= 1 && retention <= 365) {
        config.metrics.retentionDays = retention;
      }

      const rollupRetention = parseInt(envVars.ROLLUP_RETENTION_DAYS || "", 10);
      if (
        Number.isFinite(rollupRetention) &&
        rollupRetention >= 1 &&
        rollupRetention <= 365
      ) {
        config.metrics.rollupRetentionDays = rollupRetention;
      }

      if (envVars.RATE_LIMIT_ENABLED) {
        config.rateLimit.enabled =
          envVars.RATE_LIMIT_ENABLED.toLowerCase() === "true";
      }
    }

    this.persist();
    return config;
  }

  private persist(): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)",
      )
      .run("app_config", JSON.stringify(this.cache), now);
  }
}
