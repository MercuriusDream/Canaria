import type { ListQuery } from "@canaria/types";
import { IngestPayloadSchema } from "@canaria/types";
import { Elysia } from "elysia";
import type { ApiDependencies } from "../types/deps";

export const createEventRoutes = (deps: ApiDependencies) =>
  new Elysia().group("/v1", (app) =>
    app
      // biome-ignore lint/suspicious/noExplicitAny: Elysia Context types
      .get("/ws", ({ request, set }: { request: Request; set: any }) =>
        deps.connectionManager.handleClientWebSocket(request, set),
      )

      .post(
        "/events",
        async ({ body, set }) => {
          const payload = body;

          // Delegate parser heartbeat/error logic to IngestService
          if (payload.heartbeat) {
            deps.ingestService.handleHeartbeat(payload.heartbeat);
          }

          // Delegate event ingestion
          if (payload.events?.length) {
            await deps.ingestService.handleIncomingEvents(payload.events);
          }

          // Check Sync Status
          // We can check if KMA connection triggered a sync requirement satisfaction
          // logic is now in IngestService to update the flag, but we need to know IF we should tell client to sync.
          // Before: if (deps.needsKmaSync && payload.heartbeat?.kmaConnection) -> deps.needsKmaSync = false; return {sync:true}
          // Now: IngestService updates the flag internaly in handleHeartbeat.
          // But we need to respond to the client.

          // Re reading the previous logic:
          // if (deps.needsKmaSync && payload.heartbeat?.kmaConnection) ...

          // Issues: multiple requests could come. 
          // Let's rely on IngestService state.
          // But wait, if handleHeartbeat ALREADY flipped the flag, we might miss sending the sync signal 
          // if we check after handleHeartbeat.
          // Actually, if it was true before and the heartbeat has kmaConnection, we send sync.

          // Refined logic in IngestService doesn't return anything. 
          // Maybe we should just access the property on deps.ingestService if it's public,
          // OR verify the condition here. 

          // Let's rely on the service state but we might have a race condition if we are not careful? 
          // Actually, JS is single threaded in one request execution unless awaited.
          // handleHeartbeat is synchronous.
          // Wait, if IngestService flipped it to false, we might lose the "true" state we needed to check.
          // We should check 'needsKmaSync' BEFORE calling handleHeartbeat if we want to know if it WAS needed.
          // Or we modify handleHeartbeat to return a "shouldSync" boolean.

          // Let's modify IngestService later if needed, but for now let's reproduce the logic here cleanly 
          // by peeking at state or doing it slightly differently? 
          // Actually IngestService.handleHeartbeat does:
          // if (this.needsKmaSync && heartbeat.kmaConnection) { this.needsKmaSync = false; }

          // So if we call it, the flag is gone.
          // Let's look at the flag + input locally before calling service?
          const wasNeeded = deps.ingestService.needsKmaSync;
          const hasKma = !!payload.heartbeat?.kmaConnection;

          if (payload.heartbeat) {
            deps.ingestService.handleHeartbeat(payload.heartbeat);
          }

          if (wasNeeded && hasKma) {
            set.status = 200;
            return { sync: true };
          }

          set.status = 204;
          return null;
        },
        {
          body: IngestPayloadSchema,
        },
      )

      .get("/events/latest", () => {
        const event = deps.store.latest();
        if (!event) return new Response(null, { status: 204 });
        return event;
      })

      .get(
        "/events",
        ({ query }: { query: Record<string, string | undefined> }) => {
          const q: ListQuery = {
            since: query.since,
            until: query.until,
            // biome-ignore lint/suspicious/noExplicitAny: Casting query param to constant union
            source: query.source as any,
            type: query.type,
            limit: query.limit
              ? parseInt(query.limit as string, 10)
              : undefined,
          };
          const events = deps.store.list(q);
          return { events };
        },
      ),
  );
