import { CircuitBreaker } from "./circuitBreaker";
import type { EventRecord } from "@canaria/types";

// Fallback if env var is missing, though it should be provided
const PRIMARY_API = "/v1"; // Relative path, proxied by Vite or handled by same origin in prod
const BACKUP_API = import.meta.env.VITE_BACKUP_API_URL || "https://backup-api.canaria.io/events.json";

export class APIClient {
    private breaker: CircuitBreaker;

    constructor() {
        this.breaker = new CircuitBreaker();
    }

    public async getLatestEvents(): Promise<{ events: EventRecord[]; source: "primary" | "backup" }> {
        const state = this.breaker.getState();

        if (state === "OPEN") {
            return this.fetchFromBackup();
        }

        if (state === "HALF_OPEN") {
            // In HALF_OPEN, we try primary. If it fails, breaker opens again.
            // If success, breaker closes.
            try {
                const events = await this.fetchFromPrimary();
                this.breaker.recordSuccess();
                return { events, source: "primary" };
            } catch (e) {
                this.breaker.recordFailure();
                return this.fetchFromBackup();
            }
        }

        // CLOSED state
        try {
            const events = await this.fetchFromPrimary();
            this.breaker.recordSuccess();
            return { events, source: "primary" };
        } catch (e) {
            this.breaker.recordFailure();
            // Immediate failover if we just tripped it, or if it was a single failure
            // (The plan says "Automatic Failover Routing", so we should fallback on failure)
            return this.fetchFromBackup();
        }
    }

    private async fetchFromPrimary(): Promise<EventRecord[]> {
        // We expect the API to return { events: [...] } or just an array? 
        // Looking at index.ts: 
        // .get("/events/latest") returns a single event object.
        // .get("/events") returns { events: EventRecord[] }
        // Let's use /events/latest for validity check or /events for list.
        // But the App previously used generated 10k points. The /events endpoint limits to 20 by default.
        // To replicate 10k points, we might need a different strategy or the backend needs to support it.
        // For now, let's just fetch the standard list.

        // NOTE: The mock data generator made 10k points. The real API currently defaults to 20.
        // This transition might show fewer points initially.

        const res = await fetch(`${PRIMARY_API}/events?limit=100`);
        if (!res.ok) throw new Error(`Primary API error: ${res.status}`);
        const data = await res.json() as { events: EventRecord[] };
        return data.events;
    }

    private async fetchFromBackup(): Promise<{ events: EventRecord[]; source: "backup" }> {
        try {
            // Backup is a static JSON file containing { events: [...] }
            const res = await fetch(BACKUP_API);
            if (!res.ok) throw new Error(`Backup API error: ${res.status}`);
            const data = await res.json() as { events: EventRecord[] };
            return { events: data.events, source: "backup" };
        } catch (e) {
            console.error("Backup API failed:", e);
            return { events: [], source: "backup" }; // Degraded functionality
        }
    }
}

export const apiClient = new APIClient();
