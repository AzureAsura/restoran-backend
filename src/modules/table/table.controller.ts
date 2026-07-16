import type { Request, Response } from 'express'
import { createTableSchema, tableIdParamSchema, updateTableSchema } from './table.schema'
import { createTable, deleteTable, listTables, updateTable } from './table.service'
import { closeTableOrders } from '../order/order.service'

export async function getTables(_req: Request, res: Response) {
  const data = await listTables()
  res.json({ success: true, data })
}

export async function postTable(req: Request, res: Response) {
  const parsed = createTableSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await createTable(parsed.data)
  res.status(201).json({ success: true, data })
}

export async function patchTable(req: Request, res: Response) {
  const paramsParsed = tableIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const bodyParsed = updateTableSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: bodyParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await updateTable(paramsParsed.data.id, bodyParsed.data)
  res.json({ success: true, data })
}

export async function closeTableHandler(req: Request, res: Response) {
  const paramsParsed = tableIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  await closeTableOrders(paramsParsed.data.id)
  res.status(204).send()
}

export async function deleteTableHandler(req: Request, res: Response) {
  const paramsParsed = tableIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  await deleteTable(paramsParsed.data.id)
  res.status(204).send()
}
