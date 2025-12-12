import type { EventRecord, ListQuery } from "@canaria/types";

type SqlDatabase = {
  exec: (statement: string, params?: unknown[]) => unknown;
  prepare: (statement: string) => {
    run: (...params: unknown[]) => { changes?: number } | undefined;
    first: (...params: unknown[]) => Record<string, unknown> | null | undefined;
    all: (...params: unknown[]) => Record<string, unknown>[];
  };
};

export class EventStore {
  private readonly db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS events (
      eventId TEXT PRIMARY KEY,
      source TEXT,
      type TEXT,
      reportType TEXT,
      time TEXT,
      issueTime TEXT,
      receiveTime TEXT,
      receiveSource TEXT,
      latitude REAL,
      longitude REAL,
      magnitude REAL,
      depth REAL,
      intensity REAL,
      region TEXT,
      advisory TEXT,
      revision TEXT
    )`);

    try {
      this.db.exec("ALTER TABLE events ADD COLUMN issueTime TEXT");
    } catch (_e) {
      // Ignore if column exists
    }
    try {
      this.db.exec("ALTER TABLE events ADD COLUMN receiveTime TEXT");
    } catch (_e) {
      // Ignore if column exists
    }
    try {
      this.db.exec("ALTER TABLE events ADD COLUMN receiveSource TEXT");
    } catch (_e) {
      // Ignore if column exists
    }

    this.db.exec(`CREATE TABLE IF NOT EXISTS metrics_rollup (
      timestamp INTEGER,
      interval_seconds INTEGER,
      metric_name TEXT,
      labels TEXT,
      value REAL,
      count INTEGER,
      PRIMARY KEY (timestamp, interval_seconds, metric_name, labels)
    )`);

    this.db.exec(`CREATE TABLE IF NOT EXISTS request_logs (
      timestamp INTEGER,
      endpoint TEXT,
      method TEXT,
      status INTEGER,
      duration_ms REAL,
      ip TEXT,
      user_agent TEXT
    )`);

    this.db.exec(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER,
      window_start INTEGER
    )`);

    this.db.exec(`CREATE TABLE IF NOT EXISTS feed_events (
      timestamp INTEGER,
      feed TEXT,
      event TEXT,
      details TEXT
    )`);

    this.db.exec(`CREATE TABLE IF NOT EXISTS ws_client_history (
      timestamp INTEGER PRIMARY KEY,
      count INTEGER
    )`);

    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_metrics_rollup_timestamp ON metrics_rollup(timestamp)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_feed_events_timestamp ON feed_events(timestamp)`,
    );
  }

  insert(events: EventRecord[]): number {
    if (!events.length) return 0;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO events
      (eventId, source, type, reportType, time, issueTime, receiveTime, receiveSource, latitude, longitude, magnitude, depth, intensity, region, advisory, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let inserted = 0;
    for (const ev of events) {
      const result = stmt.run(
        ev.eventId,
        ev.source,
        ev.type,
        ev.reportType,
        ev.time,
        ev.issueTime,
        ev.receiveTime,
        ev.receiveSource,
        ev.latitude,
        ev.longitude,
        ev.magnitude,
        ev.depth,
        ev.intensity,
        ev.region,
        ev.advisory,
        ev.revision,
      ) as { changes?: number } | undefined;
      if (result && "changes" in result && result.changes === 1) {
        inserted += 1;
      }
    }
    return inserted;
  }

  latest(): EventRecord | null {
    const row = this.db
      .prepare("SELECT * FROM events ORDER BY time DESC LIMIT 1")
      .first();
    return row ? this.deserialize(row) : null;
  }

  list(query: ListQuery): EventRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.since) {
      clauses.push("time >= ?");
      params.push(query.since);
    }
    if (query.until) {
      clauses.push("time <= ?");
      params.push(query.until);
    }
    if (query.source) {
      clauses.push("source = ?");
      params.push(query.source);
    }
    if (query.type) {
      clauses.push("type = ?");
      params.push(query.type);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Number.isFinite(query.limit) ? query.limit : 20;
    const rows = this.db
      .prepare(`SELECT * FROM events ${whereClause} ORDER BY time DESC LIMIT ?`)
      .all(...params, limit);

    return rows.map((row) => this.deserialize(row));
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(1) as c FROM events").first();
    if (row && typeof row.c === "number") {
      return row.c;
    }
    return 0;
  }

  countBySource(source: string): number {
    const row = this.db
      .prepare("SELECT COUNT(1) as c FROM events WHERE source = ?")
      .first(source);
    if (row && typeof row.c === "number") {
      return row.c;
    }
    return 0;
  }

  getOldestEvent(): EventRecord | null {
    const row = this.db
      .prepare("SELECT * FROM events ORDER BY time ASC LIMIT 1")
      .first();
    return row ? this.deserialize(row) : null;
  }

  getTableStats(): {
    events: number;
    metrics_rollup: number;
    request_logs: number;
    rate_limits: number;
  } {
    const tables = ["events", "metrics_rollup", "request_logs", "rate_limits"];
    const stats: Record<string, number> = {};

    for (const table of tables) {
      const row = this.db.prepare(`SELECT COUNT(1) as c FROM ${table}`).first();
      stats[table] = row && typeof row.c === "number" ? row.c : 0;
    }

    return stats as {
      events: number;
      metrics_rollup: number;
      request_logs: number;
      rate_limits: number;
    };
  }

  deleteOldEvents(daysOld: number): number {
    const cutoff = new Date(
      Date.now() - daysOld * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result = this.db
      .prepare("DELETE FROM events WHERE time < ?")
      .run(cutoff) as { changes?: number } | undefined;
    return result && "changes" in result && typeof result.changes === "number"
      ? result.changes
      : 0;
  }

  getDatabase(): SqlDatabase {
    return this.db;
  }

  private deserialize(row: Record<string, unknown>): EventRecord {
    return {
      eventId: String(row.eventId),
      source: row.source as EventRecord["source"],
      type: String(row.type),
      reportType:
        typeof row.reportType === "number" || typeof row.reportType === "string"
          ? row.reportType
          : null,
      time: String(row.time),
      issueTime: typeof row.issueTime === "string" ? row.issueTime : null,
      receiveTime:
        typeof row.receiveTime === "string"
          ? row.receiveTime
          : String(row.time),
      receiveSource:
        typeof row.receiveSource === "string" ? row.receiveSource : "unknown",
      latitude: numeric(row.latitude),
      longitude: numeric(row.longitude),
      magnitude: numeric(row.magnitude),
      depth: numeric(row.depth),
      intensity: numeric(row.intensity),
      region: typeof row.region === "string" ? row.region : null,
      advisory: typeof row.advisory === "string" ? row.advisory : null,
      revision: typeof row.revision === "string" ? row.revision : null,
    };
  }
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
