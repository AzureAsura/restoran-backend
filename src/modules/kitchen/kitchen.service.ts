import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../utils/app-error'
import type { UpdateOrderItemStatusInput } from './kitchen.schema'

const KITCHEN_QUEUE_STATUSES = ['pending', 'cooking'] as const

type KitchenQueueItem = Prisma.OrderItemGetPayload<{
  include: { order: { include: { table: true } }; menuItem: true }
}>

function toKitchenQueueItemDTO(item: KitchenQueueItem) {
  return {
    id: item.id,
    qty: item.qty,
    notes: item.notes,
    status: item.status,
    created_at: item.createdAt,
    order: {
      id: item.order.id,
      created_at: item.order.createdAt,
      table: {
        id: item.order.table.id,
        name: item.order.table.name,
        area: item.order.table.area,
      },
    },
    menu_item: {
      id: item.menuItem.id,
      name: item.menuItem.name,
      image_url: item.menuItem.imageUrl,
    },
  }
}

export async function listKitchenQueue() {
  const items = await prisma.orderItem.findMany({
    where: { status: { in: [...KITCHEN_QUEUE_STATUSES] } },
    orderBy: { createdAt: 'asc' },
    include: {
      order: { include: { table: true } },
      menuItem: true,
    },
  })

  return items.map(toKitchenQueueItemDTO)
}

function toOrderItemDetailDTO(item: KitchenQueueItem) {
  return {
    ...toKitchenQueueItemDTO(item),
    price_at_time: item.priceAtTime,
    elapsed_seconds: Math.floor((Date.now() - item.createdAt.getTime()) / 1000),
  }
}

export async function getOrderItemDetail(id: string) {
  const item = await prisma.orderItem.findUnique({
    where: { id },
    include: { order: { include: { table: true } }, menuItem: true },
  })

  if (!item) {
    throw new AppError(404, 'ORDER_ITEM_NOT_FOUND', 'Order item not found.')
  }

  return toOrderItemDetailDTO(item)
}

function toOrderItemDTO(item: {
  id: string
  orderId: string
  menuItemId: string
  qty: number
  priceAtTime: number
  notes: string | null
  status: string
  createdAt: Date
}) {
  return {
    id: item.id,
    order_id: item.orderId,
    menu_item_id: item.menuItemId,
    qty: item.qty,
    price_at_time: item.priceAtTime,
    notes: item.notes,
    status: item.status,
    created_at: item.createdAt,
  }
}

export async function updateOrderItemStatus(id: string, input: UpdateOrderItemStatusInput) {
  const existing = await prisma.orderItem.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError(404, 'ORDER_ITEM_NOT_FOUND', 'Order item not found.')
  }

  const item = await prisma.orderItem.update({
    where: { id },
    data: { status: input.status },
  })

  return toOrderItemDTO(item)
}
