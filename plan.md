# Plan: Struk + Keuangan & Analytics Lengkap

**Status: Fase 1–5 SELESAI & teruji nyata. Fase 6 dst DRAFT — baca dulu, kasih go baru dieksekusi.**

## Context
Awalnya scope-nya "struk + halaman Keuangan dasar" (revenue weekly/monthly/yearly + riwayat struk). Setelah diskusi, scope diperluas jadi **paket analytics keuangan yang proper** untuk resto beneran: growth %, breakdown kategori, revenue per jam, data reservasi (okupansi/no-show/waktu favorit), menu performance yang akurat (qty & revenue, bukan cuma row-count), dan cross-sell analysis. Sekaligus **membenahi bug lama** (`total_walk_ins` yang dari awal menghitung SEMUA order sebagai walk-in karena `booking_id` tidak pernah di-set) — beberapa item wishlist butuh ini benar dulu.

**Prinsip (CLAUDE.md):** reuse maksimal (helper Jakarta yang sudah ada, `formatUsd`, pola groupBy/reduce-in-JS yang sudah dipakai di `getRevenueReport`), split endpoint per domain (ikut pola existing: `/admin/analytics`, `/timeline`, `/menu-performance` sudah terpisah — bukan 1 endpoint raksasa), surgical (endpoint operasional yang sudah dipakai Dashboard **tidak diubah perilakunya**, insight finansial baru dibuat sebagai fungsi/endpoint terpisah).

---

## Keputusan Desain (dikonfirmasi user)

1. **Link booking↔order** (fix bug walk-in): kasir **pilih manual** booking saat bikin order di POS (bukan auto-match). `Order.bookingId` **sudah ada di schema** (cuma belum pernah di-set) — jadi ini bukan migration, cuma wiring.
2. **Estimasi revenue hilang dari no-show**: `no_show_count × avg_order_value` (avg dari periode yang sama, reuse angka yang sudah dihitung revenue report).
3. **Menu "terlaris"/"by revenue"**: dihitung dari **order yang sudah lunas saja** dalam periode — beda dari `menu-performance` yang sudah ada (itu tetap all-orders/operasional, dipakai Dashboard, **tidak disentuh**). Dibuatkan fungsi/endpoint baru khusus Keuangan.
4. **Cross-sell**: top 10 pasangan item yang sering dipesan bareng, dari order lunas di periode terpilih, tanpa UI konfigurasi tambahan.
5. **No-show rate**: penyebut = booking yang statusnya sudah "resolved" (`completed`+`no_show`), bukan semua booking — booking yang masih `confirmed` (belum lewat waktunya) atau `cancelled` tidak relevan buat pertanyaan "apakah dia datang".
6. **Occupancy trend periode**: 1 angka rata-rata (bukan series harian) — dihitung dari occupancy tiap hari kalender dalam periode, dirata-rata. Tidak perlu chart terpisah untuk ini (cukup 1 stat).

---

## ✅ SELESAI (Fase 1–5) — jangan diulang, sudah teruji end-to-end

- **Fase 1**: `Order.paidAt` + `Order.paymentGroupId` (migration, sudah di-apply ke Neon).
- **Fase 2**: `updateOrderPaymentStatus` set/null `paidAt`+`paymentGroupId`; `POST /admin/orders/pay-batch` (bayar+gabung sekaligus, atomic, 1 `groupId`+1 `paidAt` sama persis).
- **Fase 3**: `GET /admin/orders/:id/bill` sekarang bawa `restaurant{name,address,phone,email}` + `paid_at`.
- **Fase 4**: `GET /admin/orders` terima `payment_status`/`paid_from`/`paid_to`; DTO order bawa `payment_group_id`.
- **Fase 5**: `GET /admin/analytics/revenue?period=week|month|year&date=` — summary (`total_revenue`,`order_count`,`avg_order_value`, dst) + `series` per hari(week/month)/bulan(year). `order_count` dihitung distinct `paymentGroupId ?? id` (struk gabungan = 1 transaksi, **sudah diverifikasi nyata**: 2 order dibayar bareng → order_count +1 bukan +2).

Helper yang sudah ada & akan di-reuse: `jakartaDayRange`, `jakartaDateStringOf`, `jakartaDateString`, `revenuePeriodRange` (di `analytics.service.ts`), `revenueGroupKey`, `formatUsd` (BE `utils/currency.ts`).

---

## BACKEND — Fase Baru

### Fase 6: Link booking↔order (fix bug walk-in vs reservasi)
- `order.schema.ts` → `createOrderSchema`: tambah `booking_id: z.uuid().optional()`.
- `order.service.ts` → `createOrder`: kalau `booking_id` diisi, validasi booking exists (404 `BOOKING_NOT_FOUND` kalau tidak) — **tanpa** validasi tabel harus sama persis (kasir yang pegang keputusan, hindari over-validate skenario yang jarang). Set `bookingId: input.booking_id ?? null`.
- `toOrderDTO` **tidak perlu diubah** — `booking_id` sudah ke-expose dari dulu (field lama, cuma selalu null).
- Efek langsung: `total_walk_ins` di `GET /admin/analytics` (`bookingId: null`) jadi akurat begitu FE mulai kirim `booking_id` (Fase 13).

### Fase 7: Revenue breakdown — extend `GET /admin/analytics/revenue`
Masih 1 endpoint (reuse query dasar yang sama, bukan bikin 3 endpoint terpisah untuk 3 hal yang datanya tumpang tindih):
- **`previous_period`**: hitung ulang `revenuePeriodRange` untuk periode sebelum anchor (week: anchor-7 hari; month: bulan sebelumnya; year: tahun sebelumnya), jalankan query+`summarizeOrders` yang sama, `growth_percent = round((current-prev)/prev*100)` — **`null`** kalau `prev.total_revenue === 0` (growth % tak terdefinisi, bukan dipaksa jadi angka menyesatkan).
- **`by_category`**: query `OrderItem` (bukan `Order`) yang order-nya paid+in-range, include `menuItem.category`; reduce di JS jadi `[{category_id, category, revenue, revenue_formatted, qty_sold}]`. **Tidak** filter `deletedAt` menu item (data historis tetap dihitung meski menu sudah dihapus sekarang).
- **`by_hour`**: bucket 08:00–21:00 (reuse `TIMELINE_START_HOUR/END_HOUR` yang sudah ada) dari `paidAt`, pakai jam lokal Jakarta (helper baru `jakartaHourOf(date)`, pola sama `nowTimeInJakarta()` di `table.service.ts`) — beda dari `getBookingTimeline` yang extract jam dari `bookingTime` (`@db.Time`, sudah wall-clock, tidak butuh konversi timezone).
- Refactor kecil: extract `summarizeOrders(rows)` (total/count/avg dari array order) supaya dipakai bareng current+previous period, dan nanti Fase 8.

### Fase 8: Endpoint baru — `GET /admin/analytics/reservations?period=&date=` (owner-only)
Domain Booking, terpisah dari revenue (ikut pola existing: booking-timeline sudah terpisah dari daily-overview).
- **Occupancy**: fetch semua booking (`bookingDate`,`tableId`) non-cancelled dalam periode (1 query), group per hari kalender di JS, occupancy per hari = distinct table / total table, dirata-rata → `avg_occupancy_rate`.
- **No-show**: `no_show_count` (status=no_show), `resolved_count` (status in completed+no_show), `rate_percent = no_show/resolved*100` (0 kalau resolved=0), `estimated_lost_revenue = no_show_count × avgOrderValue` (dari `summarizeOrders` periode yang sama, reuse Fase 7's helper) + `_formatted`.
- **Popular times**: `by_day_of_week` (7 bucket Senin–Minggu, dari `bookingDate`, hitung semua booking apa pun statusnya — konsisten `total_bookings` yang sudah ada) + `by_hour` (14 bucket 08-21, dari `bookingTime`, reuse pola `getBookingTimeline`).

### Fase 9: Endpoint baru — `GET /admin/analytics/menu-financials?period=&date=` (owner-only)
Terpisah dari `menu-performance` yang sudah ada (itu tetap dipakai Dashboard, all-orders, **tidak disentuh**).
- **Items**: base list = SEMUA menu item aktif (`deletedAt: null`) diseed 0 dulu (fix bug "item 0 order tidak muncul") → akumulasi `qty_sold` (sum qty, bukan row-count — fix bug lain) + `revenue` dari order-item yang order-nya **lunas** dalam periode. Return `[{menu_item_id, name, qty_sold, revenue, revenue_formatted}]` sorted by revenue desc — FE tinggal sort ascending buat "jarang dipesan".
- **Cross-sell**: dari order lunas periode itu, per order ambil Set distinct `menuItemId` (dedupe dulu), generate semua pasangan (kombinasi 2), tally frekuensi di `Map`, ambil top 10, resolve nama item. Return `[{menu_item_a:{id,name}, menu_item_b:{id,name}, pair_count}]`.
- Reuse query dasar (order-item lunas dalam periode) yang mirip Fase 7's `by_category` — boleh reuse helper query yang sama kalau shape-nya cocok.

### Fase 10: Docs backend
`context.md` + `backend.md` — mencakup **semua** yang baru dari Fase 1–9 sekaligus (belum sempat didokumentasikan dari fase-fase sebelumnya juga).

---

## FRONTEND — Fase Baru

### Fase 11: Tipe & query hooks
- `types/api.ts`: extend `RevenueReport` (+`previous_period`,+`by_category`,+`by_hour`); tipe baru `ReservationAnalytics`, `MenuFinancials`; `CreateOrderPayload` +`booking_id?`.
- `lib/queries/analytics.ts`: `reservationAnalyticsQueryOptions`, `menuFinancialsQueryOptions`.
- `lib/queries/orders.ts`: `payOrdersBatch`, `paidOrdersQueryOptions` (dari plan lama, belum dibangun).

### Fase 12: Komponen Receipt + print CSS
Sama seperti rencana sebelumnya — `Receipt.tsx` (`bills: OrderBill[]`, gabung & jumlahkan), `@media print` di `globals.css`.

### Fase 13: POS checkout dialog rework + booking picker
- Checkout dialog: checkbox per order aktif, "Tandai Lunas & Cetak" (→`payOrdersBatch`→fetch bills→`Receipt`→print), "Cetak Struk", "Make Available" tak berubah.
- **Baru**: form create-order — kalau meja terpilih punya booking hari ini (`confirmed`/`seated`, filter client-side dari data booking yang sudah di-fetch), tampilkan picker opsional "Link ke booking: [nama - jam]" → kirim `booking_id`.

### Fase 14: Halaman Keuangan lengkap `/admin/finance`
Sambungkan mock-up yang sudah ada ke **semua** data asli sekaligus (bukan bertahap, biar sekali wiring):
- **Ringkasan**: stat cards existing + growth % (badge naik/turun) + breakdown kategori (mini chart/list) + revenue per jam (chart).
- **Riwayat Struk**: dari `paidOrdersQueryOptions`, grouped by `payment_group_id`.
- **Reservasi**: card okupansi rata-rata, no-show rate + estimasi revenue hilang, waktu favorit.
- **Menu Performance (Keuangan)**: tabel qty+revenue per item (sort toggle terlaris/jarang), tabel cross-sell top 10.
- Satu periode selector (Week/Month/Year+anchor) dipakai semua section (3 query paralel: revenue, reservations, menu-financials — pola sama `DashboardBoard`).

### Fase 15: Verifikasi end-to-end penuh
Ulangi checklist verifikasi dari nol untuk **semua** endpoint baru (Fase 6–9) + regresi alur lama (booking, POS, dashboard operasional yang tidak disentuh).

---

## Verifikasi per-fase (pola yang sudah terbukti di Fase 1–5)
Tiap fase backend: `tsc --noEmit` bersih → jalankan dev server → login sungguhan (owner/cashier seed) → curl request nyata (bukan cuma baca kode) → cross-check angka manual → cek log server bersih → matikan server. Tiap fase FE: `tsc --noEmit` + jalan manual di browser.

## Out of scope (masih, sengaja tidak dikerjakan)
Export PDF/CSV/email; nama kasir di struk; kombinasi 2+ meja; print thermal khusus; RLS/security lanjutan; A/B atau ML-based recommendation (cross-sell di sini murni frequency count, bukan model).
