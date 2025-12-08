import { t } from "elysia";

export const EventSourceSchema = t.Union([t.Literal("KMA"), t.Literal("JMA")]);

export const EventRecordSchema = t.Object({
    eventId: t.String(),
    source: EventSourceSchema,
    type: t.String(),
    reportType: t.Nullable(t.Union([t.Number(), t.String()])),
    time: t.String(),
    issueTime: t.Nullable(t.String()),
    receiveTime: t.String(),
    receiveSource: t.String(),
    latitude: t.Nullable(t.Number()),
    longitude: t.Nullable(t.Number()),
    magnitude: t.Nullable(t.Number()),
    depth: t.Nullable(t.Number()),
    intensity: t.Nullable(t.Number()),
    region: t.Nullable(t.String()),
    advisory: t.Nullable(t.String()),
    revision: t.Nullable(t.String()),
});

export const HeartbeatSchema = t.Object({
    kmaConnection: t.Boolean(),
    lastParseTime: t.String(),
    lastEventTime: t.Nullable(t.String()),
    delayMs: t.Number(),
    error: t.Nullable(t.String()),
    stats: t.Optional(t.Object({
        totalParses: t.Number(),
        successfulParses: t.Number(),
        failedParses: t.Number(),
        eventsIngested: t.Number(),
        averageDelayMs: t.Number(),
        uptime: t.Number(),
    })),
});

export const IngestPayloadSchema = t.Object({
    heartbeat: t.Optional(HeartbeatSchema),
    events: t.Optional(t.Array(EventRecordSchema)),
});
