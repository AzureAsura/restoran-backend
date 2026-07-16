import { z } from 'zod'

export const TABLE_AREAS = ['indoor', 'outdoor'] as const
export const TABLE_STATUSES = ['available', 'reserved', 'occupied', 'maintenance'] as const

export const createTableSchema = z.object({
  name: z.string().trim().min(1, 'Table name is required.'),
  area: z.enum(TABLE_AREAS, { message: 'Area must be indoor or outdoor.' }),
  capacity: z.number().int().min(1).max(20),
  status: z.enum(TABLE_STATUSES).optional(),
  sort_order: z.number().int().min(0).optional(),
})

export type CreateTableInput = z.infer<typeof createTableSchema>

export const updateTableSchema = z
  .object({
    name: z.string().trim().min(1, 'Table name is required.').optional(),
    area: z.enum(TABLE_AREAS, { message: 'Area must be indoor or outdoor.' }).optional(),
    capacity: z.number().int().min(1).max(20).optional(),
    status: z.enum(TABLE_STATUSES).optional(),
    sort_order: z.number().int().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided.')

export type UpdateTableInput = z.infer<typeof updateTableSchema>

export const tableIdParamSchema = z.object({
  id: z.uuid('Invalid table ID.'),
})
