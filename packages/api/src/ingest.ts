import type { EventRecord, Heartbeat } from "@canaria/types";
import type { ConnectionManager } from "./clients";
import type { BackupService } from "./backup";
import type { Signer } from "./signer";
import type { EventStore } from "./storage";

export class IngestService {
    public parserHeartbeat: Heartbeat | null = null;
    public parserErrorHistory: Array<{ timestamp: string; error: string }> = [];
    public readonly MAX_PARSER_ERRORS = 10;

    // Logic from routes/events.ts suggests this is needed for KMA Sync
    public needsKmaSync = true;

    // Logic from index.ts suggests we track this for backups
    public lastStoredAt: string | null = null;

    constructor(
        private readonly store: EventStore,
        private readonly signer: Signer,
        private readonly connectionManager: ConnectionManager,
        private readonly backupService: BackupService,
        private readonly waitUntil: (promise: Promise<unknown>) => void
    ) { }

    public async handleIncomingEvents(events: EventRecord[]): Promise<void> {
        if (!events.length) return;
        try {
            const inserted = this.store.insert(events);
            if (inserted > 0) {
                this.lastStoredAt = new Date().toISOString();

                const signedEvents = await Promise.all(
                    events.map((ev) => this.signer.sign(ev))
                );
                this.connectionManager.broadcast({ signedEvents });

                // Backup current state asynchronously
                const allEvents = this.store.list({ limit: 1000 });
                this.waitUntil(this.backupService.saveProjection(allEvents));
            }
        } catch (error) {
            console.error("[ingest] Failed to store events", error);
        }
    }

    public handleHeartbeat(heartbeat: Heartbeat): void {
        this.parserHeartbeat = heartbeat;
        if (heartbeat.error) {
            this.parserErrorHistory.unshift({
                timestamp: heartbeat.lastParseTime,
                error: heartbeat.error,
            });
            if (this.parserErrorHistory.length > this.MAX_PARSER_ERRORS) {
                this.parserErrorHistory.splice(this.MAX_PARSER_ERRORS);
            }
        }

        // Check for KMA connection to reset sync flag if needed
        if (this.needsKmaSync && heartbeat.kmaConnection) {
            this.needsKmaSync = false;
        }
    }

    public getSyncStatus(): boolean {
        return this.needsKmaSync;
    }
}
