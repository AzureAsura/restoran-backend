import type { Request, Response } from 'express'
import { uploadCategoryImage } from '../../lib/cloudinary'
import { categoryIdParamSchema, createMenuCategorySchema, updateMenuCategorySchema } from './menu-category.schema'
import { createCategory, deleteCategory, listCategories, updateCategory } from './menu-category.service'

export async function getCategories(_req: Request, res: Response) {
  const data = await listCategories()
  res.json({ success: true, data })
}

export async function postCategory(req: Request, res: Response) {
  const parsed = createMenuCategorySchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const imageUrl = req.file ? await uploadCategoryImage(req.file.buffer) : null
  const data = await createCategory(parsed.data, imageUrl)
  res.status(201).json({ success: true, data })
}

export async function patchCategory(req: Request, res: Response) {
  const paramsParsed = categoryIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const bodyParsed = updateMenuCategorySchema.safeParse(req.body)
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

  const imageUrl = req.file ? await uploadCategoryImage(req.file.buffer) : null
  const data = await updateCategory(paramsParsed.data.id, bodyParsed.data, imageUrl)
  res.json({ success: true, data })
}

export async function deleteCategoryHandler(req: Request, res: Response) {
  const paramsParsed = categoryIdParamSchema.safeParse(req.params)
  if (!paramsParsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: paramsParsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  await deleteCategory(paramsParsed.data.id)
  res.status(204).send()
}
