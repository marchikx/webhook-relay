import { createHmac, timingSafeEqual } from 'node:crypto';
export function signHmacSha256(secret, payload) {
    return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}
export function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) {
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}
/** Canonical string included in the HMAC input for webhook verification. */
export function buildSignedPayload(rawBody, timestamp, nonce) {
    return `${timestamp}.${nonce}.${rawBody}`;
}
export function verifyHmacSha256(secret, rawBody, timestamp, nonce, signatureHex) {
    const payload = buildSignedPayload(rawBody, timestamp, nonce);
    const expected = signHmacSha256(secret, payload);
    return timingSafeEqualHex(expected, signatureHex);
}
