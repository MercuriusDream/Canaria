
import { webrtcManager } from "./webrtc";
import { cryptoService } from "../crypto";
import type { SignedEvent, EventRecord } from "@canaria/types";

export class GossipService {
    private seen = new Set<string>();
    private onEventCallback: ((event: EventRecord) => void) | null = null;
    private primaryWs: WebSocket | null = null;

    init() {
        this.connectPrimary();
        webrtcManager.connect();
        webrtcManager.onData((data, peerId) => this.handleMessage(data, peerId));
    }

    private connectPrimary() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        const url = `${protocol}//${host}/v1/ws`;

        console.log(`[Gossip] Connecting to Primary WS: ${url}`);

        this.primaryWs = new WebSocket(url);

        this.primaryWs.onopen = () => {
            console.log("[Gossip] Connected to Primary WS");
        };

        this.primaryWs.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.signedEvents) {
                    // Batch of signed events from server
                    for (const envelope of data.signedEvents) {
                        await this.processEnvelope(envelope);
                    }
                } else if (data.event) {
                    // Unsigned event (legacy legacy?) or if server sends raw events
                    // We ignore unsigned events for P2P propagation, but display them?
                    // For now, focus on signed.
                }
            } catch (e) {
                console.error("WS parse error", e);
            }
        };

        this.primaryWs.onclose = () => {
            console.log("[Gossip] Primary WS disconnected");
            setTimeout(() => this.connectPrimary(), 5000);
        };
    }

    private async handleMessage(data: any, _source: string) {
        if (data.type === 'gossip') {
            await this.processEnvelope(data.envelope);
        }
    }

    private async processEnvelope(envelope: SignedEvent) {
        if (this.seen.has(envelope.signature)) return;

        const isValid = await cryptoService.verify(envelope);
        if (!isValid) {
            console.warn("Invalid signature blocked", envelope);
            return;
        }

        this.seen.add(envelope.signature);

        // Parse payload
        try {
            const event = cryptoService.parse(envelope);

            // Emit to UI
            if (this.onEventCallback) {
                this.onEventCallback(event);
            }

            // Propagate
            this.relay(envelope);
        } catch (e) {
            console.error("Failed to parse event payload", e);
        }
    }

    private relay(envelope: SignedEvent) {
        webrtcManager.broadcast({ type: 'gossip', envelope });
    }

    public onEvent(cb: (event: EventRecord) => void) {
        this.onEventCallback = cb;
    }
}

export const gossipService = new GossipService();
