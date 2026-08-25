/**
 * In-memory fixed-window rate limiter. Deliberately simple for Phase 1:
 * this is a single-instance deployment, so an in-memory Map is sufficient.
 * A multi-instance production deployment MUST replace this with a shared
 * store (Redis, etc.) — an in-memory limiter is per-process and does
 * nothing useful once there's more than one server instance behind a
 * load balancer. Documented here rather than silently left as a surprise.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true };
}

/** Call on a successful login so a legitimate user isn't punished by earlier failed attempts. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
