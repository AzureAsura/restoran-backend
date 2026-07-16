import { z } from 'zod'

export const ORDER_ITEM_TARGET_STATUSES = ['cooking', 'ready', 'served'] as const

export const updateOrderItemStatusSchema = z.object({
  status: z.enum(ORDER_ITEM_TARGET_STATUSES, {
    message: 'Status must be one of: cooking, ready, served.',
  }),
})

export type UpdateOrderItemStatusInput = z.infer<typeof updateOrderItemStatusSchema>

export const orderItemIdParamSchema = z.object({
  id: z.uuid('Invalid order item ID.'),
})
