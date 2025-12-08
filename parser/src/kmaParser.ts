import { NormalizedEvent } from "./types";

interface ParseResult {
  event: NormalizedEvent | null;
  rawLine?: string;
  warning?: string;
}

const HEADER_PREFIX = /^TP\b/i;

export function parseKmaEqkNowResponse(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (!lines.length) {
    return { event: null, warning: "No data lines returned" };
  }

  const dataLines = lines.filter((line) => !HEADER_PREFIX.test(line));
  const targetLine = dataLines.length ? dataLines[dataLines.length - 1] : lines[lines.length - 1];
  const parts = targetLine.split(",").map((p) => p.trim());

  if (parts.length < 11) {
    return { event: null, rawLine: targetLine, warning: "Unexpected column count" };
  }

  const [TP, TM_FC, SEQ, TM_EQK, MSC, MT, LAT, LON, LOC, INT, REM, COR] = parts;

  const time = parseKmaTimestamp(TM_EQK, MSC);
  if (!time) {
    return { event: null, rawLine: targetLine, warning: "Invalid timestamp" };
  }

  // TM_FC is usually YYYYMMDDHHMM (12 digits) or similar KMA timestamp format
  const issueTime = parseKmaTimestamp(TM_FC) || time; // Fallback to event time if issue time missing

  const latitude = parseFloatSafe(LAT);
  const longitude = parseFloatSafe(LON);
  const magnitude = parseFloatSafe(MT);
  const intensity = parseIntSafe(INT);

  const event: NormalizedEvent = {
    source: "KMA",
    type: TP === "3" ? "domestic" : "international",
    reportType: parseIntSafe(TP) ?? 0,
    eventId: `${TM_FC}-${SEQ}`.trim(),
    time,
    issueTime,
    receiveTime: new Date().toISOString(),
    receiveSource: "KMA",
    latitude,
    longitude,
    magnitude,
    depth: null,
    intensity,
    region: LOC?.trim() || null,
    advisory: REM?.trim() || null,
    revision: COR?.trim() || null,
  };

  return { event, rawLine: targetLine };
}

function parseKmaTimestamp(tmEqk: string, msc?: string): string | null {
  const sanitized = (tmEqk || "").trim();
  if (!/^\d{14}$/.test(sanitized)) return null;

  const year = Number(sanitized.slice(0, 4));
  const month = Number(sanitized.slice(4, 6)) - 1;
  const day = Number(sanitized.slice(6, 8));
  const hour = Number(sanitized.slice(8, 10));
  const minute = Number(sanitized.slice(10, 12));
  const second = Number(sanitized.slice(12, 14));

  const millis = Math.floor(parseFloatSafe(msc) ?? 0);
  const date = new Date(Date.UTC(year, month, day, hour - 9, minute, second, millis));
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function parseFloatSafe(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}
