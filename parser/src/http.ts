import { ParserPayload } from "./types";

export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

interface PostOptions {
  timeoutMs: number;
  retries: number;
}

export async function postJsonWithRetry(
  url: string,
  payload: ParserPayload,
  { timeoutMs, retries }: PostOptions,
): Promise<any | null> {
  const body = JSON.stringify(payload);

  for (let attempt = 0; attempt <= retries; attempt++) {
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);

      const result = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });

      if (result.ok) {
        // Try to parse JSON response if available, otherwise return empty object indicating success
        // The worker might return 204 No Content
        if (result.status === 204) return {};
        try {
          return await result.json();
        } catch {
          return {};
        }
      }
    } catch (error) {
      if (attempt === retries) {
        break;
      }
    }
    finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    const backoff = Math.min(2 ** attempt * 500, 4000);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  return null;
}
