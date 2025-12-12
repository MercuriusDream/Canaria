import { Elysia } from "elysia";
import type { ApiDependencies } from "../types/deps";

export const createMetricsRoutes = (deps: ApiDependencies) =>
  new Elysia()
    .get(
      "/metrics",
      ({
        query,
        set,
      }: {
        query: Record<string, string | undefined>;
        // biome-ignore lint/suspicious/noExplicitAny: Elysia Context types
        set: any;
      }) => {
        const format = query.format || "prometheus";
        const eventsTotal = {
          KMA: deps.store.countBySource("KMA"),
          JMA: deps.store.countBySource("JMA"),
        };
        const wsClientCount = deps.clients.size();
        const heartbeatAge = deps.parserHeartbeat
          ? Math.floor(
              (Date.now() -
                new Date(deps.parserHeartbeat.lastParseTime).getTime()) /
                1000,
            )
          : Infinity;

        if (format === "json") {
          const data = deps.metrics.getJSONMetrics(
            eventsTotal,
            wsClientCount,
            deps.feedStates,
            heartbeatAge,
          );
          return { format: "json", data };
        }

        const data = deps.metrics.getPrometheusMetrics(
          eventsTotal,
          wsClientCount,
          deps.feedStates,
          heartbeatAge,
        );
        set.headers["Content-Type"] = "text/plain; version=0.0.4";
        return data;
      },
    )

    .get(
      "/metrics/timeseries",
      ({ query }: { query: Record<string, string | undefined> }) => {
        return {
          metric: query.metric || "unknown",
          interval: query.interval || "1m",
          dataPoints: [],
        };
      },
    )

    .get("/monitoring", () => {
      deps.metrics.recordWSClientCount(deps.clients.size());
      return deps.healthMonitor.getDetailedMonitoring(
        deps.parserHeartbeat,
        deps.feedStates,
        deps.store,
        deps.clients.size(),
        deps.clients.totalConnectionCount(),
        deps.lastStoredAt,
        deps.startTime,
        deps.parserErrorHistory,
      );
    });
