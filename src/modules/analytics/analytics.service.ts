import { prisma } from '../../lib/prisma'
import { formatUsd } from '../../utils/currency'
import { toDbDate, todayInJakarta } from '../booking/booking.service'
import type { GetAnalyticsQuery, GetMenuPerformanceQuery, GetRevenueQuery } from './analytics.schema'

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

// ── Revenue report (Keuangan — /admin/finance) ──

// Jakarta-local Y-M-D of a UTC instant — same idiom as todayInJakarta()
// (booking.service.ts), reused here to read calendar boundaries back out of
// the UTC instants produced by jakartaDayRange().
function jakartaDateStringOf(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

// Normalizes possibly-overflowing Y/M/D (e.g. month 13, day 0/negative) into
// a valid Y-M-D string via Date.UTC's built-in rollover. This is a neutral
// calendar calculator, not a real timezone conversion — only the Y-M-D
// digits are ever read back.
function jakartaDateString(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

// Jakarta-local hour (0-23) of a UTC instant — same idiom as
// nowTimeInJakarta() (table.service.ts), generalized to an arbitrary Date
// instead of just "now". paidAt is a real timestamp (unlike Booking's
// bookingTime, which is already wall-clock and just needs getUTCHours()).
function jakartaHourOf(date: Date): number {
  return Number(date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }).slice(0, 2))
}

function revenuePeriodRange(period: GetRevenueQuery['period'], anchor: string) {
  const [year, month, day] = anchor.split('-').map(Number)

  if (period === 'year') {
    return {
      start: jakartaDayRange(`${year}-01-01`).start,
      end: jakartaDayRange(jakartaDateString(year + 1, 1, 1)).start,
    }
  }

  if (period === 'month') {
    return {
      start: jakartaDayRange(jakartaDateString(year, month, 1)).start,
      end: jakartaDayRange(jakartaDateString(year, month + 1, 1)).start,
    }
  }

  // week: Monday–Sunday (ISO) containing the anchor date.
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0=Sun..6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7
  const monday = jakartaDayRange(jakartaDateString(year, month, day - daysSinceMonday)).start
  return { start: monday, end: new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000) }
}

// An anchor date landing in the period immediately before the given one —
// feeding it back into revenuePeriodRange() recomputes the correct bounds
// (only week needs raw day arithmetic; month/year just step year/month).
function previousPeriodAnchor(period: GetRevenueQuery['period'], anchor: string): string {
  const [year, month, day] = anchor.split('-').map(Number)

  if (period === 'year') return jakartaDateString(year - 1, 1, 1)
  if (period === 'month') return jakartaDateString(year, month - 1, 1)
  return jakartaDateString(year, month, day - 7) // any day 7 back still lands in the previous ISO week
}

type RevenueOrderRow = { paidAt: Date | null; total: number; subtotal: number; tax: number; serviceCharge: number; paymentGroupId: string | null; id: string }

// Orders paid together via pay-batch (order.service.ts) share one
// paymentGroupId and identical paidAt — so grouping by this key (falling
// back to the order's own id when unset) counts a merged struk as a single
// transaction instead of double-counting it, without affecting the summed
// money fields (those stay a plain per-row sum either way).
function revenueGroupKey(row: { paymentGroupId: string | null; id: string }): string {
  return row.paymentGroupId ?? row.id
}

// Shared by the current period's summary and the previous period's (for
// growth %) — same total/count/avg computation either way.
function summarizeOrders(rows: { total: number; paymentGroupId: string | null; id: string }[]) {
  const totalRevenue = rows.reduce((sum, r) => sum + r.total, 0)
  const orderCount = new Set(rows.map(revenueGroupKey)).size
  const avgOrderValue = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0
  return { totalRevenue, orderCount, avgOrderValue }
}

// Per-category revenue for the period — queried from OrderItem (not Order)
// since category lives on MenuItem. Deliberately does NOT filter deletedAt
// on menuItem: this is historical financial reporting, so a since-removed
// item's past sales still count toward its category.
async function getRevenueByCategory(start: Date, end: Date) {
  const items = await prisma.orderItem.findMany({
    where: { order: { status: { not: 'cancelled' }, paidAt: { gte: start, lt: end } } },
    select: { qty: true, priceAtTime: true, menuItem: { select: { category: { select: { id: true, name: true } } } } },
  })

  const byCategory = new Map<string, { name: string; revenue: number; qtySold: number }>()
  for (const item of items) {
    const { category } = item.menuItem
    const lineTotal = item.priceAtTime * item.qty
    const existing = byCategory.get(category.id) ?? { name: category.name, revenue: 0, qtySold: 0 }
    existing.revenue += lineTotal
    existing.qtySold += item.qty
    byCategory.set(category.id, existing)
  }

  return [...byCategory.entries()]
    .map(([categoryId, value]) => ({
      category_id: categoryId,
      category: value.name,
      revenue: value.revenue,
      revenue_formatted: formatUsd(value.revenue),
      qty_sold: value.qtySold,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

// Revenue bucketed by Jakarta-local hour of paidAt, restricted to operating
// hours (reuses TIMELINE_START_HOUR/END_HOUR from getBookingTimeline above).
// Built from the same `rows` already fetched for the summary/series — no
// extra query.
function buildHourlyRevenue(rows: RevenueOrderRow[]) {
  const buckets = new Map<number, number>()
  for (let hour = TIMELINE_START_HOUR; hour <= TIMELINE_END_HOUR; hour++) {
    buckets.set(hour, 0)
  }

  for (const row of rows) {
    const hour = jakartaHourOf(row.paidAt!)
    if (buckets.has(hour)) {
      buckets.set(hour, buckets.get(hour)! + row.total)
    }
  }

  return [...buckets.entries()].map(([hour, revenue]) => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    revenue,
    revenue_formatted: formatUsd(revenue),
  }))
}

// Buckets per Jakarta calendar day for week/month, per calendar month for
// year — pre-seeded so empty days/months still appear as zero (same
// approach as getBookingTimeline's hourly buckets above). A pay-batch group
// can never straddle two buckets: all its orders share the exact same
// paidAt instant.
function buildRevenueSeries(period: GetRevenueQuery['period'], start: Date, end: Date, rows: RevenueOrderRow[]) {
  const buckets = new Map<string, { label: string; revenue: number; groups: Set<string> }>()

  if (period === 'year') {
    const year = Number(jakartaDateStringOf(start).slice(0, 4))
    for (let m = 1; m <= 12; m++) {
      const key = jakartaDateString(year, m, 1).slice(0, 7)
      buckets.set(key, { label: String(m).padStart(2, '0'), revenue: 0, groups: new Set() })
    }
  } else {
    for (let t = start.getTime(); t < end.getTime(); t += 24 * 60 * 60 * 1000) {
      const key = jakartaDateStringOf(new Date(t))
      buckets.set(key, { label: key.slice(8, 10), revenue: 0, groups: new Set() })
    }
  }

  for (const row of rows) {
    const dateStr = jakartaDateStringOf(row.paidAt!)
    const key = period === 'year' ? dateStr.slice(0, 7) : dateStr
    const bucket = buckets.get(key)
    if (!bucket) continue // shouldn't happen — paidAt is already range-filtered in the query
    bucket.revenue += row.total
    bucket.groups.add(revenueGroupKey(row))
  }

  return [...buckets.entries()].map(([bucket, value]) => ({
    bucket,
    label: value.label,
    revenue: value.revenue,
    revenue_formatted: formatUsd(value.revenue),
    order_count: value.groups.size,
  }))
}

export async function getRevenueReport(query: GetRevenueQuery) {
  const anchor = query.date ?? todayInJakarta()
  const { start, end } = revenuePeriodRange(query.period, anchor)

  const [rows, previousRows, byCategory] = await Promise.all([
    prisma.order.findMany({
      where: { status: { not: 'cancelled' }, paidAt: { gte: start, lt: end } },
      select: { paidAt: true, total: true, subtotal: true, tax: true, serviceCharge: true, paymentGroupId: true, id: true },
    }),
    (async () => {
      const previousAnchor = previousPeriodAnchor(query.period, anchor)
      const previousRange = revenuePeriodRange(query.period, previousAnchor)
      return prisma.order.findMany({
        where: { status: { not: 'cancelled' }, paidAt: { gte: previousRange.start, lt: previousRange.end } },
        select: { total: true, paymentGroupId: true, id: true },
      })
    })(),
    getRevenueByCategory(start, end),
  ])

  const { totalRevenue, orderCount, avgOrderValue } = summarizeOrders(rows)
  const subtotal = rows.reduce((sum, r) => sum + r.subtotal, 0)
  const tax = rows.reduce((sum, r) => sum + r.tax, 0)
  const serviceCharge = rows.reduce((sum, r) => sum + r.serviceCharge, 0)

  const previousSummary = summarizeOrders(previousRows)
  const growthPercent =
    previousSummary.totalRevenue > 0
      ? Math.round(((totalRevenue - previousSummary.totalRevenue) / previousSummary.totalRevenue) * 100)
      : null

  return {
    period: query.period,
    range: { start: jakartaDateStringOf(start), end: jakartaDateStringOf(end) },
    summary: {
      total_revenue: totalRevenue,
      total_revenue_formatted: formatUsd(totalRevenue),
      subtotal,
      tax,
      service_charge: serviceCharge,
      order_count: orderCount,
      avg_order_value: avgOrderValue,
      avg_order_value_formatted: formatUsd(avgOrderValue),
    },
    previous_period: {
      total_revenue: previousSummary.totalRevenue,
      total_revenue_formatted: formatUsd(previousSummary.totalRevenue),
      // null when the previous period had zero revenue — growth % is
      // undefined there, not a misleading number (e.g. a fake "+100%").
      growth_percent: growthPercent,
    },
    by_category: byCategory,
    by_hour: buildHourlyRevenue(rows),
    series: buildRevenueSeries(query.period, start, end, rows),
  }
}

// ── Reservation analytics (Keuangan — /admin/finance) ──

// index = Date#getUTCDay() (0=Sunday); Booking.bookingDate is stored at
// midnight UTC (see toDbDate in booking.service.ts) so getUTCDay() reads the
// correct calendar weekday directly, no string round-trip needed.
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAY_DISPLAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export async function getReservationAnalytics(query: GetRevenueQuery) {
  const anchor = query.date ?? todayInJakarta()
  const { start, end } = revenuePeriodRange(query.period, anchor)
  // Booking.bookingDate is a plain calendar date (@db.Date, no timezone
  // component) — the period's UTC instants are converted down to Y-M-D
  // bounds so the comparison stays calendar-date semantics, consistent with
  // how bookingDate is treated everywhere else (toDbDate/fromDbDate).
  const startDateStr = jakartaDateStringOf(start)
  const lastDateStr = jakartaDateStringOf(new Date(end.getTime() - 24 * 60 * 60 * 1000))
  const dayCount = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))

  const [bookings, totalTables, revenueRows] = await Promise.all([
    prisma.booking.findMany({
      where: { bookingDate: { gte: toDbDate(startDateStr), lte: toDbDate(lastDateStr) } },
      select: { bookingDate: true, bookingTime: true, tableId: true, status: true },
    }),
    prisma.table.count(),
    prisma.order.findMany({
      where: { status: { not: 'cancelled' }, paidAt: { gte: start, lt: end } },
      select: { total: true, paymentGroupId: true, id: true },
    }),
  ])

  // Occupancy: average across the period of each calendar day's (distinct
  // booked tables / total tables) — same ratio getDailyAnalytics computes
  // for a single day, just averaged over every day in the period.
  const tablesByDay = new Map<string, Set<string>>()
  for (const booking of bookings) {
    if (booking.status === 'cancelled' || !booking.tableId) continue
    const day = jakartaDateStringOf(booking.bookingDate)
    if (!tablesByDay.has(day)) tablesByDay.set(day, new Set())
    tablesByDay.get(day)!.add(booking.tableId)
  }
  const occupancySum = [...tablesByDay.values()].reduce(
    (sum, tables) => sum + (totalTables > 0 ? tables.size / totalTables : 0),
    0,
  )
  const avgOccupancyRate = dayCount > 0 ? Math.round((occupancySum / dayCount) * 100) : 0

  // No-show: rate is measured against "resolved" bookings only (completed +
  // no_show) — a still-confirmed booking hasn't happened yet (outcome
  // unknown) and a cancellation was never a "did they show up" question.
  const noShowCount = bookings.filter((b) => b.status === 'no_show').length
  const resolvedCount = bookings.filter((b) => b.status === 'completed' || b.status === 'no_show').length
  const noShowRatePercent = resolvedCount > 0 ? Math.round((noShowCount / resolvedCount) * 100) : 0
  const { avgOrderValue } = summarizeOrders(revenueRows)
  const estimatedLostRevenue = noShowCount * avgOrderValue

  // Popular times: every booking regardless of status counts — consistent
  // with total_bookings in getDailyAnalytics above.
  const byDayOfWeek = new Map<string, number>(WEEKDAY_DISPLAY_ORDER.map((day) => [day, 0]))
  const byHour = new Map<number, number>()
  for (let hour = TIMELINE_START_HOUR; hour <= TIMELINE_END_HOUR; hour++) byHour.set(hour, 0)

  for (const booking of bookings) {
    const dayName = WEEKDAY_NAMES[booking.bookingDate.getUTCDay()]
    byDayOfWeek.set(dayName, (byDayOfWeek.get(dayName) ?? 0) + 1)
    const hour = booking.bookingTime.getUTCHours()
    if (byHour.has(hour)) byHour.set(hour, byHour.get(hour)! + 1)
  }

  return {
    period: query.period,
    range: { start: startDateStr, end: jakartaDateStringOf(end) },
    occupancy: { avg_rate_percent: avgOccupancyRate },
    no_show: {
      count: noShowCount,
      resolved_count: resolvedCount,
      rate_percent: noShowRatePercent,
      estimated_lost_revenue: estimatedLostRevenue,
      estimated_lost_revenue_formatted: formatUsd(estimatedLostRevenue),
    },
    popular_times: {
      by_day_of_week: WEEKDAY_DISPLAY_ORDER.map((day) => ({ day, booking_count: byDayOfWeek.get(day) ?? 0 })),
      by_hour: [...byHour.entries()].map(([hour, bookingCount]) => ({
        hour: `${String(hour).padStart(2, '0')}:00`,
        booking_count: bookingCount,
      })),
    },
  }
}

// ── Menu financial performance + cross-sell (Keuangan — /admin/finance) ──
//
// Deliberately separate from getMenuPerformance above, which stays untouched
// (Dashboard's operational view: all orders regardless of payment, rolling
// today/week). This one is paid-orders-only, period-based, and fixes two
// gaps that view had: qty_sold sums actual quantity (not just OrderItem row
// count), and never-ordered active items still appear (seeded at 0) instead
// of being silently absent.

const CROSS_SELL_TOP_N = 10

export async function getMenuFinancials(query: GetRevenueQuery) {
  const anchor = query.date ?? todayInJakarta()
  const { start, end } = revenuePeriodRange(query.period, anchor)

  const [activeMenuItems, orders] = await Promise.all([
    prisma.menuItem.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    prisma.order.findMany({
      where: { status: { not: 'cancelled' }, paidAt: { gte: start, lt: end } },
      select: { items: { select: { menuItemId: true, qty: true, priceAtTime: true } } },
    }),
  ])

  const itemStats = new Map<string, { qtySold: number; revenue: number }>(
    activeMenuItems.map((item) => [item.id, { qtySold: 0, revenue: 0 }]),
  )
  for (const order of orders) {
    for (const item of order.items) {
      const stats = itemStats.get(item.menuItemId)
      if (!stats) continue // menu item since deleted — outside this "active menu" report by design
      stats.qtySold += item.qty
      stats.revenue += item.priceAtTime * item.qty
    }
  }

  const menuNameById = new Map(activeMenuItems.map((item) => [item.id, item.name]))
  const items = [...itemStats.entries()]
    .map(([menuItemId, stats]) => ({
      menu_item_id: menuItemId,
      name: menuNameById.get(menuItemId) ?? 'Unknown',
      qty_sold: stats.qtySold,
      revenue: stats.revenue,
      revenue_formatted: formatUsd(stats.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue) // FE sorts ascending itself for "rarely ordered"

  // Cross-sell: tally how often each pair of distinct items co-occurs within
  // the same paid order (dedup first — a repeated menu_item_id in one order
  // shouldn't pair with itself), then keep the top N pairs.
  const pairCounts = new Map<string, number>()
  for (const order of orders) {
    const distinctItemIds = [...new Set(order.items.map((item) => item.menuItemId))]
    for (let i = 0; i < distinctItemIds.length; i++) {
      for (let j = i + 1; j < distinctItemIds.length; j++) {
        const key = [distinctItemIds[i], distinctItemIds[j]].sort().join('|')
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }

  const topPairs = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, CROSS_SELL_TOP_N)

  // Pair members can include since-deleted items (historical fact, same
  // reasoning as by_category) — resolved separately from the active-only
  // `items` list above.
  const pairItemIds = [...new Set(topPairs.flatMap(([key]) => key.split('|')))]
  const pairMenuItems = await prisma.menuItem.findMany({
    where: { id: { in: pairItemIds } },
    select: { id: true, name: true },
  })
  const pairNameById = new Map(pairMenuItems.map((item) => [item.id, item.name]))

  const crossSell = topPairs.map(([key, pairCount]) => {
    const [idA, idB] = key.split('|')
    return {
      menu_item_a: { id: idA, name: pairNameById.get(idA) ?? 'Unknown' },
      menu_item_b: { id: idB, name: pairNameById.get(idB) ?? 'Unknown' },
      pair_count: pairCount,
    }
  })

  return {
    period: query.period,
    range: { start: jakartaDateStringOf(start), end: jakartaDateStringOf(end) },
    items,
    cross_sell: crossSell,
  }
}
