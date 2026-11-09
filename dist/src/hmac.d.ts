export declare function signHmacSha256(secret: string, payload: string): string;
export declare function timingSafeEqualHex(a: string, b: string): boolean;
/** Canonical string included in the HMAC input for webhook verification. */
export declare function buildSignedPayload(rawBody: string, timestamp: string, nonce: string): string;
export declare function verifyHmacSha256(secret: string, rawBody: string, timestamp: string, nonce: string, signatureHex: string): boolean;
