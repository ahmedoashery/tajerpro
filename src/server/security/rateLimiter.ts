import type express from 'express';

interface BucketEntry {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Sliding-window in-memory rate limiter for protecting authentication, PIN override,
 * and heavy mutation endpoints against brute-force or burst abuse.
 */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly blockMessageAr: string;

  constructor(
    windowMs: number,
    maxRequests: number,
    blockMessageAr = 'تم تجاوز الحد المسموح للطلبات. يرجى الانتظار والمحاولة لاحقاً.'
  ) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.blockMessageAr = blockMessageAr;
    this.cleanupTimer = setInterval(() => this.pruneExpired(), Math.max(windowMs, 60_000));
    this.cleanupTimer.unref();
  }

  public check(key: string, nowMs = Date.now()): RateLimitResult {
    const cutoff = nowMs - this.windowMs;
    const entry = this.buckets.get(key) || { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.maxRequests) {
      const oldest = entry.timestamps[0] ?? nowMs;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.buckets.set(key, entry);
      return { allowed: false, remaining: 0, retryAfterSec };
    }

    entry.timestamps.push(nowMs);
    this.buckets.set(key, entry);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - entry.timestamps.length),
      retryAfterSec: 0,
    };
  }

  public middleware(): express.RequestHandler {
    return (req, res, next) => {
      let clientIp = 'local';
      try {
        const fwd = req.headers?.['x-forwarded-for'];
        const firstFwd = Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd.split(',')[0] : '';
        clientIp = (firstFwd && firstFwd.trim()) || req.socket?.remoteAddress || req.ip || 'local';
      } catch {
        clientIp = 'local';
      }
      const key = `${clientIp}:${req.path}`;
      const result = this.check(key);
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
        res.status(429).json({
          error: `${this.blockMessageAr} (حاول بعد ${result.retryAfterSec} ثانية)`,
          retryAfterSec: result.retryAfterSec,
        });
        return;
      }
      next();
    };
  }

  private pruneExpired(nowMs = Date.now()): void {
    const cutoff = nowMs - this.windowMs;
    for (const [key, entry] of this.buckets.entries()) {
      const fresh = entry.timestamps.filter((t) => t > cutoff);
      if (fresh.length === 0) {
        this.buckets.delete(key);
      } else {
        entry.timestamps = fresh;
      }
    }
  }
}
