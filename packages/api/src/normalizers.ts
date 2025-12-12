import type { EventRecord } from "@canaria/types";
import { z } from "zod";

// Schema for WolfX JMA EEW
const WolfXSchema = z
  .object({
    time: z.string().optional(),
    report_time: z.string().optional(),
    origin_time: z.string().optional(),
    AnnouncedTime: z.string().optional(),
    OriginTime: z.string().optional(),
    issue_time: z.string().optional(),
    Issue: z
      .object({
        Time: z.string().optional(),
        Status: z.string().optional(),
      })
      .optional(),
    lat: z.any().optional(), // Using any for numeric conversion helpers, strictly checked later
    latitude: z.any().optional(),
    Hypocenter: z
      .object({
        Latitude: z.any().optional(),
        Longitude: z.any().optional(),
        Magnitude: z.any().optional(),
        Depth: z.any().optional(),
        AreaName: z.string().optional(),
      })
      .optional(),
    lon: z.any().optional(),
    longitude: z.any().optional(),
    mag: z.any().optional(),
    magnitude: z.any().optional(),
    depth: z.any().optional(),
    event_id: z.string().optional(),
    id: z.string().optional(),
    EventID: z.string().optional(),
    alertlevel: z.any().optional(),
    alertLevel: z.any().optional(),
    Title: z.any().optional(),
    max_intensity: z.any().optional(),
    intensity: z.any().optional(),
    MaxIntensity: z.any().optional(),
    regionName: z.string().optional(),
    region: z.string().optional(),
    place: z.string().optional(),
    notice: z.string().optional(),
    text: z.string().optional(),
    isFinal: z.boolean().optional(),
  })
  .passthrough(); // Allow extra properties but valid ones must match

export function normalizeWolfxEvent(raw: unknown): EventRecord | null {
  const result = WolfXSchema.safeParse(raw);
  if (!result.success) return null;
  const data = result.data;

  /* 
     WolfX JMA EEW payload (PascalCase) or internal snake_case
     Docs: https://api.wolfx.jp/
  */
  const rawTime =
    data.time ||
    data.report_time ||
    data.origin_time ||
    data.AnnouncedTime ||
    data.OriginTime;
  if (!rawTime) return null;
  const time = normalizeTime(rawTime);

  // Try to find issue time, fallback to null if not distinct or available
  const rawIssueTime = data.issue_time || data.Issue?.Time || data.report_time;
  const issueTime = rawIssueTime ? normalizeTime(rawIssueTime) : null;

  const latitude = numeric(
    data.lat ?? data.latitude ?? data.Hypocenter?.Latitude,
  );
  const longitude = numeric(
    data.lon ?? data.longitude ?? data.Hypocenter?.Longitude,
  );
  const magnitude = numeric(
    data.mag ?? data.magnitude ?? data.Hypocenter?.Magnitude,
  );
  const depth = numeric(data.depth ?? data.Hypocenter?.Depth);

  const eventId =
    data.event_id ||
    data.id ||
    data.EventID ||
    buildSyntheticId("wolfx", time, latitude, longitude, magnitude);

  return {
    eventId,
    source: "JMA",
    type: "EEW",
    reportType: String(data.alertlevel ?? data.alertLevel ?? data.Title ?? 111),
    time,
    issueTime,
    receiveTime: new Date().toISOString(),
    receiveSource: "WolfX",
    latitude,
    longitude,
    magnitude,
    depth,
    intensity: numeric(
      data.max_intensity ?? data.intensity ?? data.MaxIntensity,
    ),
    region:
      data.regionName ||
      data.region ||
      data.place ||
      data.Hypocenter?.AreaName ||
      null,
    advisory: data.notice || data.text || null,
    revision: data.isFinal ? "final" : data.Issue?.Status || null,
  };
}

// Minimal schema for P2P basic validation
const P2PSchema = z
  .object({
    code: z.number(),
    time: z.string().optional(),
    created_at: z.string().optional(),
    issue: z
      .object({
        time: z.string().optional(),
        eventId: z.string().optional(),
        id: z.string().optional(),
        serial: z.string().optional(),
        type: z.string().optional(),
      })
      .optional(),
    id: z.string().optional(),
    _id: z.string().optional(),
    count: z.number().optional(),
    confidence: z.number().optional(),
    areas: z
      .array(
        z.object({
          peer: z.number().optional(),
        }),
      )
      .optional(),
    earthquake: z
      .object({
        time: z.string().optional(),
        magnitude: z.any().optional(),
        maxScale: z.any().optional(),
        hypocenter: z
          .object({
            latitude: z.any().optional(),
            longitude: z.any().optional(),
            depth: z.any().optional(),
            name: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    tsunami: z.any().optional(),
  })
  .passthrough();

export function normalizeP2pEvent(raw: unknown): EventRecord | null {
  const result = P2PSchema.safeParse(raw);
  if (!result.success) return null;
  const data = result.data;

  // Handle Code 9611 (Earthquake Perception/User Reports)
  if (data.code === 9611) {
    const time = normalizeTime(data.time || data.created_at);
    // User reports typically don't have separate issue time vs origin time in the same way, usually just one timestamp
    const issueTime = data.issue?.time ? normalizeTime(data.issue.time) : time;

    return {
      eventId: data.id || data._id || buildSyntheticId("p2p", time, "9611"),
      source: "P2PQUAKE",
      type: "UserReport",
      reportType: 9611,
      time,
      issueTime,
      receiveTime: new Date().toISOString(),
      receiveSource: "P2P",
      latitude: null, // User reports don't have a single epicenter
      longitude: null,
      magnitude: null,
      depth: null,
      intensity: null,
      region: `User Reports: ${data.count || 0}`,
      advisory: data.confidence ? `Confidence: ${data.confidence}` : null,
      revision: "final",
    };
  }

  // Handle Code 555 (EEW Detection / User Reports)
  if (data.code === 555) {
    const time = normalizeTime(data.time);
    const areas = Array.isArray(data.areas) ? data.areas : [];
    const areaCount = areas.length;
    const totalPeers = areas.reduce(
      (acc: number, curr) => acc + (Number(curr.peer) || 0),
      0,
    );

    return {
      eventId: data.id || data._id || buildSyntheticId("p2p", time, "555"),
      source: "P2PQUAKE",
      type: "EEWDetection",
      reportType: 555,
      time,
      issueTime: time, // 555 usually lacks a separate issue time, use origin/detect time
      receiveTime: new Date().toISOString(),
      receiveSource: "P2P",
      latitude: null,
      longitude: null,
      magnitude: null,
      depth: null,
      intensity: null, // Could potentially infer from max peer count but that's unreliable
      region: `Detected in ${areaCount} area${areaCount === 1 ? "" : "s"} (Total peers: ${totalPeers})`,
      advisory: null,
      revision: "final",
    };
  }

  const eq = data.earthquake || {};
  const hypocenter = eq.hypocenter || {};
  const rawTime = data.time || eq.time || data.issue?.time;
  const time = normalizeTime(rawTime);

  const rawIssueTime = data.issue?.time;
  const issueTime = rawIssueTime ? normalizeTime(rawIssueTime) : null;

  const latitude = numeric(hypocenter.latitude);
  const longitude = numeric(hypocenter.longitude);
  const magnitude = numeric(eq.magnitude);
  const depth = numeric(hypocenter.depth);

  // Use the top-level ID if available, otherwise fallbacks
  const eventId =
    data.id ||
    data.issue?.eventId ||
    data.issue?.id ||
    buildSyntheticId(
      "p2p",
      time,
      latitude,
      longitude,
      magnitude,
      data.code,
      data.issue?.serial,
    );

  return {
    eventId,
    source: "P2PQUAKE",
    type: data.code === 551 ? "information" : String(data.code),
    reportType: data.code,
    time,
    issueTime,
    receiveTime: new Date().toISOString(),
    receiveSource: "P2P",
    latitude,
    longitude,
    magnitude,
    depth,
    intensity: numeric(eq.maxScale),
    region: hypocenter.name || null,
    advisory: data.tsunami ? String(data.tsunami) : null,
    revision: data.issue?.type || null,
  };
}

function numeric(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function buildSyntheticId(
  prefix: string,
  ...parts: Array<string | number | null | undefined>
): string {
  const normalized = parts
    .filter((p) => p !== null && p !== undefined && p !== "")
    .map((p) => String(p).replace(/\s+/g, "_"))
    .join("-");
  return `${prefix}-${normalized || Date.now()}`;
}

function normalizeTime(timeStr: unknown): string {
  if (!timeStr) return new Date().toISOString();
  if (typeof timeStr !== "string") return new Date().toISOString(); // Fallback

  // If already ISO (contains T and Z or +), assume it's good (or try processing)
  if (
    timeStr.includes("T") &&
    (timeStr.endsWith("Z") || timeStr.includes("+"))
  ) {
    return timeStr;
  }

  // Handle "YYYY/MM/DD HH:mm:ss.SSS" or "YYYY/MM/DD HH:mm:ss"
  // JMA/P2P are usually JST (+09:00)
  let isoLike = timeStr.replace(/\//g, "-").replace(" ", "T");

  // If no timezone offset, append +09:00
  if (!isoLike.includes("+") && !isoLike.endsWith("Z")) {
    isoLike += "+09:00";
  }

  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}
