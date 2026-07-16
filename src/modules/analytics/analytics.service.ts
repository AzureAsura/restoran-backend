import { prisma } from '../../lib/prisma'
import { toDbDate, todayInJakarta } from '../booking/booking.service'
import type { GetAnalyticsQuery, GetMenuPerformanceQuery } from './analytics.schema'

function jakartaDayRange(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00+07:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

export async function getDailyAnalytics(query: GetAnalyticsQuery) {
  const date = query.date ?? todayInJakarta()
  const bookingDate = toDbDate(date)
  const { start, end } = jakartaDayRange(date)

  const [totalBookings, totalWalkIns, revenueAgg, bookedTables, totalTables, noShowCount, topMenuRaw] =
    await Promise.all([
      prisma.booking.count({ where: { bookingDate } }),
      prisma.order.count({ where: { bookingId: null, createdAt: { gte: start, lt: end } } }),
      prisma.order.aggregate({
        where: { status: { not: 'cancelled' }, createdAt: { gte: start, lt: end } },
        _sum: { total: true },
      }),
      prisma.booking.findMany({
        where: { bookingDate, status: { not: 'cancelled' }, tableId: { not: null } },
        select: { tableId: true },
        distinct: ['tableId'],
      }),
      prisma.table.count(),
      prisma.booking.count({ where: { bookingDate, status: 'no_show' } }),
      prisma.orderItem.groupBy({
        by: ['menuItemId'],
        where: { order: { status: { not: 'cancelled' }, createdAt: { gte: start, lt: end } } },
        _count: { menuItemId: true },
        orderBy: { _count: { menuItemId: 'desc' } },
        take: 5,
      }),
    ])

  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: topMenuRaw.map((item) => item.menuItemId) } },
  })
  const menuNameById = new Map(menuItems.map((item) => [item.id, item.name]))

  const menuTop = topMenuRaw.map((item) => ({
    name: menuNameById.get(item.menuItemId) ?? 'Unknown',
    order_count: item._count.menuItemId,
  }))

  const occupancyRate = totalTables > 0 ? Math.round((bookedTables.length / totalTables) * 100) : 0

  return {
    total_bookings: totalBookings,
    total_walk_ins: totalWalkIns,
    total_revenue: revenueAgg._sum.total ?? 0,
    occupancy_rate: occupancyRate,
    no_show_count: noShowCount,
    menu_top: menuTop,
  }
}

// Restaurant opens 08:00, closes 22:00 (exclusive upper bound — same convention
// as assertWithinOperatingHours in booking.service.ts), so hourly buckets run
// 08:00 through 21:00 (14 buckets).
const TIMELINE_START_HOUR = 8
const TIMELINE_END_HOUR = 21

export async function getBookingTimeline(query: GetAnalyticsQuery) {
  const date = query.date ?? todayInJakarta()
  const bookingDate = toDbDate(date)

  // No status filter — matches total_bookings above (counts every booking for
  // the day regardless of status), not just confirmed/completed ones.
  const bookings = await prisma.booking.findMany({
    where: { bookingDate },
    select: { bookingTime: true },
  })

  const countByHour = new Map<number, number>()
  for (const booking of bookings) {
    const hour = booking.bookingTime.getUTCHours()
    countByHour.set(hour, (countByHour.get(hour) ?? 0) + 1)
  }

  const timeline = []
  for (let hour = TIMELINE_START_HOUR; hour <= TIMELINE_END_HOUR; hour++) {
    timeline.push({
      hour: `${String(hour).padStart(2, '0')}:00`,
      booking_count: countByHour.get(hour) ?? 0,
    })
  }

  return timeline
}

// "week" = trailing 7 days ending today (rolling window), not calendar
// Mon-Sun — simpler and more common for a lightweight dashboard like this.
function menuPerformanceDateRange(range: GetMenuPerformanceQuery['range']) {
  const { start: todayStart, end: todayEnd } = jakartaDayRange(todayInJakarta())

  if (range === 'today') {
    return { start: todayStart, end: todayEnd }
  }

  const start = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
  return { start, end: todayEnd }
}

export async function getMenuPerformance(query: GetMenuPerformanceQuery) {
  const { start, end } = menuPerformanceDateRange(query.range)

  const performanceRaw = await prisma.orderItem.groupBy({
    by: ['menuItemId'],
    where: { order: { status: { not: 'cancelled' }, createdAt: { gte: start, lt: end } } },
    _count: { menuItemId: true },
    orderBy: { _count: { menuItemId: 'desc' } },
  })

  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: performanceRaw.map((item) => item.menuItemId) } },
  })
  const menuNameById = new Map(menuItems.map((item) => [item.id, item.name]))

  return performanceRaw.map((item) => ({
    menu_item_id: item.menuItemId,
    name: menuNameById.get(item.menuItemId) ?? 'Unknown',
    order_count: item._count.menuItemId,
  }))
}
