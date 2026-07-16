import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../utils/app-error'
import { formatUsd } from '../../utils/currency'
import type { CreateOrderInput, GetOrdersQuery, UpdateOrderPaymentStatusInput } from './order.schema'

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: { include: { menuItem: true } }; table: true } }>

function toOrderDTO(order: OrderWithItems) {
  return {
    id: order.id,
    restaurant_id: order.restaurantId,
    booking_id: order.bookingId,
    customer_phone: order.customerPhone,
    customer_name: order.customerName,
    table: { id: order.table.id, name: order.table.name, area: order.table.area },
    subtotal: order.subtotal,
    tax: order.tax,
    service_charge: order.serviceCharge,
    total: order.total,
    status: order.status,
    payment_status: order.paymentStatus,
    items: order.items.map((item) => ({
      id: item.id,
      menu_item_id: item.menuItemId,
      name: item.menuItem.name,
      qty: item.qty,
      price_at_time: item.priceAtTime,
      notes: item.notes,
      status: item.status,
    })),
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  }
}

// Order has no dedicated date column (unlike Booking's `bookingDate`) — "date"
// filters createdAt against the Jakarta calendar day it falls in. Indonesia
// has no DST, so a Jakarta day is always exactly 24 real hours.
const JAKARTA_UTC_OFFSET_MS = 7 * 60 * 60 * 1000

function startOfDayJakartaUtc(dateStr: string): Date {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - JAKARTA_UTC_OFFSET_MS)
}

export async function createOrder(input: CreateOrderInput) {
  const restaurant = await prisma.restaurant.findFirst()
  if (!restaurant) {
    throw new AppError(500, 'RESTAURANT_NOT_CONFIGURED', 'Restaurant data has not been configured.')
  }

  const table = await prisma.table.findUnique({ where: { id: input.table_id } })
  if (!table) {
    throw new AppError(404, 'TABLE_NOT_FOUND', 'Table not found.')
  }

  if (input.customer_phone) {
    const existingCustomer = await prisma.customer.findUnique({ where: { phone: input.customer_phone } })
    if (!existingCustomer) {
      await prisma.customer.create({ data: { phone: input.customer_phone } })
    }
  }

  const menuItemIds = [...new Set(input.items.map((item) => item.menu_item_id))]
  const menuItems = await prisma.menuItem.findMany({ where: { id: { in: menuItemIds } } })
  const menuItemById = new Map(menuItems.map((item) => [item.id, item]))

  for (const item of input.items) {
    if (!menuItemById.has(item.menu_item_id)) {
      throw new AppError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${item.menu_item_id} not found.`)
    }
  }

  const subtotal = input.items.reduce((sum, item) => {
    const price = menuItemById.get(item.menu_item_id)!.price
    return sum + price * item.qty
  }, 0)

  const settings = restaurant.settings as { tax_rate?: number; service_charge?: number }
  const taxRate = settings.tax_rate ?? 10
  const serviceChargeRate = settings.service_charge ?? 5
  const tax = Math.round((subtotal * taxRate) / 100)
  const serviceCharge = Math.round((subtotal * serviceChargeRate) / 100)
  const total = subtotal + tax + serviceCharge

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        restaurantId: restaurant.id,
        tableId: table.id,
        customerPhone: input.customer_phone,
        customerName: input.customer_name,
        subtotal,
        tax,
        serviceCharge,
        total,
        items: {
          create: input.items.map((item) => ({
            menuItemId: item.menu_item_id,
            qty: item.qty,
            notes: item.notes,
            priceAtTime: menuItemById.get(item.menu_item_id)!.price,
          })),
        },
      },
      include: { items: { include: { menuItem: true } }, table: true },
    })

    await tx.table.update({ where: { id: table.id }, data: { status: 'occupied' } })

    return created
  })

  return toOrderDTO(order)
}

export async function listOrders(query: GetOrdersQuery) {
  const where: Prisma.OrderWhereInput = {
    ...(query.date
      ? {
          createdAt: {
            gte: startOfDayJakartaUtc(query.date),
            lt: new Date(startOfDayJakartaUtc(query.date).getTime() + 24 * 60 * 60 * 1000),
          },
        }
      : {}),
    ...(query.table_id ? { tableId: query.table_id } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.customer_phone ? { customerPhone: { contains: query.customer_phone, mode: 'insensitive' } } : {}),
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: { include: { menuItem: true } }, table: true },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.order.count({ where }),
  ])

  return {
    orders: orders.map(toOrderDTO),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / query.limit)),
    },
  }
}

// Percentages are re-derived from the amounts actually stored on the order
// (rather than read live from restaurant.settings), so the displayed rate
// always matches the displayed amount even if settings changed since the
// order was placed — subtotal/tax/serviceCharge/total are locked in once at
// creation time (see createOrder), same snapshot principle as priceAtTime.
function derivePercent(amount: number, subtotal: number): number {
  return subtotal === 0 ? 0 : Math.round((amount / subtotal) * 100)
}

export async function getOrderBill(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { include: { menuItem: true } }, table: true },
  })

  if (!order) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  }

  return {
    order_id: order.id,
    table: { id: order.table.id, name: order.table.name, area: order.table.area },
    payment_status: order.paymentStatus,
    items: order.items.map((item) => {
      const lineTotal = item.priceAtTime * item.qty
      return {
        name: item.menuItem.name,
        qty: item.qty,
        price_at_time: item.priceAtTime,
        price_at_time_formatted: formatUsd(item.priceAtTime),
        line_total: lineTotal,
        line_total_formatted: formatUsd(lineTotal),
        notes: item.notes,
      }
    }),
    subtotal: order.subtotal,
    subtotal_formatted: formatUsd(order.subtotal),
    tax_rate_percent: derivePercent(order.tax, order.subtotal),
    tax: order.tax,
    tax_formatted: formatUsd(order.tax),
    service_charge_rate_percent: derivePercent(order.serviceCharge, order.subtotal),
    service_charge: order.serviceCharge,
    service_charge_formatted: formatUsd(order.serviceCharge),
    total: order.total,
    total_formatted: formatUsd(order.total),
    created_at: order.createdAt,
  }
}

// No transition guard, same as updateBookingStatus — payment_status can jump
// either direction (unpaid<->paid), matching the app's existing convention of
// not enforcing status-transition rules at this layer.
export async function updateOrderPaymentStatus(id: string, input: UpdateOrderPaymentStatusInput) {
  const existing = await prisma.order.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.')
  }

  const order = await prisma.order.update({
    where: { id },
    data: { paymentStatus: input.payment_status },
    include: { items: { include: { menuItem: true } }, table: true },
  })

  return toOrderDTO(order)
}

// Closes out a table: completes every active order there and frees the
// table, all in one transaction. This is the ONLY way an order becomes
// `completed` or a table becomes `available` again — deliberately a single
// staff action (POS "Mark Table Available"), not auto-derived from kitchen
// serve status. Guarded server-side (not just a disabled FE button): every
// active order must already be paid.
export async function closeTableOrders(tableId: string) {
  const table = await prisma.table.findUnique({ where: { id: tableId } })
  if (!table) {
    throw new AppError(404, 'TABLE_NOT_FOUND', 'Table not found.')
  }

  const activeOrders = await prisma.order.findMany({ where: { tableId, status: 'active' } })

  if (activeOrders.some((order) => order.paymentStatus !== 'paid')) {
    throw new AppError(409, 'ORDERS_NOT_PAID', 'All active orders must be paid before this table can be freed.')
  }

  await prisma.$transaction(async (tx) => {
    for (const order of activeOrders) {
      await tx.order.update({ where: { id: order.id }, data: { status: 'completed' } })

      if (order.customerPhone) {
        await tx.customer.upsert({
          where: { phone: order.customerPhone },
          create: {
            phone: order.customerPhone,
            totalVisits: 1,
            totalSpent: order.total,
            lastVisitDate: new Date(),
          },
          update: {
            totalVisits: { increment: 1 },
            totalSpent: { increment: order.total },
            lastVisitDate: new Date(),
          },
        })
      }
    }

    await tx.table.update({ where: { id: tableId }, data: { status: 'available' } })
  })
}
