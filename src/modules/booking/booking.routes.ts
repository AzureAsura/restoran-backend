import { Router } from 'express'
import { noStore } from '../../middlewares/no-store'
import { bookingRateLimiter } from '../../middlewares/rate-limit'
import { postBooking, getBookings, patchBookingStatus } from './booking.controller'

export const bookingRouter = Router()
bookingRouter.post('/', bookingRateLimiter, postBooking)

export const adminBookingRouter = Router()
adminBookingRouter.get('/', noStore, getBookings)
adminBookingRouter.patch('/:id', patchBookingStatus)
