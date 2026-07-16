import { Router } from 'express'
import { requireRole } from '../../middlewares/require-role'
import { getAnalytics, getAnalyticsMenuPerformance, getAnalyticsTimeline } from './analytics.controller'

export const analyticsRouter = Router()

analyticsRouter.get('/', requireRole('owner'), getAnalytics)
analyticsRouter.get('/timeline', requireRole('owner'), getAnalyticsTimeline)
analyticsRouter.get('/menu-performance', requireRole('owner'), getAnalyticsMenuPerformance)
