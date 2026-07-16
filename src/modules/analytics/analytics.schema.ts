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
