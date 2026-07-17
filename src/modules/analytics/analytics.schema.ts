import { z } from 'zod'

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

export const getAnalyticsQuerySchema = z.object({
  date: z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format.').optional(),
})

export type GetAnalyticsQuery = z.infer<typeof getAnalyticsQuerySchema>

export const MENU_PERFORMANCE_RANGES = ['today', 'week'] as const

export const getMenuPerformanceQuerySchema = z.object({
  range: z.enum(MENU_PERFORMANCE_RANGES, { message: 'range must be one of: today, week.' }).default('today'),
})

export type GetMenuPerformanceQuery = z.infer<typeof getMenuPerformanceQuerySchema>

export const REVENUE_PERIODS = ['week', 'month', 'year'] as const

export const getRevenueQuerySchema = z.object({
  period: z.enum(REVENUE_PERIODS, { message: 'period must be one of: week, month, year.' }).default('month'),
  date: z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format.').optional(),
})

export type GetRevenueQuery = z.infer<typeof getRevenueQuerySchema>
