import { describe, expect, it } from 'vitest';
import { buildSignedPayload, signHmacSha256, timingSafeEqualHex, verifyHmacSha256, } from '../src/hmac.js';
describe('HMAC', () => {
    const secret = 'whsec_test_key';
    const body = '{"event":"order.paid"}';
    const timestamp = '1700000000';
    const nonce = 'n-abc-123';
    it('verifies a valid signature', () => {
        const payload = buildSignedPayload(body, timestamp, nonce);
        const sig = signHmacSha256(secret, payload);
        expect(verifyHmacSha256(secret, body, timestamp, nonce, sig)).toBe(true);
        expect(timingSafeEqualHex(sig, sig)).toBe(true);
    });
    it('rejects a wrong secret or tampered body', () => {
        const payload = buildSignedPayload(body, timestamp, nonce);
        const sig = signHmacSha256(secret, payload);
        expect(verifyHmacSha256('wrong', body, timestamp, nonce, sig)).toBe(false);
        expect(verifyHmacSha256(secret, '{"event":"tampered"}', timestamp, nonce, sig)).toBe(false);
        expect(timingSafeEqualHex(sig, '00'.repeat(32))).toBe(false);
    });
});
