import { z } from 'zod'

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

export const createOrderItemSchema = z.object({
  menu_item_id: z.uuid('Invalid menu ID.'),
  qty: z.number().int().min(1),
  notes: z.string().trim().min(1).optional(),
})

export const createOrderSchema = z.object({
  table_id: z.uuid('Invalid table ID.'),
  // Cashier-picked, not auto-matched — only set when the cashier explicitly
  // links this order to a booking (e.g. the reserved party has arrived).
  booking_id: z.uuid('Invalid booking ID.').optional(),
  customer_phone: z.string().trim().min(1).optional(),
  customer_name: z.string().trim().min(1).optional(),
  items: z.array(createOrderItemSchema).min(1, 'Order must have at least 1 item.'),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>

export const ORDER_STATUSES = ['active', 'completed', 'cancelled'] as const
export const ORDER_PAYMENT_STATUSES = ['unpaid', 'paid'] as const

export const getOrdersQuerySchema = z.object({
  date: z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format.').optional(),
  table_id: z.uuid('Invalid table ID.').optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  payment_status: z.enum(ORDER_PAYMENT_STATUSES).optional(),
  customer_phone: z.string().trim().min(1).optional(),
  // Filters paid_at (Jakarta calendar day range) — for Riwayat Struk in /admin/finance.
  // Independent of `date` above, which filters created_at.
  paid_from: z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format.').optional(),
  paid_to: z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format.').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type GetOrdersQuery = z.infer<typeof getOrdersQuerySchema>

export const orderIdParamSchema = z.object({
  id: z.uuid('Invalid order ID.'),
})

export const updateOrderPaymentStatusSchema = z.object({
  payment_status: z.enum(ORDER_PAYMENT_STATUSES, {
    message: 'payment_status must be one of: unpaid, paid.',
  }),
})

export type UpdateOrderPaymentStatusInput = z.infer<typeof updateOrderPaymentStatusSchema>

export const payOrdersBatchSchema = z.object({
  order_ids: z.array(z.uuid('Invalid order ID.')).min(1, 'At least 1 order must be selected.'),
})

export type PayOrdersBatchInput = z.infer<typeof payOrdersBatchSchema>
