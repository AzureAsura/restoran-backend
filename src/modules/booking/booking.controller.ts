import type { Request, Response } from 'express'
import {
  bookingIdParamSchema,
  createBookingSchema,
  getBookingsQuerySchema,
  updateBookingStatusSchema,
} from './booking.schema'
import { createBooking, listBookings, updateBookingStatus } from './booking.service'

export async function postBooking(req: Request, res: Response) {
  const parsed = createBookingSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await createBooking(parsed.data)
  res.status(201).json({ success: true, data })
}

export async function getBookings(req: Request, res: Response) {
  const parsed = getBookingsQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const data = await listBookings(parsed.data)
  res.json({ success: true, data })
}

export async function patchBookingStatus(req: Request, res: Response) {
  const paramsParsed = bookingIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const bodyParsed = updateBookingStatusSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: bodyParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await updateBookingStatus(paramsParsed.data.id, bodyParsed.data.status)
  res.json({ success: true, data })
}
