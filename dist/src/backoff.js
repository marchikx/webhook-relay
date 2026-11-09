const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
export const DEFAULT_BACKOFF_BASE_MS = 5 * MINUTE_MS;
export const DEFAULT_BACKOFF_CAP_MS = 12 * HOUR_MS;
/**
 * Exponential backoff in milliseconds for delivery attempt `attempt` (1-based).
 * Doubles from `baseMs` until `capMs`.
 */
export function exponentialBackoffMs(attempt, baseMs = DEFAULT_BACKOFF_BASE_MS, capMs = DEFAULT_BACKOFF_CAP_MS) {
    if (attempt < 1) {
        return baseMs;
    }
    const exponent = attempt - 1;
    const raw = baseMs * 2 ** exponent;
    return Math.min(raw, capMs);
}
