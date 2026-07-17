import { z } from 'zod'

const booleanField = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))

export const createMenuCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.'),
  sort_order: z.coerce.number().int().min(0).optional(),
})

export type CreateMenuCategoryInput = z.infer<typeof createMenuCategorySchema>

export const updateMenuCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.').optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
  is_active: booleanField.optional(),
})

export type UpdateMenuCategoryInput = z.infer<typeof updateMenuCategorySchema>

export const categoryIdParamSchema = z.object({
  id: z.uuid('Invalid category ID.'),
})
