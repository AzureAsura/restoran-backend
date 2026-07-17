import { prisma } from '../../lib/prisma'
import { AppError } from '../../utils/app-error'
import type { CreateMenuCategoryInput, UpdateMenuCategoryInput } from './menu-category.schema'

function toCategoryDTO(category: {
  id: string
  restaurantId: string
  name: string
  sortOrder: number
  isActive: boolean
}) {
  return {
    id: category.id,
    restaurant_id: category.restaurantId,
    name: category.name,
    sort_order: category.sortOrder,
    is_active: category.isActive,
  }
}

export async function listCategories() {
  const categories = await prisma.menuCategory.findMany({
    orderBy: { sortOrder: 'asc' },
  })

  return categories.map(toCategoryDTO)
}

export async function createCategory(input: CreateMenuCategoryInput) {
  const restaurant = await prisma.restaurant.findFirst()
  if (!restaurant) {
    throw new AppError(500, 'RESTAURANT_NOT_CONFIGURED', 'Restaurant data has not been configured.')
  }

  const category = await prisma.menuCategory.create({
    data: {
      restaurantId: restaurant.id,
      name: input.name,
      sortOrder: input.sort_order ?? 0,
    },
  })

  return toCategoryDTO(category)
}

export async function updateCategory(id: string, input: UpdateMenuCategoryInput) {
  const existing = await prisma.menuCategory.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Menu category not found.')
  }

  const category = await prisma.menuCategory.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
      ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
    },
  })

  return toCategoryDTO(category)
}

export async function deleteCategory(id: string) {
  const existing = await prisma.menuCategory.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Menu category not found.')
  }

  const menuItemCount = await prisma.menuItem.count({ where: { categoryId: id, deletedAt: null } })
  if (menuItemCount > 0) {
    throw new AppError(
      409,
      'CATEGORY_IN_USE',
      'This category cannot be deleted because it still has menu items. Deactivate it instead, or move/delete its menu items first.',
    )
  }

  await prisma.menuCategory.delete({ where: { id } })
}
