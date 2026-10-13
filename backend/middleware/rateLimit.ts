import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

interface RateRecord {
  count: number;
  resetTime: number;
}

const submissionLimits = new Map<string, RateRecord>();
const generalLimits = new Map<string, RateRecord>();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown-ip';
}

export function rateLimitSubmissions(req: Request, res: Response, next: NextFunction): void {
  // Allow bypassing rate limit in test environment if header present
  if (process.env.NODE_ENV === 'test' && req.headers['x-bypass-ratelimit']) {
    return next();
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const windowMs = config.rateLimit.windowMs;
  const max = config.rateLimit.maxSubmissions;

  let record = submissionLimits.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    submissionLimits.set(ip, record);
    return next();
  }

  if (record.count >= max) {
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
    res.set('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Trop de signalements envoyés depuis cette adresse IP. Veuillez patienter.',
      retryAfter: retryAfterSeconds,
    });
    return;
  }

  record.count++;
  next();
}

export function rateLimitGeneral(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const max = config.rateLimit.maxRequests;

  let record = generalLimits.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + windowMs };
    generalLimits.set(ip, record);
    return next();
  }

  if (record.count >= max) {
    res.status(429).json({
      error: 'Limite de requêtes atteinte. Veuillez réessayer plus tard.',
    });
    return;
  }

  record.count++;
  next();
}

export function clearRateLimits(): void {
  submissionLimits.clear;
  generalLimits.clear();
}
