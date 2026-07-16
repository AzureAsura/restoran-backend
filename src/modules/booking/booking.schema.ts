import { z } from 'zod'

// Indonesian mobile format: starts with 08, 10-13 digits total.
const phoneRegex = /^08\d{8,11}$/
const dateRegex = /^\d{4}-\d{2}-\d{2}$/
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/

function todayInJakarta() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

export const createBookingSchema = z.object({
  customer_name: z.string().trim().min(1, 'Name is required.'),
  customer_phone: z.string().trim().regex(phoneRegex, 'Phone number must be in Indonesian format (e.g. 081234567890).'),
  party_size: z.number().int().min(1).max(20),
  booking_date: z
    .string()
    .regex(dateRegex, 'Date must be in YYYY-MM-DD format.')
    .refine((date) => date >= todayInJakarta(), 'Booking date cannot be in the past.'),
  booking_time: z.string().regex(timeRegex, 'Time must be in HH:MM format.'),
  area_preference: z.enum(['indoor', 'outdoor', 'no_preference']).optional(),
  special_requests: z.string().trim().min(1).optional(),
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>

export const BOOKING_STATUSES = ['confirmed', 'seated', 'completed', 'no_show', 'cancelled'] as const

export const getBookingsQuerySchema = z.object({
  date: z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format.').optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  area: z.enum(['indoor', 'outdoor']).optional(),
  search: z.string().trim().min(1).optional(),
})

export type GetBookingsQuery = z.infer<typeof getBookingsQuerySchema>

export const updateBookingStatusSchema = z.object({
  status: z.enum(BOOKING_STATUSES, { message: 'Status must be one of: confirmed, seated, completed, no_show, cancelled.' }),
})

export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>

export const bookingIdParamSchema = z.object({
  id: z.uuid('Invalid booking ID.'),
})
