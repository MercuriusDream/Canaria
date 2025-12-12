import type { Env } from "./durable-object";

// --- Worker Entry Point (Elysia) ---
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/v1/ws/lobby")) {
      const id = env.LOBBY_DO.idFromName("hub");
      const stub = env.LOBBY_DO.get(id);
      return stub.fetch(request);
    }

    const id = env.CANARIA_DO.idFromName("singleton");
    const stub = env.CANARIA_DO.get(id);
    return stub.fetch(request);
  },
};

export { Lobby } from "./lobby";
export { CanariaSqlDurableObject } from "./durable-object";
export type { Env };
