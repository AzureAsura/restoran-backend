import { prisma } from '../../lib/prisma'
import { toDbDate, toDbTime, todayInJakarta } from '../booking/booking.service'
import { AppError } from '../../utils/app-error'
import type { CreateTableInput, UpdateTableInput } from './table.schema'

function nowTimeInJakarta() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }).slice(0, 5)
}

function toTableDTO(table: {
  id: string
  restaurantId: string
  name: string
  area: string
  capacity: number
  status: string
  sortOrder: number
  createdAt: Date
}) {
  return {
    id: table.id,
    restaurant_id: table.restaurantId,
    name: table.name,
    area: table.area,
    capacity: table.capacity,
    status: table.status,
    sort_order: table.sortOrder,
    created_at: table.createdAt,
  }
}

export async function listTables() {
  const tables = await prisma.table.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  const upcomingBookings = await prisma.booking.findMany({
    where: {
      bookingDate: toDbDate(todayInJakarta()),
      bookingTime: { gte: toDbTime(nowTimeInJakarta()) },
      status: 'confirmed',
      tableId: { not: null },
    },
    select: { tableId: true },
  })
  const reservedTableIds = new Set(upcomingBookings.map((b) => b.tableId))

  return tables.map((table) => {
    const status = table.status === 'available' && reservedTableIds.has(table.id) ? 'reserved' : table.status
    return toTableDTO({ ...table, status })
  })
}

export async function createTable(input: CreateTableInput) {
  const restaurant = await prisma.restaurant.findFirst()
  if (!restaurant) {
    throw new AppError(500, 'RESTAURANT_NOT_CONFIGURED', 'Restaurant data has not been configured.')
  }

  const table = await prisma.table.create({
    data: {
      restaurantId: restaurant.id,
      name: input.name,
      area: input.area,
      capacity: input.capacity,
      status: input.status ?? 'available',
      sortOrder: input.sort_order ?? 0,
    },
  })

  return toTableDTO(table)
}

export async function updateTable(id: string, input: UpdateTableInput) {
  const existing = await prisma.table.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError(404, 'TABLE_NOT_FOUND', 'Table not found.')
  }

  const table = await prisma.table.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.area !== undefined ? { area: input.area } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
    },
  })

  return toTableDTO(table)
}

export async function deleteTable(id: string) {
  const existing = await prisma.table.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError(404, 'TABLE_NOT_FOUND', 'Table not found.')
  }

  const [bookingCount, orderCount] = await Promise.all([
    prisma.booking.count({ where: { tableId: id } }),
    prisma.order.count({ where: { tableId: id } }),
  ])

  if (bookingCount + orderCount > 0) {
    throw new AppError(
      409,
      'TABLE_IN_USE',
      'This table cannot be deleted because it already has booking/order history. Use status "maintenance" to deactivate it instead.',
    )
  }

  await prisma.table.delete({ where: { id } })
}
