type Entry = { expiresAt: number };

export class IdempotencyStore {
  private readonly keys = new Map<string, Entry>();

  private purgeExpired(now: number): void {
    for (const [key, entry] of this.keys) {
      if (entry.expiresAt <= now) {
        this.keys.delete(key);
      }
    }
  }

  /** Records a key; returns false if the key is still active (duplicate). */
  rememberKey(key: string, ttlMs: number, now: number = Date.now()): boolean {
    this.purgeExpired(now);
    const existing = this.keys.get(key);
    if (existing && existing.expiresAt > now) {
      return false;
    }
    this.keys.set(key, { expiresAt: now + ttlMs });
    return true;
  }

  seenKey(key: string, now: number = Date.now()): boolean {
    this.purgeExpired(now);
    const entry = this.keys.get(key);
    return entry !== undefined && entry.expiresAt > now;
  }
}
