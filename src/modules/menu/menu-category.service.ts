import { prisma } from '../../lib/prisma'
import { deleteMenuImage } from '../../lib/cloudinary'
import { AppError } from '../../utils/app-error'
import type { CreateMenuCategoryInput, UpdateMenuCategoryInput } from './menu-category.schema'

function toCategoryDTO(category: {
  id: string
  restaurantId: string
  name: string
  imageUrl: string | null
  sortOrder: number
  isActive: boolean
}) {
  return {
    id: category.id,
    restaurant_id: category.restaurantId,
    name: category.name,
    image_url: category.imageUrl,
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

export async function createCategory(input: CreateMenuCategoryInput, imageUrl: string | null) {
  const restaurant = await prisma.restaurant.findFirst()
  if (!restaurant) {
    throw new AppError(500, 'RESTAURANT_NOT_CONFIGURED', 'Restaurant data has not been configured.')
  }

  const category = await prisma.menuCategory.create({
    data: {
      restaurantId: restaurant.id,
      name: input.name,
      imageUrl,
      sortOrder: input.sort_order ?? 0,
    },
  })

  return toCategoryDTO(category)
}

export async function updateCategory(id: string, input: UpdateMenuCategoryInput, imageUrl: string | null) {
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
      ...(imageUrl !== null ? { imageUrl } : {}),
    },
  })

  if (imageUrl !== null && existing.imageUrl && existing.imageUrl !== imageUrl) {
    await deleteMenuImage(existing.imageUrl)
  }

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

  if (existing.imageUrl) {
    await deleteMenuImage(existing.imageUrl)
  }
}
