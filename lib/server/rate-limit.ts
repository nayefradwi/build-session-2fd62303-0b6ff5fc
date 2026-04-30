/**
 * In-memory fixed-window rate limiter.
 *
 * Keyed by an arbitrary string (typically `${ip}:${email}` for login).
 * Suitable for a single Vercel function instance; for production-grade
 * limits use a shared store (Redis / Upstash). We intentionally keep
 * this tiny so we have *some* protection against brute-force attempts
 * out of the box without a new dependency.
 */

interface Bucket {
  /** Window start, ms since epoch. */
  windowStart: number;
  /** Number of hits in the current window. */
  count: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum allowed hits per window. */
  max: number;
}

export interface RateLimitResult {
  /** True if the request is allowed. */
  allowed: boolean;
  /** Hits remaining in the current window after this call. */
  remaining: number;
  /** Window reset time as a Date. */
  resetAt: Date;
  /** Configured limit (echoed for header use). */
  limit: number;
  /** Seconds until the next window if the call was blocked. */
  retryAfterSeconds: number;
}

/**
 * Record a hit for `key` and return the resulting state. Increments
 * the counter; the caller decides whether to act on `allowed`.
 */
export function rateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= opts.windowMs) {
    const fresh: Bucket = { windowStart: now, count: 1 };
    buckets.set(key, fresh);
    return {
      allowed: true,
      remaining: Math.max(0, opts.max - 1),
      resetAt: new Date(now + opts.windowMs),
      limit: opts.max,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= opts.max;
  const resetAtMs = existing.windowStart + opts.windowMs;
  return {
    allowed,
    remaining: Math.max(0, opts.max - existing.count),
    resetAt: new Date(resetAtMs),
    limit: opts.max,
    retryAfterSeconds: allowed ? 0 : Math.ceil((resetAtMs - now) / 1000),
  };
}

/**
 * Reset a key (e.g. on successful login so a flurry of failed
 * attempts does not lock out the legitimate user immediately after).
 */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort GC. The Map can grow unbounded over the lifetime of a
 * long-running process; periodic pruning keeps it tidy. Cheap so we
 * just call it from the limiter when the map gets large.
 */
function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    // Use the largest reasonable window (1 hour) as a coarse upper bound.
    if (now - bucket.windowStart > 60 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}

if (typeof setInterval !== "undefined") {
  // Avoid blocking process shutdown.
  const handle = setInterval(() => pruneExpired(Date.now()), 60 * 1000);
  if (typeof handle === "object" && handle && "unref" in handle) {
    (handle as { unref: () => void }).unref();
  }
}
