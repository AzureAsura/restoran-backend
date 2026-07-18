import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../utils/app-error'
import type { CreateBookingInput, GetBookingsQuery } from './booking.schema'

type BookingWithRelations = Prisma.BookingGetPayload<{ include: { customer: true; table: true } }>

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export function toDbDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00.000Z`)
}

export function toDbTime(timeStr: string) {
  return new Date(`1970-01-01T${timeStr}:00.000Z`)
}

function fromDbDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function fromDbTime(date: Date) {
  return date.toISOString().slice(11, 16)
}

export function todayInJakarta() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

function toBookingDTO(booking: BookingWithRelations) {
  return {
    id: booking.id,
    booking_code: booking.bookingCode,
    customer: booking.customer
      ? {
          id: booking.customer.id,
          name: booking.customer.name,
          phone: booking.customer.phone,
          total_visits: booking.customer.totalVisits,
          no_show_count: booking.customer.noShowCount,
        }
      : null,
    customer_name: booking.customerName,
    customer_phone: booking.customerPhone,
    party_size: booking.partySize,
    booking_date: fromDbDate(booking.bookingDate),
    booking_time: fromDbTime(booking.bookingTime),
    area_preference: booking.areaPreference,
    special_requests: booking.specialRequests,
    status: booking.status,
    source: booking.source,
    table: booking.table
      ? { id: booking.table.id, name: booking.table.name, area: booking.table.area, capacity: booking.table.capacity }
      : null,
    created_at: booking.createdAt,
    updated_at: booking.updatedAt,
  }
}

function dayNameFromDate(dateStr: string) {
  return DAY_NAMES[new Date(`${dateStr}T00:00:00.000Z`).getUTCDay()]
}

function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

export function assertWithinOperatingHours(openingHours: unknown, bookingDate: string, bookingTime: string) {
  const hours = openingHours as Record<string, string | undefined>
  const dayName = dayNameFromDate(bookingDate)
  const range = hours[dayName]

  if (!range) {
    throw new AppError(422, 'OUTSIDE_OPERATING_HOURS', 'The restaurant is closed on the selected day.')
  }

  const [open, close] = range.split('-')
  if (!(bookingTime >= open && bookingTime < close)) {
    throw new AppError(
      422,
      'OUTSIDE_OPERATING_HOURS',
      `Booking time is outside operating hours (${range}).`,
    )
  }
}

export async function findAvailableTable(
  tx: Prisma.TransactionClient,
  restaurantId: string,
  partySize: number,
  areaPreference: string,
  bookingDate: Date,
  bookingTime: Date,
) {
  const candidates = await tx.table.findMany({
    where: {
      restaurantId,
      status: { not: 'maintenance' },
      capacity: { gte: partySize },
      ...(areaPreference !== 'no_preference' ? { area: areaPreference } : {}),
    },
    orderBy: { capacity: 'asc' },
  })

  for (const table of candidates) {
    const conflict = await tx.booking.count({
      where: {
        tableId: table.id,
        bookingDate,
        bookingTime,
        status: { in: ['confirmed', 'seated'] },
      },
    })
    if (conflict === 0) return table
  }

  return null
}

async function generateBookingCode(
  tx: Prisma.TransactionClient,
  restaurantId: string,
  restaurantName: string,
  bookingDate: Date,
) {
  const count = await tx.booking.count({ where: { restaurantId, bookingDate } })
  const seq = String(count + 1).padStart(3, '0')
  const dd = String(bookingDate.getUTCDate()).padStart(2, '0')
  const mm = String(bookingDate.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = bookingDate.getUTCFullYear()
  return `${initialsOf(restaurantName)}-${dd}${mm}${yyyy}-${seq}`
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

const MAX_ATTEMPTS = 3

export async function createBooking(input: CreateBookingInput) {
  const restaurant = await prisma.restaurant.findFirst()
  if (!restaurant) {
    throw new AppError(500, 'RESTAURANT_NOT_CONFIGURED', 'Restaurant data has not been configured.')
  }

  assertWithinOperatingHours(restaurant.openingHours, input.booking_date, input.booking_time)

  const bookingDate = toDbDate(input.booking_date)
  const bookingTime = toDbTime(input.booking_time)
  const areaPreference = input.area_preference ?? 'no_preference'

  let lastError: unknown

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const { booking, table } = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.upsert({
          where: { phone: input.customer_phone },
          update: { name: input.customer_name },
          create: { phone: input.customer_phone, name: input.customer_name },
        })

        const table = await findAvailableTable(
          tx,
          restaurant.id,
          input.party_size,
          areaPreference,
          bookingDate,
          bookingTime,
        )
        if (!table) {
          throw new AppError(
            409,
            'NO_TABLE_AVAILABLE',
            'No table available for that time and party size.',
          )
        }

        const bookingCode = await generateBookingCode(tx, restaurant.id, restaurant.name, bookingDate)

        const booking = await tx.booking.create({
          data: {
            bookingCode,
            restaurantId: restaurant.id,
            customerId: customer.id,
            customerName: input.customer_name,
            customerPhone: input.customer_phone,
            tableId: table.id,
            partySize: input.party_size,
            bookingDate,
            bookingTime,
            areaPreference,
            specialRequests: input.special_requests,
            status: 'confirmed',
            source: 'web',
          },
        })

        return { booking, table }
      })

      const settings = restaurant.settings as { hold_time_minutes?: number }
      const holdTimeMinutes = settings.hold_time_minutes ?? 15

      return {
        booking_id: booking.id,
        booking_code: booking.bookingCode,
        customer_name: booking.customerName,
        customer_phone: booking.customerPhone,
        party_size: booking.partySize,
        booking_date: fromDbDate(booking.bookingDate),
        booking_time: fromDbTime(booking.bookingTime),
        table: { id: table.id, name: table.name, area: table.area, capacity: table.capacity },
        status: booking.status,
        message: `${table.name} (${table.area}) has been reserved. Please arrive ${holdTimeMinutes} minutes before your booking time.`,
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      if (isUniqueConstraintError(err) && attempt < MAX_ATTEMPTS - 1) {
        lastError = err
        continue
      }
      throw err
    }
  }

  throw lastError
}

export async function listBookings(query: GetBookingsQuery) {
  const date = query.date ?? todayInJakarta()
  const bookingDate = toDbDate(date)

  const bookings = await prisma.booking.findMany({
    where: {
      bookingDate,
      ...(query.status ? { status: query.status } : {}),
      ...(query.area ? { table: { area: query.area } } : {}),
      ...(query.search
        ? {
            OR: [
              { customerName: { contains: query.search, mode: 'insensitive' } },
              { customerPhone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: { customer: true, table: true },
    orderBy: { bookingTime: 'asc' },
  })

  return bookings.map(toBookingDTO)
}

export async function updateBookingStatus(id: string, status: string) {
  const existing = await prisma.booking.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found.')
  }

  const shouldMarkVisit = status === 'completed' && existing.status !== 'completed' && existing.customerId

  const booking = await prisma.$transaction(async (tx) => {
    if (shouldMarkVisit) {
      await tx.customer.update({
        where: { id: existing.customerId! },
        data: {
          totalVisits: { increment: 1 },
          lastVisitDate: new Date(),
        },
      })
    }

    return tx.booking.update({
      where: { id },
      data: { status },
      include: { customer: true, table: true },
    })
  })

  return toBookingDTO(booking)
}

const JAKARTA_UTC_OFFSET_MS = 7 * 60 * 60 * 1000

function bookingSlotToRealInstant(bookingDate: Date, bookingTime: Date): Date {
  const utcAsIfJakarta = Date.UTC(
    bookingDate.getUTCFullYear(),
    bookingDate.getUTCMonth(),
    bookingDate.getUTCDate(),
    bookingTime.getUTCHours(),
    bookingTime.getUTCMinutes(),
  )
  return new Date(utcAsIfJakarta - JAKARTA_UTC_OFFSET_MS)
}

export async function flagOverdueBookingsAsNoShow() {
  const restaurant = await prisma.restaurant.findFirst()
  if (!restaurant) return { flagged: 0 }

  const settings = restaurant.settings as { hold_time_minutes?: number }
  const holdTimeMinutes = settings.hold_time_minutes ?? 15

  const candidates = await prisma.booking.findMany({ where: { status: 'confirmed' } })

  const now = Date.now()
  const overdue = candidates.filter((booking) => {
    const deadline =
      bookingSlotToRealInstant(booking.bookingDate, booking.bookingTime).getTime() + holdTimeMinutes * 60 * 1000
    return deadline <= now
  })

  for (const booking of overdue) {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'no_show' } })

      if (booking.customerId) {
        await tx.customer.update({
          where: { id: booking.customerId },
          data: { noShowCount: { increment: 1 } },
        })
      }
    })
  }

  return { flagged: overdue.length }
}
