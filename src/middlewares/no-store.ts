import type { NextFunction, Request, Response } from 'express'

// Polled endpoints (kitchen queue, bookings, orders — see backend.md NFR-REL-05
// / §9.1) must not be cached by Vercel's CDN/edge, or staff would keep seeing
// stale data despite polling on schedule.
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'no-store')
  next()
}
