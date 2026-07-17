import { z } from 'zod'

export const getMenuQuerySchema = z.object({
  category: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
})

export type GetMenuQuery = z.infer<typeof getMenuQuerySchema>

export const MENU_ITEM_STATUSES = ['available', 'out_of_stock'] as const

const tagsField = z
  .union([z.array(z.string()), z.string()])
  .transform((value) =>
    Array.isArray(value)
      ? value.map((tag) => tag.trim()).filter(Boolean)
      : value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
  )

export const createMenuItemSchema = z.object({
  category_id: z.uuid('Invalid category ID.'),
  name: z.string().trim().min(1, 'Menu name is required.'),
  price: z.coerce.number().int().min(0, 'Price cannot be negative.'),
  description: z.string().trim().min(1).optional(),
  tags: tagsField.optional(),
  status: z.enum(MENU_ITEM_STATUSES).optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
})

export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>

// Catatan: tidak ada .refine "minimal satu field" di sini — PATCH boleh hanya
// mengganti gambar tanpa mengubah field teks apa pun. Kombinasi "tidak ada field
// & tidak ada file" divalidasi di controller (lihat menu.controller.ts).
export const updateMenuItemSchema = z.object({
  category_id: z.uuid('Invalid category ID.').optional(),
  name: z.string().trim().min(1, 'Menu name is required.').optional(),
  price: z.coerce.number().int().min(0, 'Price cannot be negative.').optional(),
  description: z.string().trim().min(1).optional(),
  tags: tagsField.optional(),
  status: z.enum(MENU_ITEM_STATUSES).optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
})

export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>

export const menuItemIdParamSchema = z.object({
  id: z.uuid('Invalid menu ID.'),
})
