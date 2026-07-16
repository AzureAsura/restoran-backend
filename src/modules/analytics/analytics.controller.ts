import type { Request, Response } from 'express'
import { getAnalyticsQuerySchema, getMenuPerformanceQuerySchema } from './analytics.schema'
import { getBookingTimeline, getDailyAnalytics, getMenuPerformance } from './analytics.service'

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
