import { createHmac, timingSafeEqual } from 'node:crypto';

export function signHmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Canonical string included in the HMAC input for webhook verification. */
export function buildSignedPayload(
  rawBody: string,
  timestamp: string,
  nonce: string,
): string {
  return `${timestamp}.${nonce}.${rawBody}`;
}

export function verifyHmacSha256(
  secret: string,
  rawBody: string,
  timestamp: string,
  nonce: string,
  signatureHex: string,
): boolean {
  const payload = buildSignedPayload(rawBody, timestamp, nonce);
  const expected = signHmacSha256(secret, payload);
  return timingSafeEqualHex(expected, signatureHex);
}
