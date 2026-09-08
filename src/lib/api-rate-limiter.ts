import { getRedisClient } from './redis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

/**
 * Sliding window rate limiter using Redis sorted sets.
 * Key: arbitrary string (e.g. `rl:chat:userId`)
 * Returns allowed=false when the caller has exceeded `limit` requests in the last `windowSecs` seconds.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSecs: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const now = Date.now();
  const windowMs = windowSecs * 1000;
  const windowStart = now - windowMs;

  try {
    const multi = redis.multi();
    multi.zremrangebyscore(key, '-inf', windowStart);
    multi.zadd(key, now, `${now}-${Math.random()}`);
    multi.zcard(key);
    multi.expire(key, windowSecs + 1);

    const results = await multi.exec();
    const count = (results?.[2]?.[1] as number) ?? 0;

    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const resetAt = Math.ceil((now + windowMs) / 1000);

    return { allowed, remaining, resetAt, limit };
  } catch {
    // Fail open — if Redis is unavailable, allow the request
    return { allowed: true, remaining: limit, resetAt: Math.ceil((now + windowMs) / 1000), limit };
  }
}
