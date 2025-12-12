import { Elysia } from "elysia";
import type { ApiDependencies } from "../types/deps";

export const createHealthRoutes = (deps: ApiDependencies) =>
  new Elysia()
    .get("/status", () => {
      const health = deps.healthMonitor.checkHealth(
        deps.parserHeartbeat,
        deps.feedStates,
        deps.store,
      );
      return {
        status: health.healthy ? "ok" : "degraded",
        summary: health.healthy
          ? "All systems operational"
          : "Some systems are experiencing issues",
        timestamp: new Date().toISOString(),
      };
    })

    .get("/connections", () => {
      deps.metrics.recordWSClientCount(deps.clients.size());
      return deps.healthMonitor.getEnhancedStatus(
        deps.parserHeartbeat,
        deps.feedStates,
        deps.store.count(),
        deps.clients.size(),
        deps.lastStoredAt,
        deps.store,
      );
    })

    // biome-ignore lint/suspicious/noExplicitAny: Elysia Context types
    .get("/health", ({ set }: { set: any }) => {
      const health = deps.healthMonitor.checkHealth(
        deps.parserHeartbeat,
        deps.feedStates,
        deps.store,
      );
      set.status = health.healthy ? 200 : 503;
      return health;
    });
