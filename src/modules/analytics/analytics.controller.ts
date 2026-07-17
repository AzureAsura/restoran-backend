import type { Request, Response } from 'express'
import { getAnalyticsQuerySchema, getMenuPerformanceQuerySchema, getRevenueQuerySchema } from './analytics.schema'
import {
  getBookingTimeline,
  getDailyAnalytics,
  getMenuFinancials,
  getMenuPerformance,
  getReservationAnalytics,
  getRevenueReport,
} from './analytics.service'

export async function getAnalytics(req: Request, res: Response) {
  const parsed = getAnalyticsQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const data = await getDailyAnalytics(parsed.data)
  res.json({ success: true, data })
}

export async function getAnalyticsTimeline(req: Request, res: Response) {
  const parsed = getAnalyticsQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const data = await getBookingTimeline(parsed.data)
  res.json({ success: true, data })
}

export async function getAnalyticsMenuPerformance(req: Request, res: Response) {
  const parsed = getMenuPerformanceQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const data = await getMenuPerformance(parsed.data)
  res.json({ success: true, data })
}

export async function getAnalyticsRevenue(req: Request, res: Response) {
  const parsed = getRevenueQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const data = await getRevenueReport(parsed.data)
  res.json({ success: true, data })
}

export async function getAnalyticsReservations(req: Request, res: Response) {
  // Same period+date shape as revenue — reuses getRevenueQuerySchema rather
  // than duplicating it (getAnalyticsQuerySchema above is already shared the
  // same way, between getAnalytics and getAnalyticsTimeline).
  const parsed = getRevenueQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const data = await getReservationAnalytics(parsed.data)
  res.json({ success: true, data })
}

export async function getAnalyticsMenuFinancials(req: Request, res: Response) {
  const parsed = getRevenueQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const data = await getMenuFinancials(parsed.data)
  res.json({ success: true, data })
}
