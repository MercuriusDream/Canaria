# Canaria

A lightweight, real-time earthquake early warning system that aggregates data from multiple sources (KMA, JMA, WolfX EEW, P2PQuake) and delivers alerts via REST API and WebSocket connections.

## Overview

This system consists of two main components:

- **Parser**: A Bun/TypeScript service that polls the KMA (Korea Meteorological Administration) earthquake feed, normalizes events, and forwards them to the worker with heartbeat monitoring
- **Worker**: A Cloudflare Worker with Durable Objects that ingests data from the parser, monitors JMA earthquake feeds, stores events in SQLite, and exposes real-time data via REST and WebSocket APIs

## Features

- Multi-source earthquake data aggregation (KMA, JMA, WolfX EEW, P2PQuake)
- Real-time WebSocket streaming with automatic reconnection
- SQLite-backed event storage with deduplication
- Automatic feed monitoring with exponential backoff
- Heartbeat monitoring for parser health checks
- Globally distributed via Cloudflare's edge network
- ElysiaJS cuz Elysia-chan cute

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled
- KMA API key (for Korean earthquake data)

## Getting Started

### Step 1: Deploy the Worker

1. **Navigate to the worker directory**
   ```bash
   cd worker
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure deployment settings** (optional)

   Edit `wrangler.toml` to customize your worker name or account bindings

4. **Test locally**
   ```bash
   bunx wrangler dev
   ```

   The worker will be available at `http://localhost:8787`

5. **Deploy to Cloudflare**
   ```bash
   bunx wrangler deploy
   ```

   This applies the `v2-sqlite` migration to enable SQLite storage in the Durable Object

6. **Verify deployment**
   ```bash
   curl https://<your-worker-url>/v1/status
   ```

   You should see feed states and event counts

### Step 2: Run the Parser

1. **Navigate to the parser directory**
   ```bash
   cd parser
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure environment variables**

   Create a `.env` file or set the following variables:

   | Variable | Description | Required | Default |
   |----------|-------------|----------|---------|
   | `KMA_API_KEY` | KMA authentication key | Yes | - |
   | `WORKER_ENDPOINT` | Base URL of deployed worker | Yes | - |
   | `POLL_INTERVAL_MS` | Polling interval in milliseconds | No | 5000 |
   | `POLL_JITTER_MS` | Random jitter to add to polling | No | 500 |
   | `KMA_TIMEOUT_MS` | KMA API request timeout | No | 3500 |
   | `POST_TIMEOUT_MS` | Worker POST request timeout | No | 3000 |
   | `POST_RETRIES` | Number of retries for failed POSTs | No | 3 |

4. **Start the parser**
   ```bash
   bun run src/index.ts
   ```

   The parser will poll KMA every ~5 seconds and forward events to the worker

## API Reference

### Endpoints

| Method | Endpoint | Description | Parameters |
|--------|----------|-------------|------------|
| `POST` | `/v1/events` | Ingest events and heartbeats from parser | Body: Event/heartbeat payload |
| `GET` | `/v1/events/latest` | Retrieve the most recent earthquake event | - |
| `GET` | `/v1/events` | List earthquake events with filters | `since`, `until`, `limit`, `source`, `type` |
| `GET` | `/v1/status` | Get system status and feed health | - |
| `GET` | `/v1/ws` | WebSocket connection for real-time updates | - |

### Query Parameters

#### `GET /v1/events`

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `since` | ISO 8601 | Filter events after this timestamp | - |
| `until` | ISO 8601 | Filter events before this timestamp | - |
| `limit` | integer | Maximum number of events to return | 20 |
| `source` | string | Filter by source (e.g., `kma`, `jma`) | - |
| `type` | string | Filter by event type | - |

### WebSocket Protocol

Connect to `/v1/ws` to receive real-time earthquake events:

1. On connection, receives the latest event immediately
2. Receives new events as they arrive from any source
3. Periodic ping frames maintain connection health
4. Automatically handles reconnection with exponential backoff

## Architecture

The system follows a distributed architecture:

**Parser (Bun/TypeScript)**
- Polls KMA earthquake API
- Normalizes event data
- Sends heartbeats and events via HTTP

**Worker (Cloudflare Edge)**
- Receives data from parser
- Monitors JMA feeds (WolfX EEW, P2PQuake) via WebSocket
- Stores events in SQLite (Durable Object)
- Serves REST API endpoints
- Broadcasts real-time updates to WebSocket clients

**Data Flow**
1. Parser polls KMA API → sends to Worker
2. Worker receives JMA feeds → stores in SQLite
3. Clients query REST API or subscribe to WebSocket stream

## Implementation Details

### Parser
- **Timeouts**: Per-request timeouts for reliability
- **Scheduling**: Jittered polling to avoid thundering herd
- **Parsing**: Multi-line and header-tolerant KMA response parsing
- **Deduplication**: LRU cache suppresses duplicate events across restarts

### Worker
- **Modular Design**: Separated validation, feeds, storage, and client management
- **Feed Connectors**: WebSocket clients with exponential backoff and inactivity timeouts
- **Data Integrity**: `INSERT OR IGNORE` prevents duplicate events
- **SQLite Storage**: Enabled via `v2-sqlite` migration
- **Broadcasting**: Efficient WebSocket fan-out with keepalive pings

## Development

### Local Testing

1. **Start the worker in dev mode**
   ```bash
   cd worker && bunx wrangler dev
   ```

2. **In a separate terminal, start the parser**
   ```bash
   cd parser && bun run src/index.ts
   ```

3. **Test the API**
   ```bash
   # Check system status
   curl http://localhost:8787/v1/status

   # Get latest event
   curl http://localhost:8787/v1/events/latest

   # Stream events via WebSocket
   websocat ws://localhost:8787/v1/ws
   ```

### Migrations

When pulling updates, ensure database migrations are applied:

```bash
bunx wrangler deploy
```
