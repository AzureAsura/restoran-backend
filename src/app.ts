import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import { env } from './config/env'
import { getAuth } from './lib/auth'
import { errorHandler } from './middlewares/error-handler'
import { requireAuth } from './middlewares/require-auth'
import { requireRole } from './middlewares/require-role'
import { adminRateLimiter, generalRateLimiter } from './middlewares/rate-limit'

import { bookingRouter, adminBookingRouter } from './modules/booking/booking.routes'
import { flagOverdueBookingsAsNoShow } from './modules/booking/booking.service'
import { tableRouter } from './modules/table/table.routes'
import { adminMenuCategoryRouter, adminMenuRouter, menuRouter } from './modules/menu/menu.routes'
import { orderRouter } from './modules/order/order.routes'
import { kitchenRouter } from './modules/kitchen/kitchen.routes'
import { aiRouter } from './modules/ai/ai.routes'
import { analyticsRouter } from './modules/analytics/analytics.routes'

export const app = express()

// Behind Vercel's proxy, trust the first hop so req.ip (used by the IP-keyed
// rate limiters) and req.secure (used for Secure cookies) reflect the client.
app.set('trust proxy', 1)

app.use(helmet())
app.use(cors({ origin: env.frontendOrigin, credentials: true }))
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'))

// Must be mounted before express.json() — better-auth reads the raw request
// body itself. `app.all` (not `app.use`) so req.url keeps the `/api/auth`
// prefix that better-auth's basePath expects; Express 5 requires the named
// wildcard `*splat` instead of a bare `*`.
//
// better-auth/node is ESM-only, so both it and the auth instance are loaded
// lazily via dynamic import() on first request and memoized — see
// src/lib/auth.ts for why.
let authHandlerPromise: ReturnType<typeof buildAuthHandler> | undefined

async function buildAuthHandler() {
  const { toNodeHandler } = await import('better-auth/node')
  return toNodeHandler(await getAuth())
}

app.all('/api/auth/*splat', generalRateLimiter, async (req, res, next) => {
  try {
    if (!authHandlerPromise) authHandlerPromise = buildAuthHandler()
    const handler = await authHandlerPromise
    handler(req, res)
  } catch (err) {
    next(err)
  }
})

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } })
})

// Triggered by Vercel Cron (see vercel.json once configured) or node-cron in dev (src/jobs/no-show-cron.ts).
// Not a staff-facing endpoint — auth is a shared secret, not a session cookie.
app.post('/internal/cron/no-show', generalRateLimiter, async (req, res) => {
  if (!env.cronSecret || req.headers.authorization !== `Bearer ${env.cronSecret}`) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret.' } })
  }

  const data = await flagOverdueBookingsAsNoShow()
  res.json({ success: true, data })
})

// Public, unauthenticated routes: rate-limited per IP (generalRateLimiter),
// since IP is the only identity available. /bookings additionally gets the
// stricter per-IP bookingRateLimiter on top (see booking.routes.ts).
app.use('/bookings', generalRateLimiter, bookingRouter)
app.use('/menu', generalRateLimiter, menuRouter)
app.use('/ai', generalRateLimiter, aiRouter)

// Staff (/admin/*) routes: always authenticated, so adminRateLimiter keys by
// staff account (requireAuth must run first to resolve req.user) instead of
// IP — colleagues on the same office network each get their own quota.
app.use('/admin/bookings', requireAuth, requireRole('owner', 'cashier'), adminRateLimiter, adminBookingRouter)
app.use('/admin/menu', requireAuth, adminRateLimiter, adminMenuRouter)
app.use('/admin/menu-categories', requireAuth, adminRateLimiter, adminMenuCategoryRouter)
app.use('/admin/tables', requireAuth, adminRateLimiter, tableRouter)
app.use('/admin/orders', requireAuth, adminRateLimiter, orderRouter)
app.use('/admin', requireAuth, adminRateLimiter, kitchenRouter) // kitchen-queue, order-items
app.use('/admin/analytics', requireAuth, adminRateLimiter, analyticsRouter)

app.use(errorHandler)
