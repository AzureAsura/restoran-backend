import { z } from 'zod'

export const createMenuCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.'),
  sort_order: z.number().int().min(0).optional(),
})

export type CreateMenuCategoryInput = z.infer<typeof createMenuCategorySchema>

export const updateMenuCategorySchema = z
  .object({
    name: z.string().trim().min(1, 'Category name is required.').optional(),
    sort_order: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided.')

export type UpdateMenuCategoryInput = z.infer<typeof updateMenuCategorySchema>

export const categoryIdParamSchema = z.object({
  id: z.uuid('Invalid category ID.'),
})
