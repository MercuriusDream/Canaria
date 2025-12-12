import { z } from "zod";

export const EventSourceSchema = z.union([
  z.literal("KMA"),
  z.literal("JMA"),
  z.literal("P2PQUAKE"),
]);

export type EventSource = z.infer<typeof EventSourceSchema>;

export const EventRecordSchema = z.object({
  eventId: z.string(),
  source: EventSourceSchema,
  type: z.string(),
  reportType: z.nullable(z.union([z.number(), z.string()])),
  time: z.string(), // Event origin time
  issueTime: z.nullable(z.string()), // When the report was issued by authority
  receiveTime: z.string(), // When Canaria received/ingested the data
  receiveSource: z.string(), // Specific source (WolfX, P2P, KMA)
  latitude: z.nullable(z.number()),
  longitude: z.nullable(z.number()),
  magnitude: z.nullable(z.number()),
  depth: z.nullable(z.number()),
  intensity: z.nullable(z.number()),
  region: z.nullable(z.string()),
  advisory: z.nullable(z.string()),
  revision: z.nullable(z.string()),
});

export type EventRecord = z.infer<typeof EventRecordSchema>;

export const HeartbeatSchema = z.object({
  kmaConnection: z.boolean(),
  lastParseTime: z.string(),
  lastEventTime: z.nullable(z.string()),
  delayMs: z.number(),
  error: z.nullable(z.string()),
  stats: z.optional(
    z.object({
      totalParses: z.number(),
      successfulParses: z.number(),
      failedParses: z.number(),
      eventsIngested: z.number(),
      averageDelayMs: z.number(),
      uptime: z.number(),
    }),
  ),
});

export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const IngestPayloadSchema = z.object({
  heartbeat: z.optional(HeartbeatSchema),
  events: z.optional(z.array(EventRecordSchema)),
});

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

// Internal feed state schemas
export const FeedStateSchema = z.object({
  status: z.union([
    z.literal("connecting"),
    z.literal("connected"),
    z.literal("disconnected"),
  ]),
  lastMessage: z.nullable(z.string()),
  lastError: z.nullable(z.string()),
  connectedAt: z.nullable(z.string()),
  disconnectedAt: z.nullable(z.string()),
  reconnectCount: z.number(),
  totalUptime: z.number(),
  lastHeartbeat: z.nullable(z.string()),
});

export type FeedState = z.infer<typeof FeedStateSchema>;

export const SignedEventSchema = z.object({
  payload: z.string(),
  signature: z.string(),
  timestamp: z.number(),
});

export type SignedEvent = z.infer<typeof SignedEventSchema>;
