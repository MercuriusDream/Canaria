import type { AdminActionRequest } from "@canaria/types";
import { Elysia } from "elysia";
import type { Config } from "../config";
import type { ApiDependencies } from "../types/deps";

export const createAdminRoutes = (deps: ApiDependencies) =>
  new Elysia().group("/admin", (app) =>
    app
      .onBeforeHandle(
        ({
          request,
          query,
          set,
        }: {
          request: Request;
          query: Record<string, string | undefined>;
          // biome-ignore lint/suspicious/noExplicitAny: Elysia Context types
          set: any;
        }) => {
          const adminSecret = deps.adminSecret || "change-this-secret";
          const authHeader = request.headers.get("Authorization");
          const token = authHeader?.startsWith("Bearer ")
            ? authHeader.substring(7)
            : query.auth;

          if (token !== adminSecret) {
            set.status = 401;
            return { error: "Unauthorized" };
          }
        },
      )
      .get("/dashboard", () => {
        return deps.adminHandler.getDashboard(
          deps.parserHeartbeat,
          deps.feedStates,
          deps.clients.size(),
        );
      })
      .get("/config", () => {
        return deps.config.get();
      })
      // biome-ignore lint/suspicious/noExplicitAny: Request body
      .put("/config", async ({ body }: { body: any }) => {
        const partial = body as Partial<Config>;
        deps.config.update(partial);
        return {
          success: true,
          message: "Configuration updated",
          config: deps.config.get(),
        };
      })
      // biome-ignore lint/suspicious/noExplicitAny: Request body
      .post("/actions", async ({ body }: { body: any }) => {
        const action = body as AdminActionRequest;
        return deps.adminHandler.handleAction(action, deps.feedManager);
      }),
  );
