import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Rate limiter for signal creation to prevent spam/flooding.
 */
export const rateLimitSubmissions = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxSubmissions,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test' && Boolean(req.headers['x-bypass-ratelimit']),
  message: {
    error: 'Trop de signalements envoyés depuis cette adresse IP. Veuillez patienter.',
  },
});

/**
 * Rate limiter for sensitive authentication & authorization endpoints.
 */
export const rateLimitAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    error: 'Trop de tentatives d’authentification. Veuillez réessayer plus tard.',
  },
});

/**
 * General rate limiter applied across all incoming API requests.
 */
export const rateLimitGeneral = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    error: 'Limite de requêtes atteinte. Veuillez réessayer plus tard.',
  },
});

export function clearRateLimits(): void {
  // Handled automatically by express-rate-limit
}
