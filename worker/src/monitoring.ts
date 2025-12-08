import { ConfigManager } from "./config";
import {
  HealthCheckResponse,
  EnhancedStatusSnapshot,
  Heartbeat,
  FeedState,
  DetailedMonitoringResponse,
  FeedConnectionDetails,
  ParserMetrics,
} from "./types";
import { EventStore } from "./storage";

export class HealthMonitor {
  private config: ConfigManager;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  checkHealth(parserHeartbeat: Heartbeat | null, feedStates: { wolfx: FeedState; p2p: FeedState }, store: EventStore): HealthCheckResponse {
    const parserHealthy = getHeartbeatAge(parserHeartbeat) < this.config.getParserTimeoutSeconds();
    const feedsHealthy = feedStates.wolfx.status === "connected" || feedStates.p2p.status === "connected";

    let databaseHealthy = true;
    try {
      store.count();
    } catch {
      databaseHealthy = false;
    }

    return {
      healthy: parserHealthy && feedsHealthy && databaseHealthy,
      checks: { parser: parserHealthy, feeds: feedsHealthy, database: databaseHealthy },
    };
  }

  getEnhancedStatus(
    parserHeartbeat: Heartbeat | null,
    feedStates: { wolfx: FeedState; p2p: FeedState },
    eventsStored: number,
    clientsConnected: number,
    lastStoredAt: string | null,
    store: EventStore,
  ): EnhancedStatusSnapshot {
    const heartbeatAge = getHeartbeatAge(parserHeartbeat);
    const kmaStatus = this.getKMAStatus(parserHeartbeat, heartbeatAge);
    const jmaStatus = this.getJMAStatus(feedStates);
    const overall = this.getOverallStatus(kmaStatus, jmaStatus);

    const latestEvent = store.latest();

    return {
      overall,
      sources: {
        KMA: {
          status: kmaStatus,
          lastEvent: latestEvent && latestEvent.source === "KMA" ? latestEvent.time : null,
          heartbeatAgeSeconds: heartbeatAge,
        },
        JMA: {
          status: jmaStatus,
          feeds: {
            wolfx: {
              connected: feedStates.wolfx.status === "connected",
              lastMessage: feedStates.wolfx.lastMessage,
              lastError: feedStates.wolfx.lastError,
            },
            p2p: {
              connected: feedStates.p2p.status === "connected",
              lastMessage: feedStates.p2p.lastMessage,
              lastError: feedStates.p2p.lastError,
            },
          },
        },
      },
      parser: parserHeartbeat,
      jmaFeeds: feedStates,
      stats: { eventsStored, clientsConnected, lastStoredAt },
    };
  }

  getDetailedMonitoring(
    parserHeartbeat: Heartbeat | null,
    feedStates: { wolfx: FeedState; p2p: FeedState },
    store: EventStore,
    clientsConnected: number,
    totalConnections: number,
    lastStoredAt: string | null,
    startTime: number,
    parserErrorHistory: Array<{ timestamp: string; error: string }>,
  ): DetailedMonitoringResponse {
    const heartbeatAge = getHeartbeatAge(parserHeartbeat);
    const kmaStatus = this.getKMAStatus(parserHeartbeat, heartbeatAge);
    const jmaStatus = this.getJMAStatus(feedStates);
    const overall = this.getOverallStatus(kmaStatus, jmaStatus);

    const uptime = Date.now() - startTime;
    const uptimeFormatted = formatUptime(uptime);

    const eventsBySource = {
      KMA: store.countBySource("KMA"),
      JMA: store.countBySource("JMA"),
    };
    const total = eventsBySource.KMA + eventsBySource.JMA;

    return {
      timestamp: new Date().toISOString(),
      system: {
        uptime,
        uptimeFormatted,
      },
      parser: {
        connected: heartbeatAge < this.config.getParserTimeoutSeconds(),
        lastParseTime: parserHeartbeat?.lastParseTime || null,
        lastEventTime: parserHeartbeat?.lastEventTime || null,
        lastHeartbeat: parserHeartbeat?.lastParseTime || null,
        heartbeatAgeSeconds: heartbeatAge === Infinity ? -1 : heartbeatAge,
        delayMs: parserHeartbeat?.delayMs || 0,
        error: parserHeartbeat?.error || null,
        metrics: this.buildParserMetrics(parserHeartbeat, parserErrorHistory),
      },
      feeds: {
        wolfx: this.buildFeedDetails(feedStates.wolfx, startTime),
        p2p: this.buildFeedDetails(feedStates.p2p, startTime),
      },
      clients: {
        websocketCount: clientsConnected,
        totalConnections,
      },
      events: {
        total,
        bySource: eventsBySource,
        lastStoredAt,
      },
      health: {
        overall,
        parser: kmaStatus,
        feeds: jmaStatus,
      },
    };
  }

  private buildFeedDetails(feedState: FeedState, startTime: number): FeedConnectionDetails {
    const now = Date.now();
    const connected = feedState.status === "connected";

    // Calculate current session uptime if connected
    let currentSessionUptime = 0;
    if (connected && feedState.connectedAt) {
      currentSessionUptime = now - new Date(feedState.connectedAt).getTime();
    }

    // Total uptime includes current session if connected
    let totalUptime = feedState.totalUptime;
    if (connected && feedState.connectedAt) {
      totalUptime += currentSessionUptime;
    }

    // Calculate uptime percentage since system start
    const systemUptime = now - startTime;
    const uptimePercent = systemUptime > 0 ? (totalUptime / systemUptime) * 100 : 0;

    return {
      status: feedState.status,
      connected,
      lastMessage: feedState.lastMessage,
      lastHeartbeat: feedState.lastHeartbeat,
      lastError: feedState.lastError,
      connectedAt: feedState.connectedAt,
      disconnectedAt: feedState.disconnectedAt,
      currentSessionUptime: Math.floor(currentSessionUptime / 1000), // seconds
      totalUptime: Math.floor(totalUptime / 1000), // seconds
      reconnectCount: feedState.reconnectCount,
      uptimePercent: Math.round(uptimePercent * 100) / 100, // 2 decimal places
    };
  }

  private buildParserMetrics(
    parserHeartbeat: Heartbeat | null,
    errorHistory: Array<{ timestamp: string; error: string }>,
  ): ParserMetrics | undefined {
    if (!parserHeartbeat?.stats) {
      return undefined;
    }

    const stats = parserHeartbeat.stats;
    const successRate = stats.totalParses > 0 ? (stats.successfulParses / stats.totalParses) * 100 : 0;

    return {
      totalParses: stats.totalParses,
      successfulParses: stats.successfulParses,
      failedParses: stats.failedParses,
      eventsIngested: stats.eventsIngested,
      successRate: Math.round(successRate * 100) / 100,
      averageDelayMs: Math.round(stats.averageDelayMs * 100) / 100,
      uptime: stats.uptime,
      uptimeFormatted: formatUptime(stats.uptime),
      recentErrors: errorHistory.slice(0, 5), // Return last 5 errors
    };
  }

  private getKMAStatus(parserHeartbeat: Heartbeat | null, heartbeatAge: number): "healthy" | "degraded" | "down" {
    if (!parserHeartbeat || heartbeatAge === Infinity) return "down";

    const timeout = this.config.getParserTimeoutSeconds();

    if (heartbeatAge < timeout) return "healthy";
    if (heartbeatAge < timeout * 2) return "degraded";
    return "down";
  }

  private getJMAStatus(feedStates: { wolfx: FeedState; p2p: FeedState }): "healthy" | "degraded" | "down" {
    const wolfxConnected = feedStates.wolfx.status === "connected";
    const p2pConnected = feedStates.p2p.status === "connected";

    if (wolfxConnected && p2pConnected) return "healthy";
    if (wolfxConnected || p2pConnected) return "degraded";
    return "down";
  }

  private getOverallStatus(kmaStatus: string, jmaStatus: string): "healthy" | "degraded" | "down" {
    if (kmaStatus === "down" && jmaStatus === "down") return "down";
    if (kmaStatus === "healthy" && jmaStatus === "healthy") return "healthy";
    return "degraded";
  }
}

function getHeartbeatAge(parserHeartbeat: Heartbeat | null): number {
  if (!parserHeartbeat) return Infinity;
  try {
    return Math.floor((Date.now() - new Date(parserHeartbeat.lastParseTime).getTime()) / 1000);
  } catch {
    return Infinity;
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
