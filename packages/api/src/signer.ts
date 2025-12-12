const PRIVATE_KEY_JWK = {
  key_ops: ["sign"],
  ext: true,
  alg: "Ed25519",
  crv: "Ed25519",
  d: "cJKVaNJt4PiObVc8wE3rtcHMBf8xQs76dkXuXKaCpkM",
  x: "pTRkHaM6w9vmetzPFEbcwrxjjCn1Kc_mLzfkuu-Iro8",
  kty: "OKP",
};

export class Signer {
  private key: CryptoKey | null = null;

  private async getPrivateKey() {
    if (!this.key) {
      this.key = await crypto.subtle.importKey(
        "jwk",
        PRIVATE_KEY_JWK,
        { name: "Ed25519" },
        false,
        ["sign"],
      );
    }
    return this.key;
  }

  async sign(
    data: any,
  ): Promise<{ payload: string; signature: string; timestamp: number }> {
    const key = await this.getPrivateKey();
    const encoder = new TextEncoder();
    // We sign the stringified version to ensure exact match on verification
    const payloadString = JSON.stringify(data);

    const signatureBuffer = await crypto.subtle.sign(
      "Ed25519",
      key,
      encoder.encode(payloadString),
    );

    // Convert signature to base64
    const signature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBuffer)),
    );

    return {
      payload: payloadString,
      signature,
      timestamp: Date.now(),
    };
  }
}
