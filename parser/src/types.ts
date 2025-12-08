export type EventSource = "KMA";

export interface NormalizedEvent {
  source: EventSource;
  type: "domestic" | "international";
  reportType: number;
  eventId: string;
  time: string;
  issueTime: string | null;
  receiveTime: string;
  receiveSource: string;
  latitude: number | null;
  longitude: number | null;
  magnitude: number | null;
  depth: number | null;
  intensity: number | null;
  region: string | null;
  advisory: string | null;
  revision: string | null;
}

export interface Heartbeat {
  kmaConnection: boolean;
  lastParseTime: string;
  lastEventTime: string | null;
  delayMs: number;
  error: string | null;
  stats?: {
    totalParses: number;
    successfulParses: number;
    failedParses: number;
    eventsIngested: number;
    averageDelayMs: number;
    uptime: number;
  };
}

export interface ParserPayload {
  heartbeat: Heartbeat;
  events: NormalizedEvent[];
}

export interface ParserConfig {
  kmaApiKey: string;
  workerEndpoint: string;
  pollIntervalMs: number;
  pollJitterMs: number;
  kmaTimeoutMs: number;
  postTimeoutMs: number;
  postRetries: number;
  eqkNowUrl: string;
}
