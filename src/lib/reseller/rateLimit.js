// In-memory sliding-window rate limiter.
// MVP: per-process memory. For multi-instance production (Vercel), swap with
// Upstash Redis — the interface (checkRpm) stays the same.

if (!globalThis._resellerRpm) globalThis._resellerRpm = new Map();
const buckets = globalThis._resellerRpm;

function prune(now, windowMs) {
  for (const [k, hits] of buckets) {
    const fresh = hits.filter((t) => now - t < windowMs);
    if (fresh.length) buckets.set(k, fresh);
    else buckets.delete(k);
  }
}

let lastPrune = 0;

/**
 * Returns { allowed, remaining, limit, retryAfterSec }.
 * limit <= 0 means unlimited.
 */
export function checkRpm(scopeKey, limit, windowMs = 60_000) {
  if (!limit || limit <= 0) return { allowed: true, remaining: Infinity, limit: 0 };
  const now = Date.now();
  if (now - lastPrune > 30_000) {
    prune(now, windowMs);
    lastPrune = now;
  }
  const hits = buckets.get(scopeKey) || [];
  const fresh = hits.filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    const oldest = fresh[0];
    const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, limit, retryAfterSec };
  }
  fresh.push(now);
  buckets.set(scopeKey, fresh);
  return { allowed: true, remaining: limit - fresh.length, limit };
}
