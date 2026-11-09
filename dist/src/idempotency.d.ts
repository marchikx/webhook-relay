export declare class IdempotencyStore {
    private readonly keys;
    private purgeExpired;
    /** Records a key; returns false if the key is still active (duplicate). */
    rememberKey(key: string, ttlMs: number, now?: number): boolean;
    seenKey(key: string, now?: number): boolean;
}
