import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'

function buildLimiter(
  windowMs: number,
  limit: number,
  code: string,
  message: string,
  keyGenerator?: (req: Request) => string,
) {
  return rateLimit({
    windowMs,
    limit,
    message: { success: false, error: { code, message } },
    ...(keyGenerator ? { keyGenerator } : {}),
  })
}

// Public, unauthenticated surface (menu, bookings, ai chat, staff login) — the
// only identity available is the caller's IP.
export const generalRateLimiter = buildLimiter(
  60 * 1000,
  100,
  'RATE_LIMIT_EXCEEDED',
  'Too many requests. Please try again shortly.',
)

export const bookingRateLimiter = buildLimiter(
  60 * 60 * 1000,
  10,
  'BOOKING_RATE_LIMIT_EXCEEDED',
  'Too many booking requests from this IP. Please try again in 1 hour.',
)

// Staff (/admin/*) routes are always mounted after requireAuth, so req.user is
// already resolved — key by staff account instead of IP so colleagues sharing
// one office network/NAT each get their own quota, rather than sharing (and
// potentially starving) one IP-wide bucket. Falls back to IP only for the
// unexpected case where this runs without an authenticated session.
export const adminRateLimiter = buildLimiter(
  60 * 1000,
  300,
  'RATE_LIMIT_EXCEEDED',
  'Too many requests. Please try again shortly.',
  (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
)
