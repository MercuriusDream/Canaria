
const PUBLIC_KEY_JWK = { "key_ops": ["verify"], "ext": true, "alg": "Ed25519", "crv": "Ed25519", "x": "pTRkHaM6w9vmetzPFEbcwrxjjCn1Kc_mLzfkuu-Iro8", "kty": "OKP" };

export class CryptoService {
    private key: CryptoKey | null = null;

    private async getPublicKey() {
        if (!this.key) {
            this.key = await window.crypto.subtle.importKey(
                "jwk",
                PUBLIC_KEY_JWK,
                { name: "Ed25519" },
                false,
                ["verify"]
            );
        }
        return this.key;
    }

    async verify(envelope: { payload: string, signature: string }): Promise<boolean> {
        try {
            const key = await this.getPublicKey();
            const signature = Uint8Array.from(atob(envelope.signature), c => c.charCodeAt(0));
            const data = new TextEncoder().encode(envelope.payload);

            const isValid = await window.crypto.subtle.verify(
                "Ed25519",
                key,
                signature,
                data
            );
            return isValid;
        } catch (e) {
            console.error("Verification failed", e);
            return false;
        }
    }

    parse(envelope: { payload: string }): any {
        return JSON.parse(envelope.payload);
    }
}

export const cryptoService = new CryptoService();
