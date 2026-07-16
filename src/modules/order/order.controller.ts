import type { Request, Response } from 'express'
import {
  createOrderSchema,
  getOrdersQuerySchema,
  orderIdParamSchema,
  updateOrderPaymentStatusSchema,
} from './order.schema'
import { createOrder, getOrderBill, listOrders, updateOrderPaymentStatus } from './order.service'

export async function postOrder(req: Request, res: Response) {
  const parsed = createOrderSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await createOrder(parsed.data)
  res.status(201).json({ success: true, data })
}

export async function getOrders(req: Request, res: Response) {
  const parsed = getOrdersQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const { orders, pagination } = await listOrders(parsed.data)
  res.json({ success: true, data: orders, pagination })
}

export async function getOrderBillHandler(req: Request, res: Response) {
  const parsed = orderIdParamSchema.safeParse(req.params)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await getOrderBill(parsed.data.id)
  res.json({ success: true, data })
}

export async function patchOrderPaymentStatus(req: Request, res: Response) {
  const paramsParsed = orderIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const bodyParsed = updateOrderPaymentStatusSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: bodyParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await updateOrderPaymentStatus(paramsParsed.data.id, bodyParsed.data)
  res.json({ success: true, data })
}
