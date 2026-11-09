export class IdempotencyStore {
    keys = new Map();
    purgeExpired(now) {
        for (const [key, entry] of this.keys) {
            if (entry.expiresAt <= now) {
                this.keys.delete(key);
            }
        }
    }
    /** Records a key; returns false if the key is still active (duplicate). */
    rememberKey(key, ttlMs, now = Date.now()) {
        this.purgeExpired(now);
        const existing = this.keys.get(key);
        if (existing && existing.expiresAt > now) {
            return false;
        }
        this.keys.set(key, { expiresAt: now + ttlMs });
        return true;
    }
    seenKey(key, now = Date.now()) {
        this.purgeExpired(now);
        const entry = this.keys.get(key);
        return entry !== undefined && entry.expiresAt > now;
    }
}
