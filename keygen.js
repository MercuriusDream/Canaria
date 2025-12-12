
const { webcrypto } = require('node:crypto');

async function generate() {
    const keyPair = await webcrypto.subtle.generateKey(
        {
            name: "Ed25519",
        },
        true,
        ["sign", "verify"]
    );

    const privateKey = await webcrypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicKey = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);

    console.log("PRIVATE_KEY:", JSON.stringify(privateKey));
    console.log("PUBLIC_KEY:", JSON.stringify(publicKey));
}

generate();
