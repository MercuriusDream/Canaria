
export class WebRTCManager {
    private signaling: WebSocket | null = null;
    private peers: Map<string, RTCPeerConnection> = new Map();
    private dataChannels: Map<string, RTCDataChannel> = new Map();
    private onDataCallback: ((data: any, peerId: string) => void) | null = null;
    private connected: boolean = false;
    private readonly signalingUrl: string;

    constructor(signalingUrl: string = "/v1/ws/lobby") {
        this.signalingUrl = signalingUrl;
    }

    public connect() {
        if (this.connected) return;

        // Determine protocol (ws or wss)
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        const url = `${protocol}//${host}${this.signalingUrl}`;

        console.log(`[P2P] Connecting to signaling server: ${url}`);

        this.signaling = new WebSocket(url);

        this.signaling.onopen = () => {
            console.log("[P2P] Signaling connected");
            this.connected = true;
            this.requestPeers();
        };

        this.signaling.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                await this.handleSignalingMessage(msg);
            } catch (err) {
                console.error("[P2P] Signaling error", err);
            }
        };

        this.signaling.onclose = () => {
            console.log("[P2P] Signaling disconnected");
            this.connected = false;
            // Reconnect logic could go here
            setTimeout(() => this.connect(), 5000);
        };
    }

    public onData(callback: (data: any, peerId: string) => void) {
        this.onDataCallback = callback;
    }

    public broadcast(data: any) {
        const payload = JSON.stringify(data);
        for (const channel of this.dataChannels.values()) {
            if (channel.readyState === "open") {
                channel.send(payload);
            }
        }
    }

    private requestPeers() {
        if (this.signaling?.readyState === WebSocket.OPEN) {
            this.signaling.send(JSON.stringify({ type: "list-peers" }));
        }
    }

    private async handleSignalingMessage(msg: any) {
        switch (msg.type) {
            case "peer-list":
                for (const peerId of msg.peers) {
                    if (!this.peers.has(peerId)) {
                        this.initiateConnection(peerId);
                    }
                }
                break;

            case "signal":
                await this.handleSignal(msg.source, msg.payload);
                break;
        }
    }

    private async initiateConnection(peerId: string) {
        console.log(`[P2P] Initiating connection to ${peerId}`);
        const pc = this.createPeerConnection(peerId);

        // Create Data Channel
        const dc = pc.createDataChannel("mesh");
        this.setupDataChannel(dc, peerId);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        this.sendSignal(peerId, { type: "offer", sdp: offer });
    }

    private async handleSignal(peerId: string, payload: any) {
        if (!this.peers.has(peerId)) {
            // Inbound connection
            console.log(`[P2P] Inbound connection from ${peerId}`);
            if (payload.type === "offer") {
                const pc = this.createPeerConnection(peerId);
                // Data channel will be received via ondatachannel
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.sendSignal(peerId, { type: "answer", sdp: answer });
            }
        } else {
            // Existing connection
            const pc = this.peers.get(peerId)!;
            if (payload.type === "answer") {
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            } else if (payload.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            }
        }
    }

    private createPeerConnection(peerId: string): RTCPeerConnection {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        this.peers.set(peerId, pc);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(peerId, { candidate: event.candidate });
            }
        };

        pc.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, peerId);
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
                this.peers.delete(peerId);
                this.dataChannels.delete(peerId);
            }
        };

        return pc;
    }

    private setupDataChannel(dc: RTCDataChannel, peerId: string) {
        dc.onopen = () => {
            console.log(`[P2P] Data channel open with ${peerId}`);
            this.dataChannels.set(peerId, dc);
        };

        dc.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (this.onDataCallback) {
                    this.onDataCallback(data, peerId);
                }
            } catch (e) {
                console.error("Failed to parse p2p message", e);
            }
        };

        dc.onclose = () => {
            this.dataChannels.delete(peerId);
        };
    }

    private sendSignal(target: string, payload: any) {
        if (this.signaling?.readyState === WebSocket.OPEN) {
            this.signaling.send(JSON.stringify({
                type: "signal",
                target: target,
                payload: payload
            }));
        }
    }
}

export const webrtcManager = new WebRTCManager();
