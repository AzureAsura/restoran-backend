import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { hashPassword } from 'better-auth/crypto'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const OWNER_SEED_PASSWORD = 'Owner#12345'
const CASHIER_SEED_PASSWORD = 'Cashier#12345'
const KITCHEN_SEED_PASSWORD = 'Kitchen#12345'

const img = (id: string) => `https://images.unsplash.com/photo-${id}?w=400&h=300&fit=crop`

// Mirrors exactly what better-auth's own sign-up handler stores (accountId =
// user id, providerId = "credential"), so the normal /api/auth/sign-in/email
// flow can verify it.
async function createStaffAccount(name: string, email: string, password: string, role: string) {
  const user = await prisma.user.create({
    data: { name, email, emailVerified: true, role, isActive: true },
  })
  await prisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      password: await hashPassword(password),
    },
  })
  return user
}

async function main() {
  // Wipe in FK-safe order so this script is re-runnable on a dev database.
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.booking.deleteMany()
  await prisma.menuItem.deleteMany()
  await prisma.menuCategory.deleteMany()
  await prisma.table.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.user.deleteMany()
  await prisma.restaurant.deleteMany()

  const restaurant = await prisma.restaurant.create({
    data: {
      name: 'Megatha Restaurant & Lounge',
      slug: 'megatha',
      description: 'Traditional Indonesian eatery',
      address: 'Jl. Sunset Road No. 88, Seminyak, Bali, Indonesia',
      phone: '+62 361 123 4567',
      email: 'info@megatha.com',
      openingHours: {
        monday: '17:00-23:00',
        tuesday: '17:00-23:00',
        wednesday: '17:00-23:00',
        thursday: '17:00-23:00',
        // Landing page shows "Fri-Sun 16:00-00:00" (past midnight). Stored as
        // 23:59 instead of 00:00 — assertWithinOperatingHours (booking.service.ts)
        // compares HH:MM strings within the same calendar day, so a literal
        // "00:00" close would make every time fail the `< close` check.
        friday: '16:00-23:59',
        saturday: '16:00-23:59',
        sunday: '16:00-23:59',
      },
      settings: { hold_time_minutes: 15, tax_rate: 10, service_charge: 5 },
    },
  })

  const tables = [
    { name: 'Table 1', area: 'indoor', capacity: 2 },
    { name: 'Table 2', area: 'indoor', capacity: 2 },
    { name: 'Table 3', area: 'indoor', capacity: 4 },
    { name: 'Table 4', area: 'indoor', capacity: 4 },
    { name: 'Table 5', area: 'indoor', capacity: 6 },
    { name: 'Table 6', area: 'indoor', capacity: 6 },
    { name: 'Table 7', area: 'indoor', capacity: 8 },
    { name: 'Table 8', area: 'indoor', capacity: 8 },
    { name: 'Table 9', area: 'indoor', capacity: 4 },
    { name: 'Table 10', area: 'indoor', capacity: 4 },
    { name: 'Table 11', area: 'outdoor', capacity: 2 },
    { name: 'Table 12', area: 'outdoor', capacity: 2 },
    { name: 'Table 13', area: 'outdoor', capacity: 4 },
    { name: 'Table 14', area: 'outdoor', capacity: 4 },
    { name: 'Table 15', area: 'outdoor', capacity: 6 },
    { name: 'Table 16', area: 'outdoor', capacity: 6 },
    { name: 'Table 17', area: 'outdoor', capacity: 8 },
    { name: 'Table 18', area: 'outdoor', capacity: 8 },
    { name: 'Table 19', area: 'outdoor', capacity: 4 },
    { name: 'Table 20', area: 'outdoor', capacity: 4 },
  ]
  await prisma.table.createMany({
    data: tables.map((t, i) => ({
      restaurantId: restaurant.id,
      name: t.name,
      area: t.area,
      capacity: t.capacity,
      sortOrder: i + 1,
    })),
  })

  const categories = await Promise.all(
    [
      { name: 'Food', sortOrder: 1 },
      { name: 'Beverages', sortOrder: 2 },
      { name: 'Dessert', sortOrder: 3 },
    ].map((c) =>
      prisma.menuCategory.create({
        data: { restaurantId: restaurant.id, name: c.name, sortOrder: c.sortOrder },
      }),
    ),
  )
  const [makanan, minuman, dessert] = categories

  const menuItems = [
    // Makanan
    {
      category: makanan,
      name: 'Mixed Rice Platter',
      price: 2500,
      description: 'White rice with a complete side selection: chicken, tempeh, vegetables, and sambal.',
      image: img('1512058564366-18510be2db19'),
      tags: ['best_seller'],
      sortOrder: 1,
    },
    {
      category: makanan,
      name: 'Crispy Fried Chicken',
      price: 2200,
      description: 'Crispy fried chicken topped with savory crispy kremes flakes.',
      image: img('1512621776951-a57141f2eefd'),
      tags: ['best_seller'],
      sortOrder: 2,
    },
    {
      category: makanan,
      name: 'Balinese Spiced Grilled Chicken',
      price: 2400,
      description: 'Grilled chicken with sweet and spicy Balinese-style seasoning.',
      image: img('1567620905732-2d1ec7ab7445'),
      tags: ['spicy'],
      sortOrder: 3,
    },
    {
      category: makanan,
      name: 'Beef Rendang',
      price: 3200,
      description: 'Tender beef slow-cooked in rich Padang-style spices.',
      image: img('1546069901-ba9599a7e63c'),
      tags: ['best_seller', 'spicy'],
      sortOrder: 4,
    },
    {
      category: makanan,
      name: 'Chicken Satay',
      price: 2000,
      description: '10 skewers of chicken satay served with peanut sauce.',
      image: img('1585032226651-759b368d7246'),
      tags: [],
      sortOrder: 5,
    },
    {
      category: makanan,
      name: 'Gado-Gado',
      price: 1800,
      description: 'Fresh vegetables with peanut sauce dressing.',
      image: img('1504674900247-0877df9cc836'),
      tags: ['vegetarian'],
      sortOrder: 6,
    },
    {
      category: makanan,
      name: 'Javanese Fried Noodles',
      price: 2000,
      description: 'Fried noodles with Javanese-style seasoning and egg.',
      image: img('1544025162-d76694265947'),
      tags: [],
      sortOrder: 7,
    },
    {
      category: makanan,
      name: 'Kampung-Style Fried Rice',
      price: 2100,
      description: 'Fried rice with anchovies and terasi sambal.',
      image: img('1512152272829-e3139592d56f'),
      tags: ['spicy', 'new'],
      sortOrder: 8,
    },
    // Minuman
    {
      category: minuman,
      name: 'Iced Sweet Tea',
      price: 600,
      description: 'Refreshing cold sweet tea.',
      image: img('1551504734-5ee1c4a1479b'),
      tags: [],
      sortOrder: 1,
    },
    {
      category: minuman,
      name: 'Iced Orange Juice',
      price: 800,
      description: 'Freshly squeezed orange juice with ice.',
      image: img('1553530666-ba11a7da3888'),
      tags: [],
      sortOrder: 2,
    },
    {
      category: minuman,
      name: 'Traditional Brewed Coffee',
      price: 1000,
      description: 'Traditional black coffee, brewed directly.',
      image: img('1571091718767-18b5b1457add'),
      tags: [],
      sortOrder: 3,
    },
    {
      category: minuman,
      name: 'Iced Young Coconut',
      price: 1200,
      description: 'Fresh young coconut with ice.',
      image: img('1560717845-968823efbee1'),
      tags: ['best_seller'],
      sortOrder: 4,
    },
    {
      category: minuman,
      name: 'Avocado Juice',
      price: 1500,
      description: 'Creamy avocado juice with chocolate syrup.',
      image: img('1476224203421-9ac39bcb3327'),
      tags: [],
      sortOrder: 5,
    },
    {
      category: minuman,
      name: 'Warm Plain Tea',
      price: 500,
      description: 'Warm unsweetened tea.',
      image: img('1542826438-bd32f43d626f'),
      tags: [],
      sortOrder: 6,
    },
    // Dessert
    {
      category: dessert,
      name: 'Mixed Ice Dessert',
      price: 1500,
      description: 'A mix of shaved ice, fruit, and colorful syrup.',
      image: img('1546833999-b9f581a1996d'),
      tags: ['best_seller'],
      sortOrder: 1,
    },
    {
      category: dessert,
      name: 'Fried Banana with Chocolate & Cheese',
      price: 1300,
      description: 'Fried banana topped with chocolate and cheese.',
      image: img('1571877227200-a0d98ea607e9'),
      tags: ['new'],
      sortOrder: 2,
    },
    {
      category: dessert,
      name: 'Klepon',
      price: 1000,
      description: 'Traditional rice cake filled with palm sugar and coated in grated coconut.',
      image: img('1608219992759-8d74ed8d76eb'),
      tags: [],
      sortOrder: 3,
    },
    {
      category: dessert,
      name: 'Chocolate Pudding',
      price: 1200,
      description: 'Soft chocolate pudding with vanilla custard.',
      image: img('1547592180-85f173990554'),
      tags: [],
      sortOrder: 4,
    },
  ]

  await prisma.menuItem.createMany({
    data: menuItems.map((m) => ({
      restaurantId: restaurant.id,
      categoryId: m.category.id,
      name: m.name,
      price: m.price,
      description: m.description,
      imageUrl: m.image,
      tags: m.tags,
      sortOrder: m.sortOrder,
    })),
  })

  const owner = await createStaffAccount('Made Wirawan', 'owner@megatha.com', OWNER_SEED_PASSWORD, 'owner')
  const cashier = await createStaffAccount('Siti Rahayu', 'cashier@megatha.com', CASHIER_SEED_PASSWORD, 'cashier')
  const kitchen = await createStaffAccount('Joko Prasetyo', 'kitchen@megatha.com', KITCHEN_SEED_PASSWORD, 'kitchen')

  console.log('Seed complete:', {
    restaurant: restaurant.name,
    tables: tables.length,
    categories: categories.length,
    menuItems: menuItems.length,
    ownerLogin: { email: owner.email, password: OWNER_SEED_PASSWORD },
    cashierLogin: { email: cashier.email, password: CASHIER_SEED_PASSWORD },
    kitchenLogin: { email: kitchen.email, password: KITCHEN_SEED_PASSWORD },
  })
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
