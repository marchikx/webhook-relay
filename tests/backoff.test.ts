import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
  exponentialBackoffMs,
} from '../src/backoff.js';

describe('exponentialBackoffMs', () => {
  it('doubles each attempt then caps at twelve hours', () => {
    expect(exponentialBackoffMs(1)).toBe(DEFAULT_BACKOFF_BASE_MS);
    expect(exponentialBackoffMs(2)).toBe(DEFAULT_BACKOFF_BASE_MS * 2);
    expect(exponentialBackoffMs(3)).toBe(DEFAULT_BACKOFF_BASE_MS * 4);
    expect(exponentialBackoffMs(20)).toBe(DEFAULT_BACKOFF_CAP_MS);
    expect(exponentialBackoffMs(20, DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_CAP_MS)).toBe(
      DEFAULT_BACKOFF_CAP_MS,
    );
  });
});
