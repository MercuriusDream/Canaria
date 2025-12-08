import { EventRecord } from "./types";

export function normalizeWolfxEvent(raw: any): EventRecord | null {
  if (!raw || typeof raw !== "object") return null;
  /* 
     WolfX JMA EEW payload (PascalCase) or internal snake_case
     Docs: https://api.wolfx.jp/
  */
  const rawTime = raw.time || raw.report_time || raw.origin_time || raw.AnnouncedTime || raw.OriginTime;
  if (!rawTime) return null;
  const time = normalizeTime(rawTime);

  // Try to find issue time, fallback to null if not distinct or available
  const rawIssueTime = raw.issue_time || raw.Issue?.Time || raw.report_time;
  const issueTime = rawIssueTime ? normalizeTime(rawIssueTime) : null;

  const latitude = numeric(raw.lat ?? raw.latitude ?? raw.Hypocenter?.Latitude);
  const longitude = numeric(raw.lon ?? raw.longitude ?? raw.Hypocenter?.Longitude);
  const magnitude = numeric(raw.mag ?? raw.magnitude ?? raw.Hypocenter?.Magnitude);
  const depth = numeric(raw.depth ?? raw.Hypocenter?.Depth);

  const eventId =
    raw.event_id ||
    raw.id ||
    raw.EventID ||
    buildSyntheticId("wolfx", time, latitude, longitude, magnitude);

  return {
    eventId,
    source: "JMA",
    type: "EEW",
    reportType: raw.alertlevel ?? raw.alertLevel ?? raw.Title ?? 111,
    time,
    issueTime,
    receiveTime: new Date().toISOString(),
    receiveSource: "WolfX",
    latitude,
    longitude,
    magnitude,
    depth,
    intensity: numeric(raw.max_intensity ?? raw.intensity ?? raw.MaxIntensity),
    region: raw.regionName || raw.region || raw.place || raw.Hypocenter?.AreaName || null,
    advisory: raw.notice || raw.text || null,
    revision: raw.isFinal ? "final" : (raw.Issue?.Status || null),
  };
}

export function normalizeP2pEvent(raw: any): EventRecord | null {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.code) return null;

  // Handle Code 9611 (Earthquake Perception/User Reports)
  if (raw.code === 9611) {
    const time = normalizeTime(raw.time || raw.created_at);
    // User reports typically don't have separate issue time vs origin time in the same way, usually just one timestamp
    const issueTime = raw.issue?.time ? normalizeTime(raw.issue.time) : time;

    return {
      eventId: raw.id || raw._id || buildSyntheticId("p2p", time, "9611"),
      source: "JMA",
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
      region: `User Reports: ${raw.count || 0}`,
      advisory: raw.confidence ? `Confidence: ${raw.confidence}` : null,
      revision: "final",
    };
  }

  const eq = raw.earthquake || {};
  const hypocenter = eq.hypocenter || {};
  const rawTime = raw.time || eq.time || raw.issue?.time;
  const time = normalizeTime(rawTime);

  const rawIssueTime = raw.issue?.time;
  const issueTime = rawIssueTime ? normalizeTime(rawIssueTime) : null;

  const latitude = numeric(hypocenter.latitude);
  const longitude = numeric(hypocenter.longitude);
  const magnitude = numeric(eq.magnitude);
  const depth = numeric(hypocenter.depth);

  // Use the top-level ID if available, otherwise fallbacks
  const eventId =
    raw.id ||
    raw.issue?.eventId ||
    raw.issue?.id ||
    buildSyntheticId("p2p", time, latitude, longitude, magnitude, raw.code, raw.issue?.serial);

  return {
    eventId,
    source: "JMA",
    type: raw.code === 551 ? "information" : String(raw.code),
    reportType: raw.code,
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
    advisory: raw?.tsunami ? String(raw.tsunami) : null,
    revision: raw.issue?.type || null,
  };
}

function numeric(value: any): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function buildSyntheticId(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  const normalized = parts
    .filter((p) => p !== null && p !== undefined && p !== "")
    .map((p) => String(p).replace(/\s+/g, "_"))
    .join("-");
  return `${prefix}-${normalized || Date.now()}`;
}

function normalizeTime(timeStr: any): string {
  if (!timeStr) return new Date().toISOString();
  if (typeof timeStr !== 'string') return new Date().toISOString(); // Fallback

  // If already ISO (contains T and Z or +), assume it's good (or try processing)
  if (timeStr.includes('T') && (timeStr.endsWith('Z') || timeStr.includes('+'))) {
    return timeStr;
  }

  // Handle "YYYY/MM/DD HH:mm:ss.SSS" or "YYYY/MM/DD HH:mm:ss"
  // JMA/P2P are usually JST (+09:00)
  let isoLike = timeStr.replace(/\//g, '-').replace(' ', 'T');

  // If no timezone offset, append +09:00
  if (!isoLike.includes('+') && !isoLike.endsWith('Z')) {
    isoLike += '+09:00';
  }

  const date = new Date(isoLike);
  if (isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}
