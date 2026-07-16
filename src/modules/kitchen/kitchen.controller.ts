import type { Request, Response } from 'express'
import { orderItemIdParamSchema, updateOrderItemStatusSchema } from './kitchen.schema'
import { getOrderItemDetail, listKitchenQueue, updateOrderItemStatus } from './kitchen.service'

export async function getKitchenQueue(_req: Request, res: Response) {
  const data = await listKitchenQueue()
  res.json({ success: true, data })
}

export async function getOrderItemDetailHandler(req: Request, res: Response) {
  const parsed = orderItemIdParamSchema.safeParse(req.params)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await getOrderItemDetail(parsed.data.id)
  res.json({ success: true, data })
}

export async function patchOrderItemStatus(req: Request, res: Response) {
  const paramsParsed = orderItemIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const bodyParsed = updateOrderItemStatusSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: bodyParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await updateOrderItemStatus(paramsParsed.data.id, bodyParsed.data)
  res.json({ success: true, data })
}
