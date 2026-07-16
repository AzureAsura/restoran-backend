import type { Request, Response } from 'express'
import { uploadMenuImage } from '../../lib/cloudinary'
import {
  createMenuItemSchema,
  getMenuQuerySchema,
  menuItemIdParamSchema,
  updateMenuItemSchema,
} from './menu.schema'
import {
  createMenuItem,
  getMenuGroupedByCategory,
  listAdminMenu,
  softDeleteMenuItem,
  updateMenuItem,
} from './menu.service'

export async function getMenu(req: Request, res: Response) {
  const parsed = getMenuQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message ?? 'Invalid query.' },
    })
  }

  const data = await getMenuGroupedByCategory(parsed.data)
  res.json({ success: true, data })
}

export async function getAdminMenu(_req: Request, res: Response) {
  const data = await listAdminMenu()
  res.json({ success: true, data })
}

export async function postMenuItem(req: Request, res: Response) {
  const parsed = createMenuItemSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const imageUrl = req.file ? await uploadMenuImage(req.file.buffer) : null
  const data = await createMenuItem(parsed.data, imageUrl)
  res.status(201).json({ success: true, data })
}

export async function patchMenuItem(req: Request, res: Response) {
  const paramsParsed = menuItemIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const bodyParsed = updateMenuItemSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: bodyParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  if (Object.keys(bodyParsed.data).length === 0 && !req.file) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'At least one field or an image must be provided.' },
    })
  }

  const imageUrl = req.file ? await uploadMenuImage(req.file.buffer) : null
  const data = await updateMenuItem(paramsParsed.data.id, bodyParsed.data, imageUrl)
  res.json({ success: true, data })
}

export async function deleteMenuItemHandler(req: Request, res: Response) {
  const paramsParsed = menuItemIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  await softDeleteMenuItem(paramsParsed.data.id)
  res.status(204).send()
}
