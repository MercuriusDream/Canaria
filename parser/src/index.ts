import { loadConfig } from "./config";
import { RecentEventCache } from "./dedup";
import { fetchWithTimeout, postJsonWithRetry } from "./http";
import { parseKmaEqkNowResponse } from "./kmaParser";
import { Heartbeat, NormalizedEvent, ParserPayload } from "./types";

interface LoopState {
  lastEventId: string | null;
  cache: RecentEventCache;
}

interface ParserStats {
  totalParses: number;
  successfulParses: number;
  failedParses: number;
  eventsIngested: number;
  totalDelayMs: number;
  startTime: number;
}

const config = loadConfig();
const state: LoopState = {
  lastEventId: null,
  cache: new RecentEventCache(5),
};

const stats: ParserStats = {
  totalParses: 0,
  successfulParses: 0,
  failedParses: 0,
  eventsIngested: 0,
  totalDelayMs: 0,
  startTime: Date.now(),
};

async function pollOnce(): Promise<void> {
  const startedAt = Date.now();
  let kmaConnection = false;
  let error: string | null = null;
  let parsedEvent: NormalizedEvent | null = null;

  stats.totalParses++;

  try {
    const response = await fetchWithTimeout(withTimestamp(config.eqkNowUrl), config.kmaTimeoutMs);
    if (!response.ok) {
      throw new Error(`KMA responded with ${response.status}`);
    }
    const raw = await response.text();
    const { event, warning } = parseKmaEqkNowResponse(raw);
    kmaConnection = true;
    stats.successfulParses++;

    if (warning) {
      console.warn("[parser] KMA warning:", warning);
    }

    if (event && state.cache.record(event.eventId)) {
      parsedEvent = event;
      state.lastEventId = event.eventId;
      stats.eventsIngested++;
      console.log("[parser] New KMA event", event.eventId);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    stats.failedParses++;
    console.error("[parser] Failed to poll KMA:", error);
  }

  const delayMs = Date.now() - startedAt;
  stats.totalDelayMs += delayMs;

  const heartbeat: Heartbeat = {
    kmaConnection,
    lastParseTime: new Date().toISOString(),
    lastEventTime: parsedEvent?.time ?? null,
    delayMs,
    error: kmaConnection ? null : error,
    stats: {
      totalParses: stats.totalParses,
      successfulParses: stats.successfulParses,
      failedParses: stats.failedParses,
      eventsIngested: stats.eventsIngested,
      averageDelayMs: stats.totalParses > 0 ? stats.totalDelayMs / stats.totalParses : 0,
      uptime: Date.now() - stats.startTime,
    },
  };

  const payload: ParserPayload = {
    heartbeat,
    events: parsedEvent ? [parsedEvent] : [],
  };

  const ok = await postJsonWithRetry(config.workerEndpoint + "/v1/events", payload, {
    timeoutMs: config.postTimeoutMs,
    retries: config.postRetries,
  });

  if (!ok) {
    console.error("[parser] Failed to deliver payload after retries");
  }
}

function withTimestamp(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("tm", Date.now().toString());
  return url.toString();
}

function scheduleNext(): void {
  const jitter = (Math.random() - 0.5) * 2 * config.pollJitterMs;
  const delay = Math.max(1000, config.pollIntervalMs + jitter);
  setTimeout(async () => {
    await pollOnce();
    scheduleNext();
  }, delay);
}

async function start(): Promise<void> {
  console.log("[parser] Starting KMA poller with interval", config.pollIntervalMs, "ms");
  await pollOnce();
  scheduleNext();
}

start().catch((err) => {
  console.error("[parser] Fatal error", err);
});
