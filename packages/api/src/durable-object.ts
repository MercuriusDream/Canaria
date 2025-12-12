import type { ApiDependencies } from "./types/deps";
import type { FeedState } from "@canaria/types";
import { SqliteAdapter } from "./adapter";
import { AdminHandler } from "./admin";
import { createApp } from "./app";
import { BackupService } from "./backup";
import { ConnectionManager } from "./clients";
import { type Config, ConfigManager } from "./config";
import { FeedManager } from "./feeds";
import { IngestService } from "./ingest";
import { MetricsCollector } from "./metrics";
import { HealthMonitor } from "./monitoring";
import { RateLimiter } from "./ratelimit";
import { Signer } from "./signer";
import { EventStore } from "./storage";

export interface Env {
    CANARIA_DO: DurableObjectNamespace;
    LOBBY_DO: DurableObjectNamespace;
    R2_BACKUP?: R2Bucket;
    ADMIN_SECRET?: string;
    METRICS_ROLLUP_INTERVAL?: string;
    METRICS_RETENTION_DAYS?: string;
    ROLLUP_RETENTION_DAYS?: string;
    RATE_LIMIT_ENABLED?: string;
}

export class CanariaSqlDurableObject implements ApiDependencies {
    public readonly store: EventStore;
    public readonly connectionManager: ConnectionManager;
    public readonly feedManager: FeedManager;
    public readonly config: ConfigManager;
    public readonly rateLimiter: RateLimiter;
    public readonly metrics: MetricsCollector;
    public readonly healthMonitor: HealthMonitor;
    public readonly adminHandler: AdminHandler;
    public readonly backupService: BackupService;
    public readonly ingestService: IngestService;

    private readonly signer = new Signer();

    public feedStates: Record<string, FeedState> = {
        wolfx: {
            status: "connecting",
            lastMessage: null,
            lastError: null,
            connectedAt: null,
            disconnectedAt: null,
            reconnectCount: 0,
            totalUptime: 0,
            lastHeartbeat: null,
        },
        p2p: {
            status: "connecting",
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
    private lastRollupCheck: number = 0;

    public startTime: number = Date.now();

    // The Inner Elysia App
    // biome-ignore lint/suspicious/noExplicitAny: Elysia type inference is complex
    private app: any;

    constructor(
        private readonly state: DurableObjectState,
        private readonly env: Env,
    ) {
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
        this.adminHandler = new AdminHandler(
            this.config,
            this.store,
            this.metrics,
            this.rateLimiter,
            this.startTime,
        );

        this.backupService = new BackupService(env.R2_BACKUP);
        this.connectionManager = new ConnectionManager(60_000, this.store);

        // Pass waitUntil to IngestService so it can run background tasks
        this.ingestService = new IngestService(
            this.store,
            this.signer,
            this.connectionManager,
            this.backupService,
            this.state.waitUntil.bind(this.state)
        );

        this.feedManager = new FeedManager({
            onEvent: (ev) => this.ingestService.handleIncomingEvents([ev]),
            onStatus: (name, state) => {
                this.feedStates = { ...this.feedStates, [name]: state };
                this.metrics.recordFeedEvent(
                    name,
                    state.status,
                    state.lastError || state.lastMessage || "",
                );
            },
        });

        // Initialize Elysia App via Factory
        this.app = createApp(this);
    }

    // Helper to satisfy ApiDependencies.adminSecret
    public get adminSecret(): string {
        return this.env.ADMIN_SECRET || "change-this-secret";
    }

    async fetch(request: Request): Promise<Response> {
        return this.app.fetch(request);
    }

    public ensureSystemRunning(): void {
        if (this.feedsStarted) return;
        this.feedsStarted = true;
        this.feedManager.startAll();
        this.connectionManager.startPings();
    }

    public performPeriodicTasks(): void {
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
            this.metrics.recordWSClientCount(this.connectionManager.size());
            this.lastRollupCheck = now;
        }
    }
}
