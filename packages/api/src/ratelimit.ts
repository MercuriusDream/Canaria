import type { RateLimitResult } from "@canaria/types";
import type { ConfigManager } from "./config";

type SqlDatabase = {
  exec: (statement: string, params?: unknown[]) => unknown;
  prepare: (statement: string) => {
    run: (...params: unknown[]) => { changes?: number } | undefined;
    first: (...params: unknown[]) => Record<string, unknown> | null | undefined;
    all: (...params: unknown[]) => Record<string, unknown>[];
  };
};

export class RateLimiter {
  private db: SqlDatabase;
  private config: ConfigManager;

  constructor(db: SqlDatabase, config: ConfigManager) {
    this.db = db;
    this.config = config;
  }

  check(ip: string, endpoint: string): RateLimitResult {
    if (!this.config.isRateLimitEnabled()) {
      return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
    }

    const limit = this.config.getRateLimit(endpoint);
    if (!limit) {
      return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
    }

    const key = `${ip}:${endpoint}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % limit.windowSeconds);

    const row = this.db
      .prepare("SELECT count, window_start FROM rate_limits WHERE key = ?")
      .first(key);

    let count = 0;
    if (
      row &&
      typeof row.count === "number" &&
      typeof row.window_start === "number"
    ) {
      if (row.window_start === windowStart) {
        count = row.count;
      }
    }

    const allowed = count < limit.maxRequests;
    const remaining = Math.max(0, limit.maxRequests - count - 1);
    const resetAt = windowStart + limit.windowSeconds;

    if (allowed) {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, ?, ?)",
        )
        .run(key, count + 1, windowStart);
    }

    return { allowed, limit: limit.maxRequests, remaining, resetAt };
  }

  reset(ip: string, endpoint?: string): void {
    if (endpoint) {
      this.db
        .prepare("DELETE FROM rate_limits WHERE key = ?")
        .run(`${ip}:${endpoint}`);
    } else {
      this.db
        .prepare("DELETE FROM rate_limits WHERE key LIKE ?")
        .run(`${ip}:%`);
    }
  }

  cleanup(): void {
    const cutoff = Math.floor(Date.now() / 1000) - 3600;
    this.db
      .prepare("DELETE FROM rate_limits WHERE window_start < ?")
      .run(cutoff);
  }

  getTopIPs(
    limit: number = 10,
  ): { ip: string; requests: number; blocked: number }[] {
    const rows = this.db
      .prepare(
        `SELECT
          SUBSTR(key, 1, INSTR(key, ':') - 1) as ip,
          SUM(count) as requests
        FROM rate_limits
        GROUP BY ip
        ORDER BY requests DESC
        LIMIT ?`,
      )
      .all(limit);

    return rows.map((row) => ({
      ip: String(row.ip || "unknown"),
      requests: typeof row.requests === "number" ? row.requests : 0,
      blocked: 0,
    }));
  }
}
