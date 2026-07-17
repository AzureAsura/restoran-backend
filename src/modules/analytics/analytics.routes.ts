import { Router } from 'express'
import { requireRole } from '../../middlewares/require-role'
import {
  getAnalytics,
  getAnalyticsMenuFinancials,
  getAnalyticsMenuPerformance,
  getAnalyticsReservations,
  getAnalyticsRevenue,
  getAnalyticsTimeline,
} from './analytics.controller'

export const analyticsRouter = Router()

analyticsRouter.get('/', requireRole('owner'), getAnalytics)
analyticsRouter.get('/timeline', requireRole('owner'), getAnalyticsTimeline)
analyticsRouter.get('/menu-performance', requireRole('owner'), getAnalyticsMenuPerformance)
analyticsRouter.get('/revenue', requireRole('owner'), getAnalyticsRevenue)
analyticsRouter.get('/reservations', requireRole('owner'), getAnalyticsReservations)
analyticsRouter.get('/menu-financials', requireRole('owner'), getAnalyticsMenuFinancials)
