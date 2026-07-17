import { prisma } from '../../lib/prisma'
import { deleteMenuImage } from '../../lib/cloudinary'
import { AppError } from '../../utils/app-error'
import type { CreateMenuItemInput, GetMenuQuery, UpdateMenuItemInput } from './menu.schema'

function toMenuItemDTO(item: {
  id: string
  restaurantId: string
  categoryId: string
  name: string
  price: number
  description: string | null
  imageUrl: string | null
  tags: string[]
  status: string
  sortOrder: number
  createdAt: Date
  category?: { id: string; name: string }
}) {
  return {
    id: item.id,
    restaurant_id: item.restaurantId,
    category_id: item.categoryId,
    name: item.name,
    price: item.price,
    description: item.description,
    image_url: item.imageUrl,
    tags: item.tags,
    status: item.status,
    sort_order: item.sortOrder,
    created_at: item.createdAt,
    ...(item.category ? { category: item.category } : {}),
  }
}

export async function getMenuGroupedByCategory(query: GetMenuQuery) {
  const categories = await prisma.menuCategory.findMany({
    where: {
      isActive: true,
      ...(query.category ? { name: { equals: query.category, mode: 'insensitive' } } : {}),
    },
    orderBy: { sortOrder: 'asc' },
    include: {
      menuItems: {
        where: {
          deletedAt: null,
          ...(query.tag ? { tags: { has: query.tag } } : {}),
          ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  return categories
    .filter((category) => category.menuItems.length > 0)
    .map((category) => ({
      category: {
        id: category.id,
        restaurant_id: category.restaurantId,
        name: category.name,
        image_url: category.imageUrl,
        sort_order: category.sortOrder,
        is_active: category.isActive,
      },
      items: category.menuItems.map(toMenuItemDTO),
    }))
}

export async function listAdminMenu() {
  const items = await prisma.menuItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { sortOrder: 'asc' }],
    include: { category: { select: { id: true, name: true } } },
  })

  return items.map(toMenuItemDTO)
}

async function assertCategoryExists(categoryId: string) {
  const category = await prisma.menuCategory.findUnique({ where: { id: categoryId } })
  if (!category) {
    throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Menu category not found.')
  }
}

export async function createMenuItem(input: CreateMenuItemInput, imageUrl: string | null) {
  const restaurant = await prisma.restaurant.findFirst()
  if (!restaurant) {
    throw new AppError(500, 'RESTAURANT_NOT_CONFIGURED', 'Restaurant data has not been configured.')
  }

  await assertCategoryExists(input.category_id)

  const item = await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: input.category_id,
      name: input.name,
      price: input.price,
      description: input.description ?? null,
      imageUrl,
      tags: input.tags ?? [],
      status: input.status ?? 'available',
      sortOrder: input.sort_order ?? 0,
    },
    include: { category: { select: { id: true, name: true } } },
  })

  return toMenuItemDTO(item)
}

export async function updateMenuItem(id: string, input: UpdateMenuItemInput, imageUrl: string | null) {
  const existing = await prisma.menuItem.findUnique({ where: { id } })
  if (!existing || existing.deletedAt) {
    throw new AppError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.')
  }

  if (input.category_id !== undefined) {
    await assertCategoryExists(input.category_id)
  }

  const item = await prisma.menuItem.update({
    where: { id },
    data: {
      ...(input.category_id !== undefined ? { categoryId: input.category_id } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
      ...(imageUrl !== null ? { imageUrl } : {}),
    },
    include: { category: { select: { id: true, name: true } } },
  })

  if (imageUrl !== null && existing.imageUrl && existing.imageUrl !== imageUrl) {
    await deleteMenuImage(existing.imageUrl)
  }

  return toMenuItemDTO(item)
}

export async function softDeleteMenuItem(id: string) {
  const existing = await prisma.menuItem.findUnique({ where: { id } })
  if (!existing || existing.deletedAt) {
    throw new AppError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.')
  }

  await prisma.menuItem.update({ where: { id }, data: { deletedAt: new Date() } })

  if (existing.imageUrl) {
    await deleteMenuImage(existing.imageUrl)
  }
}
