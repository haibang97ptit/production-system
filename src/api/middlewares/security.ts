import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';

/**
 * API key authentication middleware.
 * Chỉ áp dụng khi config.API_KEY được set.
 * Client cần gửi header "x-api-key: <value>" trong mỗi request.
 * Bỏ qua các route public như /docs, /api/health.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.API_KEY) {
    return next();
  }

  const publicPaths = ['/api/health', '/docs', '/'];
  if (publicPaths.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
    return next();
  }

  const key = req.header('x-api-key');
  if (!key || key !== config.API_KEY) {
    logger.warn(
      `Unauthorized access to ${req.originalUrl} from ${req.ip} (missing/invalid x-api-key)`
    );
    res.status(401).json({ error: { message: 'Missing or invalid API key' } });
    return;
  }
  next();
}

/**
 * Simple in-memory rate limiter theo IP.
 * Cho hệ thống nội bộ dùng đủ; production public nên dùng Redis.
 */
export function createRateLimiter(maxRequests: number, windowMinutes: number) {
  const windowMs = windowMinutes * 60 * 1000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  // Cleanup hết hạn định kỳ để tránh memory leak
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets.entries()) {
      if (b.resetAt < now) buckets.delete(ip);
    }
  }, windowMs).unref();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count++;
    if (bucket.count > maxRequests) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      res.status(429).json({
        error: {
          message: `Too many requests. Try again in ${retryAfterSec}s.`,
        },
      });
      return;
    }
    next();
  };
}

/**
 * Security headers cơ bản (thay thế Helmet cho gọn dependency).
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}
