import { useState, useCallback, useEffect } from "react";
import type { EventRecord } from "@canaria/types";
import { apiClient } from "../services/api";
import { gossipService } from "../services/p2p/gossip";
import type { Point } from "../utils/spatialIndex";

export function useCanariaEngine() {
    const [points, setPoints] = useState<Point[]>([]);
    const [connectionSource, setConnectionSource] = useState<"primary" | "backup" | "connecting">("connecting");

    const fetchData = useCallback(async () => {
        try {
            const result = await apiClient.getLatestEvents();
            setConnectionSource(result.source);

            const mappedPoints: Point[] = result.events.map((ev: EventRecord) => ({
                id: ev.eventId,
                lat: ev.latitude || 0,
                lng: ev.longitude || 0,
                type: (ev.source === "KMA" || ev.source === "JMA" ? "official" : "p2p") as "official" | "p2p"
            })).filter(p => p.lat !== 0 && p.lng !== 0);

            setPoints(mappedPoints);
        } catch (e) {
            console.error("Failed to fetch data", e);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Poll every 10s

        // Initialize Gossip (P2P + Realtime)
        gossipService.init();
        gossipService.onEvent((ev) => {
            console.log("Realtime event received:", ev);
            if (!ev.latitude || !ev.longitude) return;

            setPoints(prev => {
                const newPoint: Point = {
                    id: ev.eventId,
                    lat: ev.latitude!,
                    lng: ev.longitude!,
                    type: (ev.source === "KMA" || ev.source === "JMA" ? "official" : "p2p") as "official" | "p2p"
                };

                // Deduplicate
                if (prev.some(p => p.id === newPoint.id)) return prev;

                return [newPoint, ...prev];
            });
        });

        return () => {
            clearInterval(interval);
        };
    }, [fetchData]);

    return { points, connectionSource };
}
