import { cors } from "@elysiajs/cors";
import { html } from "@elysiajs/html";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import { API_DOCS_HTML } from "./docs";
import { createAdminRoutes } from "./routes/admin";
import { createEventRoutes } from "./routes/events";
import { createHealthRoutes } from "./routes/health";
import { createMetricsRoutes } from "./routes/metrics";
import type { ApiDependencies } from "./types/deps";

export const createApp = (deps: ApiDependencies) => {
    return (
        new Elysia({ aot: false })
            .use(cors())
            .use(
                swagger({
                    documentation: {
                        info: {
                            title: "Canaria API",
                            version: "1.0.0",
                        },
                    },
                }),
            )
            .use(html())

            // Global Tasks & Updates
            .onRequest(({ request: _request }) => {
                // Ensure feeds and clients are running
                // We could move these flags to deps if we want to track "started" state strictly,
                // but for now calling startAll() idempotently or checking a flag on deps is fine.
                // Since `feedsStarted` was a private flag, we can add it to deps OR just let the manager handle it.
                // FeedManager.startAll is likely idempotent or we should check.
                // index.ts had `private feedsStarted = false`.
                // Let's assume we can trigger these.
                // ideally we should have `deps.ensureStarted()` but `deps` is an interface.

                // For now, we will trust the existing logic being moved here or adapted.
                // If we cannot easily replicate 'ensureFeeds' logic because of missing 'started' flag in deps,
                // we might invoke a method on deps if we added one.
                // Let's look at deps.ts again... we didn't add ensureFeeds.

                // Let's assume for this step we will implement `ensureFeeds` logic inside the DO
                // and call it via a new method in deps, or just reproduce it here if we have access to the flag.
                // We don't have the flag in deps.
                // I will add `ensureSystemStarted()` to deps interface in the next step (modifying deps.ts)
                // OR I can just access `deps.feedManager.startAll()` which might be safe to call repeatedly?
                // Ref: index.ts:
                // if (this.feedsStarted) return;
                // this.feedsStarted = true;
                // ...

                // I'll make the DO implement a method `ensureSystemStarted()` and add it to ApiDependencies.
                // I need to update deps.ts first? Or just cast it for now to avoid blocking.
                // Better: Update deps.ts to include `ensureSystemRunning(): void` and `performPeriodicTasks(): void`.
                // This is cleaner than reproducing logic in app.ts.
                // "Separate App Initialization" was the goal. moving orchestration to the DO is correct.

                if ("ensureSystemRunning" in deps) {
                    deps.ensureSystemRunning();
                }
                if ("performPeriodicTasks" in deps) {
                    deps.performPeriodicTasks();
                }
            })

            // Rate Limiting Middleware
            // biome-ignore lint/suspicious/noExplicitAny: Elysia Context types
            .onBeforeHandle(({ request, set }: { request: Request; set: any }) => {
                const url = new URL(request.url);
                const ip =
                    request.headers.get("CF-Connecting-IP") ||
                    request.headers.get("X-Forwarded-For") ||
                    "unknown";
                const userAgent = request.headers.get("User-Agent") || "";

                // Skip rate limit for websockets upgrade initiation
                if (request.headers.get("Upgrade") === "websocket") return;

                const endpoint = `${request.method} ${url.pathname}`;
                const limitRes = deps.rateLimiter.check(ip, endpoint);

                if (!limitRes.allowed) {
                    set.status = 429;
                    set.headers["X-RateLimit-Limit"] = String(limitRes.limit);
                    set.headers["X-RateLimit-Remaining"] = String(limitRes.remaining);
                    set.headers["X-RateLimit-Reset"] = String(limitRes.resetAt);
                    set.headers["Retry-After"] = String(
                        limitRes.resetAt - Math.floor(Date.now() / 1000),
                    );

                    deps.metrics.logRequest(
                        url.pathname,
                        request.method,
                        429,
                        0,
                        ip,
                        userAgent,
                    );
                    return {
                        error: "Rate limit exceeded",
                        limit: limitRes.limit,
                        remaining: limitRes.remaining,
                        resetAt: limitRes.resetAt,
                    };
                }
            })

            // After Handle (Metrics)
            // biome-ignore lint/suspicious/noExplicitAny: Elysia Context types
            .onAfterHandle(({ request, set }: { request: Request; set: any }) => {
                const url = new URL(request.url);
                const ip = request.headers.get("CF-Connecting-IP") || "unknown";
                const userAgent = request.headers.get("User-Agent") || "";
                const status = set.status || 200;
                // deps.startTime is app start time, not request start time.
                // We don't have request start time passed easily here without context.
                // So passing 0 as in original code.
                deps.metrics.logRequest(
                    url.pathname,
                    request.method,
                    typeof status === "number" ? status : 200,
                    0,
                    ip,
                    userAgent,
                );
            })

            // Routes
            .get("/api_docs.html", ({ html }) => html(API_DOCS_HTML))

            .use(createEventRoutes(deps))
            .use(createMetricsRoutes(deps))
            .use(createHealthRoutes(deps))
            .use(createAdminRoutes(deps))
    );
};
