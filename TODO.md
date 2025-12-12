# Canaria - Engineering Master Plan (Architectural Specification)

*A survival-grade engineering roadmap. Prioritizes sovereignty, performance, and resilience. This document serves as the technical requirements specification.*

---

## Phase 1: Codebase Hygiene & Standardization
*Objective: Eliminate technical debt through strict architectural constraints and automated enforcement.*

### 1.1. AST-Based Static Analysis & Formatting
*Rationale: Ensure code consistency and correctness without performance bottlenecks using native tooling.*
- **Detailed Chain of Works**:
    1.  **Unified Toolchain Adoption**:
        -   Replace disparate Node.js-based parsers with a single, high-performance Rust-based engine (Biome).
        -   *Requirement*: The toolchain must perform linting, formatting, and dependency analysis in a single AST pass to ensure CI speeds <10s.
    2.  **Strict Rule Configuration**:
        -   **Import Sorting**: Enforce a deterministic module loading order (Built-ins -> External -> Internal). This prevents initialization side-effects in bundled environments.
        -   **Variable Hygiene**: Enforce "Zero Tolerance" for unused variables to prevent logic rot and memory leaks.
        -   **Type Safety**: Prohibit untyped data structures (`any`). All data flows must be explicitly typed, especially for untrusted ingress points.
    3.  **Automated Enforcement**:
        -   Implement a CI gate that blocks any code merging which generates warnings.
        -   Adhere to a "Fix-on-Save" philosophy where the tooling automatically corrects safe semantic issues (indentation, quoting, ordering).

### 1.2. Architecture Graph Integrity
*Rationale: Maintain a Directed Acyclic Graph (DAG) for module dependencies to ensure testability and tree-shaking.*
- **Detailed Chain of Works**:
    1.  **Dead Code Elimination Strategy**:
        -   Implement a system to scan the project's dependency graph starting from production entry points.
        -   *Requirement*: Any export not reachable from `main.ts` or `index.ts` must be flagged for removal to minimize bundle size.
        -   *Requirement*: Identify and purge "Ghost Dependencies" listed in configuration files but never imported.
    2.  **Circular Dependency Resolution**:
        -   Audit the codebase for import cycles (Module A <-> Module B).
        -   **Architectural Pattern**: Apply "dependency inversion" or "shared interface extraction". Move shared types and utilities to leaf-node modules that depend on nothing, ensuring a strictly unidirectional flow of control.
    3.  **Boundary Enforcement**:
        -   Define strict schemas (e.g., Zod) for all external data boundaries. Compile-time types must be inferred directly from these runtime validators to prevent type drift.

---

## Phase 2: Frontend Architecture (The Autonomous Agent)
*Objective: The Frontend must function as a sovereign agent, decoupled from the Backend's lifecycle.*

Use React or sum

### 2.1. Atomic Deployment Architecture
*Rationale: Preventing contract drift between client and server during independent deploy cycles.*
- **Detailed Chain of Works**:
    1.  **Workspace Isolation**:
        -   Structure the repository into distinct packages (Workspaces) for `api`, `web`, and `types`.
        -   *Requirement*: The `types` package serves as the immutable Single Source of Truth (SSoT). Both Client and Server must import interfaces from this shared package.
    2.  **Independent Build Pipelines**:
        -   Configure the deployment pipeline to build and ship the `web` package atomically.
        -   Ensure that a frontend deployment does not trigger a backend tear-down, preserving active WebSocket connections for other clients.

### 2.2. Offline-First "App Shell" Strategy
*Rationale: The application must load instantly (Time-to-Interactive < 50ms) regardless of network conditions.*
- **Detailed Chain of Works**:
    1.  **Hybrid Caching Strategy**:
        -   **Static Assets (Shell)**: Implement a "Cache-First" strategy. The HTML, JS, and CSS bundles are served immediately from the device's Cache Storage.
        -   **Dynamic Content (Data)**: Implement "Stale-While-Revalidate". The UI immediately renders the last known disaster data while asynchronously attempting to fetch updates.
    2.  **Lifecycle Management (Update Flow)**:
        -   Implement a manual update mechanism. The Service Worker must *wait* in a standby state when a new version is downloaded.
        -   *UX Pattern*: user is notified via a Toast interface ("Update Available"). The update is only applied (and the page reloaded) upon explicit user confirmation, preventing disruption of critical tasks during an emergency.
    3.  **Native Integration (Manifest)**:
        -   Configure the Web App Manifest to instruct the OS to treat the site as a standalone application (removing browser chrome) and reserve system resources.

### 2.3. High-Performance Geospatial Rendering
*Rationale: visualizing 10,000+ data points on mobile hardware without freezing the main thread.*
- **Detailed Chain of Works**:
    1.  **Canvas-Based Rasterization**:
        -   Bypass the DOM entirely for map markers. Use a rendering engine that draws points as pixels on a single HTML5 `<canvas>` layer.
        -   *Requirement*: Rendering must maintain 60fps scroll performance even with 10k active points.
    2.  **Spatial Indexing (Clustering)**:
        -   Implement a KD-Tree spatial index on the client side.
        -   *Logic*: Dynamically aggregate points into "clusters" based on the current viewport zoom level and bounding box. Do not attempt to render points that are occluded or clustered.
    3.  **Visual Trust Hierarchy**:
        -   Implement strict visual separation between data sources. Official data must be rendered on the highest Z-index layer with high-contrast styling. Unverified P2P data must be visually distinct (e.g., translucent, pulsing) to imply volatility.

---

## Phase 3: Infrastructure & Reliability (Assume Breach)
*Objective: The system must degrade gracefully when the primary cloud provider is offline.*

### 3.1. Client-Side Circuit Breaker
*Rationale: Availability decisions must be made by the client, as DNS failover is too slow.*
- **Detailed Chain of Works**:
    1.  **Failure State Detection**:
        -   Implement a Finite State Machine (FSM) in the API client: `CLOSED` (Normal), `OPEN` (Failed), `HALF-OPEN` (Recovering).
        -   *Logic*: Transition to `OPEN` state if the Primary API returns 5xx errors or times out for *n* consecutive requests.
    2.  **Automatic Failover Routing**:
        -   When in `OPEN` state, instantly reroute all read requests to the pre-configured Static Backup Endpoint.
        -   Disable "Write" operations or queue them locally (Store-and-Forward) until connectivity is restored.
    3.  **Heuristic Recovery**:
        -   While using the backup, spawn a background "Health Check" process that pings the Primary API at extended intervals.
        -   automatically revert to `CLOSED` state only after a sustained period of stability.

### 3.2. Asynchronous Dual-Write Consistency
*Rationale: Ensure the backup is rarely more than a few seconds behind the primary.*
- **Detailed Chain of Works**:
    1.  **Non-Blocking Persistence**:
        -   Decouple the API response from the backup persistence task.
        -   *Pattern*: Upon receiving data, the Edge Worker returns "Accepted" to the client immediately. The backup write operation (to Object Storage) continues in the background, managed by the runtime's "Wait Until" capability.
    2.  **Static Projection**:
        -   The backup data must be stored as a pre-computed JSON projection. This allows it to be served by any "dumb" static file host (Object Storage, CDN) without requiring server-side logic or database queries.

---

## Phase 4: The Moonshot (Decentralized Mesh)
*Objective: Enable peer-to-peer data propagation when the global internet is severed.*

### 4.1. Randomized Lobby Discovery
*Rationale: Bootstrap P2P connections using stateful edge objects without creating a central bottleneck. maybe Bittorrent or IRC*
- **Detailed Chain of Works**:
    1.  **Stateful Edge Lobbies**:
        -   Deploy stateful containers (Durable Objects) to act as ephemeral rendezvous points.
        -   *Topology*: Map these instances to randomized groups of *n* peers rather than fixed geographic regions to prevent hotspots.
    2.  **Random Walk Signaling**:
        -   Implement a "Random Walk" discovery algorithm. When a peer connects, the Lobby provides a random subset of other currently connected Peer IDs.
        -   Peers initiate standard WebRTC Signaling (SDP Offer/Answer) with these random contacts to form an unstructured mesh graph.
    3.  **Ephemeral Lifecycle**:
        -   Once a peer has established sufficient P2P connections, it must disconnect from the Lobby. This ensures the Lobby system is only used for bootstrapping and does not become a permanent dependency.

### 4.2. Cryptographic Trust (Secure Scuttlebutt Model)
*Rationale: In a trustless network, trust the data's signature, not the peer relaying it.*
- **Detailed Chain of Works**:
    1.  **Authority Identity Management**:
        -   Generate a high-entropy Ed25519 keypair for the central authority.
        -   Embed the Public Key directly into the client application code, ensuring offline verification capability.
    2.  **Digital Signature Envelope**:
        -   Wrap all critical alerts in a cryptographic envelope: `{ payload, signature, timestamp }`.
        -   *Requirement*: The backend acts as the sole signer. No client can generate valid functionality-critical alerts.
    3.  **Zero-Trust Verification**:
        -   Implement strict signature verification using the browser's Web Crypto API (`SubtleCrypto`).
        -   *Policy*: Any message with a missing or invalid signature is strictly discarded. It is never displayed and never propagated to other peers.
    4.  **Rumor Mongering Protocol**:
        -   Implement an epidemic gossip protocol. Peers periodically exchange "Vector Clocks" or "Bloom Filters" representing their knowledge state to identify and fetch missing distinct alerts efficiently.
