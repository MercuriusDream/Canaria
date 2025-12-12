
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerConfig {
    failureThreshold: number;
    resetTimeoutMs: number;
}

export class CircuitBreaker {
    private state: CircuitState = "CLOSED";
    private failures = 0;
    private lastFailureTime = 0;
    private readonly config: CircuitBreakerConfig;

    constructor(config: CircuitBreakerConfig = { failureThreshold: 3, resetTimeoutMs: 10000 }) {
        this.config = config;
    }

    public recordSuccess(): void {
        this.failures = 0;
        this.state = "CLOSED";
    }

    public recordFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.config.failureThreshold) {
            this.state = "OPEN";
        }
    }

    public getState(): CircuitState {
        if (this.state === "OPEN") {
            const now = Date.now();
            if (now - this.lastFailureTime >= this.config.resetTimeoutMs) {
                this.state = "HALF_OPEN";
            }
        }
        return this.state;
    }

    public isOpen(): boolean {
        return this.getState() === "OPEN";
    }
}
