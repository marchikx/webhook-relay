export declare const DEFAULT_BACKOFF_BASE_MS: number;
export declare const DEFAULT_BACKOFF_CAP_MS: number;
/**
 * Exponential backoff in milliseconds for delivery attempt `attempt` (1-based).
 * Doubles from `baseMs` until `capMs`.
 */
export declare function exponentialBackoffMs(attempt: number, baseMs?: number, capMs?: number): number;
