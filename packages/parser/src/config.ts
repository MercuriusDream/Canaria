import type { ParserConfig } from "./types";

const DEFAULTS = {
  POLL_INTERVAL_MS: 5000,
  POLL_JITTER_MS: 500,
  KMA_TIMEOUT_MS: 3500,
  POST_TIMEOUT_MS: 3000,
  POST_RETRIES: 3,
};

export function loadConfig(): ParserConfig {
  const kmaApiKey = process.env.KMA_API_KEY || "";
  const workerEndpoint = process.env.WORKER_ENDPOINT || "";

  if (!kmaApiKey) {
    throw new Error("KMA_API_KEY is required");
  }

  if (!workerEndpoint) {
    throw new Error("WORKER_ENDPOINT is required");
  }

  const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || "", 10);
  const pollJitterMs = parseInt(process.env.POLL_JITTER_MS || "", 10);
  const kmaTimeoutMs = parseInt(process.env.KMA_TIMEOUT_MS || "", 10);
  const postTimeoutMs = parseInt(process.env.POST_TIMEOUT_MS || "", 10);
  const postRetries = parseInt(process.env.POST_RETRIES || "", 10);

  return {
    kmaApiKey,
    workerEndpoint: workerEndpoint.replace(/\/+$/, ""),
    pollIntervalMs: Number.isFinite(pollIntervalMs)
      ? pollIntervalMs
      : DEFAULTS.POLL_INTERVAL_MS,
    pollJitterMs: Number.isFinite(pollJitterMs)
      ? pollJitterMs
      : DEFAULTS.POLL_JITTER_MS,
    kmaTimeoutMs: Number.isFinite(kmaTimeoutMs)
      ? kmaTimeoutMs
      : DEFAULTS.KMA_TIMEOUT_MS,
    postTimeoutMs: Number.isFinite(postTimeoutMs)
      ? postTimeoutMs
      : DEFAULTS.POST_TIMEOUT_MS,
    postRetries: Number.isFinite(postRetries)
      ? postRetries
      : DEFAULTS.POST_RETRIES,
    eqkNowUrl: `https://apihub.kma.go.kr/api/typ01/url/eqk_now.php?disp=1&authKey=${encodeURIComponent(
      kmaApiKey,
    )}`,
  };
}
