'use strict';

// Per-process sliding window rate limiter.
// Not distributed - on multi-dyno deployments, effective limit = N dynos x limit.
const MAX_PER_MINUTE = Number(process.env.WEB_SEARCH_RATE_LIMIT) || 10;
const WINDOW_MS = 60_000;

const timestamps = [];

function tryAcquire() {
  const now = Date.now();
  // Prune timestamps older than the window
  while (timestamps.length > 0 && timestamps[0] <= now - WINDOW_MS) {
    timestamps.shift();
  }

  if (timestamps.length >= MAX_PER_MINUTE) {
    const oldestInWindow = timestamps[0];
    const retryAfterMs = oldestInWindow + WINDOW_MS - now;
    return { allowed: false, retryAfterMs };
  }

  // Atomic: record immediately so concurrent calls can't exceed the limit
  timestamps.push(now);
  return { allowed: true };
}

function reset() {
  timestamps.length = 0;
}

module.exports = { tryAcquire, reset };
