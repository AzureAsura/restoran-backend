# Context — Referensi Teknis Backend Megatha Kitchen

**Terakhir diupdate:** 16 Juli 2026
**Tujuan file ini:** referensi teknis & gotcha yang perlu diingat kalau lanjut ngoding backend ini, plus catatan deploy Vercel (§4). Detail requirement/kontrak API lengkap ada di `backend.md`.

**Status:** Semua FR di `backend.md` sudah diimplementasi **kecuali AI Concierge** (`/ai/chat`, seluruh §10 `backend.md`) — `src/modules/ai/*` masih placeholder kosong.

---

## 1. Cara jalanin dev

```bash
cd backend
npm run dev          # nodemon + ts-node, port 4000 (dari .env)
npm run db:seed      # reset data ke seed bersih kalau perlu
```

Login dev (di-seed via `prisma/seed.ts`, helper `createStaffAccount`):
- Owner: `owner@warungbagas.id` / `Owner#12345`
- Cashier: `cashier@warungbagas.id` / `Cashier#12345`
- Kitchen: `kitchen@warungbagas.id` / `Kitchen#12345`

Testing manual pakai Postman collection di `backend/postman/` (`megatha-kitchen-auth` + `megatha-kitchen-core`) — selalu attach header `Origin: http://localhost:3000` buat request yang butuh cookie session (better-auth CSRF check, browser asli kirim otomatis tapi Postman/curl tidak).

---

## 2. Gotcha & konvensi teknis

### Prisma & Migration
1. **Prisma 7 tidak terima `url` di `datasource` block schema.prisma.** URL migrate ada di `prisma.config.ts` (`defineConfig({ datasource: { url: env('DATABASE_URL') } })`), runtime client pakai driver adapter (`new PrismaPg({ connectionString })` → `new PrismaClient({ adapter })`).
2. **`idx_vector_store_embedding` (ivfflat) dan `idx_bookings_no_conflict` (partial unique) tidak terekspresikan di `schema.prisma`.** Prisma selalu anggap ini "drift" tiap `prisma migrate dev` tanpa `--create-only`, dan **otomatis siapkan migration yang men-DROP index tersebut**. **SELALU** pakai `prisma migrate dev --create-only` dulu, cek isi SQL, buang baris `DROP INDEX` kalau ada, baru apply.
3. **Jangan pernah edit `migration.sql` yang sudah ter-apply** — checksum mismatch, Prisma minta `migrate reset` (drop semua data). Catatan tambahan soal suatu migration taruh di `backend.md`, bukan di file migration-nya.
4. **`prisma migrate dev` bisa hang** nunggu interactive prompt kalau ada drift lanjutan (biasanya terkait poin 2) — cek proses (`pgrep -fl "prisma migrate dev"`) dan kill manual kalau macet.
5. **`prisma migrate dev` menolak jalan non-interactive kalau ada warning** (mis. tambah unique constraint ke tabel yang sudah ada) — tulis migration folder+SQL manual, apply pakai `prisma migrate deploy`.
6. **Prisma 7 punya AI-agent safety guard** — kalau Claude coba jalankan `migrate reset`/perintah destruktif lain, Prisma block dan minta konfirmasi eksplisit user (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`).
7. **Prisma 7 `groupBy` tidak izinkan `_count: { _all: true }` di `orderBy`** — harus order by field spesifik (`_count: { menuItemId: true }` + `orderBy: { _count: { menuItemId: 'desc' } }`).

### Express & Auth
- **Express 5** butuh named wildcard `/api/auth/*splat` (bukan `/api/auth/*`). better-auth harus di-mount pakai `app.all(...)`, **bukan** `app.use(...)` — `app.use` strip prefix path dari `req.url` sebelum sampai ke handler.
- **better-auth ESM-only**, project CommonJS — aman karena Node 22 native `require(esm)`, tidak perlu migrasi project ke ESM.
- **`tsconfig.json` wajib punya `"files": ["src/types/express.d.ts"]`** — supaya `ts-node`/`nodemon` ikut load augmentasi type `req.user`/`req.session`.
- **Cookie session (`src/lib/auth.ts`)**: better-auth default `sameSite: "lax"` selalu. Fix-nya `advanced.defaultCookieAttributes` **kondisional ke `env.nodeEnv === 'production'`** → `{ sameSite: 'none', secure: true }`, dibiarkan `{}` di dev. **JANGAN PERNAH paksa ini aktif global** — `SameSite=None` wajib dibarengi `Secure`, dan `Secure` di `http://localhost` (bukan https) bikin browser gak akan pernah simpan/kirim cookie sama sekali → staff gak bisa login di dev. Catatan: curl gak menegakkan `SameSite`, jadi testing manual via curl gak akan pernah ketauan kalau setting ini salah — kudu cek `Set-Cookie` header langsung.

### Env & Cloudinary
- **`.env` butuh 3 var terpisah**: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (bukan cuma `CLOUDINARY_URL`) — `env.ts`/`lib/cloudinary.ts` baca 3 var itu, `cloud_name` kosong kalau cuma `CLOUDINARY_URL` yang diisi.
- **Cloudinary `403 missing permissions`** = API key yang dipakai scoped/kurang izin upload di dashboard Cloudinary, bukan bug kode — solusinya ganti izin key atau pakai key master di Cloudinary console.

### Rate Limiting (`src/middlewares/rate-limit.ts`)
- 3 limiter: `generalRateLimiter` (100 req/menit per IP, dipasang di semua route publik — `/bookings`, `/menu`, `/ai`, `/api/auth/*`, `/internal/cron/no-show`, **berbagi 1 bucket** bukan per-route), `bookingRateLimiter` (10 req/jam per IP, tambahan khusus di `POST /bookings`, jadi dua lapis), `adminRateLimiter` (300 req/menit per `req.user.id` — bukan IP — dipasang di semua mount `/admin/*` **setelah** `requireAuth`).
- **⚠️ `express-rate-limit` v8**: `keyGenerator` custom yang fallback ke IP **wajib** pakai helper `ipKeyGenerator(ip)`, bukan `req.ip` polos — library cek *source text* function-nya saat setup, langsung `throw` (`ERR_ERL_KEY_GEN_IPV6`) kalau ketemu `req.ip` tanpa helper itu (proteksi IPv6 bypass). Error muncul saat runtime module load, bukan `tsc`.
- `Retry-After` header otomatis (default `legacyHeaders: true` cukup). Body 429 ikut kontrak API (`{success:false, error:{code,message}}`) via opsi `message` sebagai object — `res.send(object)` otomatis jadi `res.json()`, gak perlu custom `handler`.
- **In-memory store belum aman untuk Vercel Functions** — lihat §4 checklist deploy.

### Booking & Table
- **Table assignment untuk booking = deterministik**, bukan AI — cari meja kapasitas cukup + area match + tidak konflik di slot sama, prioritas kapasitas terkecil dulu.
- **Walk-in (`POST /admin/orders`) = pilih meja MANUAL** oleh cashier (`table_id` wajib di request), **beda dari booking** yang auto-assign — kasir sudah tau persis pelanggan duduk di mana (grid visual POS).
- **Kombinasi 2+ meja untuk party besar BELUM didukung** — schema `Booking` cuma satu `tableId`. Party > kapasitas meja terbesar (8) dapat `409 NO_TABLE_AVAILABLE`.
- **Anti double-booking**: dicek di application layer (query count per kandidat meja dalam transaction) **+** partial unique index database (`idx_bookings_no_conflict`) sebagai jaring pengaman terakhir.
- `booking_code` format `{inisial nama resto}-{DDMMYYYY}-{urutan 3 digit}`, urutan dihitung per restoran+tanggal (lintas area).
- **`PATCH /admin/bookings/:id` dan `PATCH /admin/orders/:id` (payment_status) tidak menegakkan aturan transisi status** — bisa loncat status apa saja ke apa saja, cuma validasi value.
- Filter `area` di `GET /admin/bookings` match ke **`table.area`** (meja ter-assign), bukan `areaPreference` booking.
- `GET /admin/bookings` dan `GET /admin/analytics` default `date` ke hari ini (Asia/Jakarta) kalau tidak diisi.
- Response API pakai **snake_case** di boundary, internal Prisma tetap camelCase — mapper manual di tiap service.
- Error handling: `AppError` (statusCode+code) di-throw dari service, ditangkap `errorHandler` global — controller **tidak perlu** try/catch manual (Express 5 auto-forward promise rejection).
- Routing: modul dengan split publik/admin (booking) export **dua router**; modul lain (table/order/kitchen/analytics/menu) pakai **satu router**, role guard per-route (`requireRole` di `*.routes.ts`), `requireAuth` di level mount `app.ts`.
- **DELETE meja** = block-if-referenced (409 `TABLE_IN_USE` kalau ada histori booking/order) — retire pakai `status: 'maintenance'`, bukan hapus.

### Customer Profile (`total_visits`, `total_spent`, `no_show_count`, `last_visit_date`)
- Auto-create by phone: booking upsert customer (create+update nama); order cuma create-if-missing (gak pernah update nama).
- `total_visits`/`last_visit_date` naik saat status → `completed` (bukan saat dibuat) — booking no-show/cancel gak kehitung, guard idempotency cek status lama.
- Order gak punya endpoint manual jadi `completed` — auto-derive begitu **semua** `OrderItem` jadi `served` (`completeOrderIfAllItemsServed` di `order.service.ts`, dipanggil dari `kitchen.service.ts`). Saat itu `total_spent += order.total`.
- `no_show_count` naik lewat cron/endpoint no-show saja, bukan lewat `PATCH /admin/bookings/:id`.

### Sync Status Meja (`available`/`reserved`/`occupied`/`maintenance`)
- `occupied`/`available`: stored column, toggle di `order.service.ts` — balik `available` saat order auto-complete **cuma kalau gak ada order `active` lain** di meja yang sama.
- `reserved`: **dihitung live** saat `GET /admin/tables` (bukan stored+trigger) — overlay jadi `reserved` cuma kalau status tersimpan `available` **dan** ada booking `confirmed` hari ini yang jamnya belum lewat. Prioritas: `maintenance`/`occupied` (stored) > `reserved` (computed) > `available`.
- `maintenance` selalu manual (satu-satunya alasan kolom `status` masih stored, bukan full computed).

### Menu Management (`/admin/menu`, `/admin/menu-categories`)
- **`MenuItem` soft-delete via `deletedAt DateTime?`** — bukan overload `status` (available/out_of_stock, itu ketersediaan operasional) atau `isActive` (dipakai category). Semua query publik & admin filter `deletedAt: null`.
- **`MenuCategory` delete = soft delete `isActive: false`** (kolom sudah ada, tanpa migration) — hard delete gak dipakai karena kategori hampir selalu punya menu item/riwayat order.
- **Cloudinary asset gak dibersihkan** saat item soft-delete atau gambar diganti (schema cuma simpan `secure_url`, tak simpan `public_id`) — gambar "yatim" menumpuk di folder `megatha/menu`, sengaja ditunda (MVP).
- **`PATCH /admin/menu/:id` boleh cuma ganti gambar** tanpa field teks — validasi "minimal 1 perubahan" ada di controller (bukan Zod `.refine`) supaya bisa cek `req.file` juga.
- Endpoint tulis (`POST`/`PATCH /admin/menu`) pakai `multipart/form-data` via `multer.single('image')` (memory storage, limit 5MB, filter `image/*`). Field numerik/array di-coerce di Zod karena semua field multipart datang sebagai string.

### Order, Bill & Currency
- **Semua nilai uang (`price`, `subtotal`, `tax`, `serviceCharge`, `total`, `priceAtTime`) adalah integer USD CENTS** — bukan Rupiah, bukan dolar utuh. Gak ada schema change, cuma reinterpretasi unit.
- `formatUsd(cents)` di `src/utils/currency.ts` — **cuma dipakai di `GET /admin/orders/:id/bill`**. Endpoint lain (menu, order list, analytics) sengaja tetap return `Int` mentah, reuse `formatUsd` kalau nanti FE butuh formatted string di tempat lain.
- **Bill (`subtotal`/`tax`/`service_charge`/`total`) dibaca dari kolom yang SUDAH tersimpan di `Order`** (snapshot saat `createOrder`), **bukan** dihitung ulang dari `restaurant.settings` saat ini — kalau tax_rate berubah setelah order dibuat, bill tetap nunjukkin angka asli.
- `tax_rate_percent`/`service_charge_rate_percent` di response bill **di-derive balik** dari angka tersimpan (`tax/subtotal*100`), bukan baca settings langsung — biar persentase selalu match nominal.
- `Order` gak punya kolom tanggal khusus (beda dari `Booking.bookingDate`) — filter `date` di `GET /admin/orders` match `createdAt` dalam rentang 1 hari kalender Jakarta (`startOfDayJakartaUtc` di `order.service.ts`, offset +7 jam manual, aman karena Indonesia gak ada DST).
- `GET /admin/orders`: pagination `{page,limit,total,total_pages}` sibling dari `data` (bukan nested). `date` filter **tidak** default ke hari ini (beda dari bookings/analytics — ini history/audit browsing). `customer_phone` = partial match (`contains`), bukan exact.
- `toOrderDTO` reused di semua response order (create/list/bill/patch), termasuk embed `table: {id,name,area}`.

### Analytics
- Timeline (`GET /admin/analytics/timeline`): bucket jam 08:00-21:00 (14 slot, upper-bound exclusive), **tidak filter status booking** (konsisten sama `total_bookings` di daily overview yang juga gak difilter).
- Menu performance (`GET /admin/analytics/menu-performance?range=`): `range=week` = **rolling 7 hari terakhir**, bukan kalender Senin-Minggu (asumsi desain, bukan dari spec — ganti di `menuPerformanceDateRange()` kalau mau kalender minggu). Return SEMUA item yang pernah keorder (gak dibatasi top-N kayak `menu_top`).
- Kedua endpoint analytics owner-only, gak dipasangi `noStore` (dibuka/refetch manual, bukan di-poll berkala).

### Polling & Realtime (bukan WebSocket!)
- **Gak ada WebSocket/Socket.io** — sengaja di-drop karena backend deploy ke Vercel Functions (serverless, gak bisa nahan koneksi persisten). Semua "live update" FE murni **polling** (TanStack Query `refetchInterval`) ke endpoint GET biasa. **Jangan usulkan WebSocket/Socket.io lagi** kecuali hosting pindah dari serverless.
- `Cache-Control: no-store` (`src/middlewares/no-store.ts`) cuma dipasang di 3 endpoint yang literally di-poll: `GET /admin/kitchen-queue`, `GET /admin/bookings`, `GET /admin/orders`. **Belum diputuskan**: `GET /admin/tables` — `frontend.md` bilang ini juga di-poll tapi `backend.md` §9.1 gak nyebutin, belum di-add.
- No-show detection dual-trigger: `node-cron` (`src/jobs/no-show-cron.ts`, cuma reliable di dev lokal) **dan** `POST /internal/cron/no-show` (HTTP endpoint, auth `CRON_SECRET` bearer, buat Vercel Cron). Deadline = `booking_date`+`booking_time` (jam Jakarta) + `hold_time_minutes` dari `restaurant.settings` (default 15).

### Bahasa & Konten (semua user-facing string = English)
- Semua pesan error/validasi + data bisnis (nama menu, deskripsi, dll) sudah bahasa Inggris.
- **Comment kode (`//`) TIDAK ikut diterjemahkan** — biarkan apa adanya kalau nemu yang masih bahasa Indonesia.
- **Proper noun/identitas tidak diterjemahkan**: nama resto (`Warung Bagas`), alamat, nama staff, email/phone.
- **Nama hidangan yang dikenal luas internasional dipertahankan** (`Gado-Gado`, `Klepon`) — cuma deskripsinya bahasa Inggris (pola umum menu restoran, mirip gak nerjemahin "Sushi"/"Tacos").
- **`phoneRegex` tetap format Indonesia (`08xx`)** — app tetap ngelayanin customer Indonesia meski UI-nya Inggris, ini gak berubah cuma karena bahasa UI berubah.

---

## 3. Dead code (belum dihapus, aman dihapus kapan saja)

- **`src/modules/auth/{routes,controller,service,schema}.ts`** — scaffold awal yang gak pernah diisi & gak pernah di-`import`. Auth beneran jalan lewat `src/lib/auth.ts` (better-auth generate route-nya sendiri via `toNodeHandler`, di-mount langsung di `app.ts`). Beda dari placeholder lain (`ai/`, dulu `cloudinary.ts`) yang memang direncanakan buat fitur mendatang.

---

## 4. Deploy Vercel — status & gotcha nyata (sudah live, backend ada di `restoran-backend` repo terpisah)

**Status: sudah deploy & jalan di production** (`restoran-backend-rosy.vercel.app`). Bagian ini isinya bukan lagi rencana, tapi **catatan dari masalah nyata yang kejadian & fix-nya** — baca ini sebelum ngoprek konfigurasi deploy lagi.

### Yang berhasil diimplementasi
- `api/index.ts` (root, bukan di `src/`) — entrypoint serverless, `export default app` (import dari `../src/app`), **tanpa** manggil `startNoShowCron()` (node-cron gak jalan di serverless, proses di-freeze antar invocation).
- `vercel.json`:
  ```json
  {
    "functions": { "api/index.ts": { "maxDuration": 10 } },
    "rewrites": [{ "source": "/(.*)", "destination": "/api" }],
    "crons": [{ "path": "/internal/cron/no-show", "schedule": "0 17 * * *" }]
  }
  ```
- `package.json` — `"postinstall": "prisma generate"` (wajib, `node_modules` di-gitignore jadi Prisma Client harus di-generate ulang tiap build Vercel).
- `src/app.ts` — `app.set('trust proxy', 1)` tepat setelah `express()` (di belakang proxy Vercel, tanpa ini `req.ip` yang dibaca `ipKeyGenerator` di rate limiter salah).
- `DATABASE_URL` production pakai endpoint Neon **`-pooler`** (bukan direct) — serverless spawn banyak instance paralel.
- Cron **1x/hari** (`0 17 * * *` UTC = 00:00 WIB), bukan tiap 15 menit — Vercel Hobby plan cuma izinin cron 1x/hari.

### 🔴 Bug besar #1 — `ERR_REQUIRE_ESM`: better-auth ESM-only vs project CommonJS
Catatan lama di §2 bilang "aman karena Node 22 native `require(esm)`" — **itu cuma bener di lokal**. Loader serverless Vercel **TIDAK** support `require()` ke modul ESM sama sekali, jadi semua route (termasuk `/health`) 500 crash total pas cold start begitu deploy.

**Fix:** ubah 3 tempat yang import `better-auth` sebagai *value* (`src/lib/auth.ts`, `src/app.ts`, `src/middlewares/require-auth.ts`) jadi **dynamic `import()`** di dalam fungsi, di-memoize (`let authPromise`/`let authHandlerPromise`, cuma dibangun sekali per warm function). `import type` (buat derive tipe, mis. `Auth['$Infer']['Session']` di `express.d.ts`) aman, itu di-erase saat compile, gak ikut crash.
**Verifikasi penting:** cek hasil compile (`dist/*.js`) beneran `await import(...)` native, bukan diam-diam di-transpile `tsc` jadi `require(...)` — itu bakal muncul lagi error yang sama.

### 🔴 Bug besar #2 — Vercel auto-detect `src/app.ts` jadi function terpisah
Root path `/` selalu 500 dengan error `Invalid export found in module "src/app.js". The default export must be a function or server.` — Vercel secara zero-config **auto-detect** `src/app.ts` (nama file umum kayak `app.ts`/`server.ts`) sebagai serverless function sendiri, terpisah dari `api/index.ts` yang kita buat sengaja. Karena `src/app.ts` cuma named export (`export const app`), bukan default export, dia crash.

**Fix:** `vercel.json` key `"functions"` scoped eksplisit cuma ke `api/index.ts` (lihat contoh di atas), biar Vercel gak ngoprek file lain. **Catatan:** `"functions": {"api/index.ts": {}}` (objek kosong) **ditolak** Vercel (`Function must contain at least one property`) — minimal isi 1 property valid, mis. `maxDuration`.

### 🔴 Bug besar #3 — trailing slash di env var bikin better-auth nolak origin valid
`BETTER_AUTH_URL`/`FRONTEND_ORIGIN` yang ke-isi **dengan** trailing slash (`https://xxx.vercel.app/`, umum kepencet copy-paste dari address bar) bikin login gagal total (`403 INVALID_ORIGIN`) — **meski origin-nya keliatan "sama"**. better-auth cek `trustedOrigins` pakai **exact string match** (`pattern === getOrigin(originHeader)`), dan browser **selalu** kirim header `Origin` tanpa trailing slash — jadi `https://xxx.vercel.app/` (di config) vs `https://xxx.vercel.app` (dari browser) **gak pernah match**.
**Selalu double-check env var URL gak ada `/` nyangkut di akhir.**

### ⚠️ Cross-domain cookie (relevan kalau backend/frontend ganti domain)
Cookie session better-auth (`__Secure-better-auth.session_token`) **gak punya `Domain` attribute eksplisit** — jadi cookie itu ke-scope ketat ke origin backend sendiri. Kalau frontend & backend beda domain (kasus sekarang: `*.vercel.app` masing-masing dianggap "site" terpisah oleh browser), **frontend WAJIB proxy semua panggilan API lewat origin-nya sendiri** (lihat `frontend/DEV_NOTES.md`) supaya cookie jadi first-party — kalau enggak, API login sukses tapi cookie gak pernah ke-attach ke request berikutnya (kelihatan kayak "gagal login" padahal API-nya sukses).

### ⚠️ Belum diverifikasi / known gap
- **`/internal/cron/no-show` masih `app.post` doang** — perlu dicek ulang apakah Vercel Cron Jobs kirim request pakai `GET` atau `POST` (kalau `GET`, endpoint ini bakal 404 pas di-invoke beneran karena Express `app.post` cuma match method POST). Cek tab **Cron Jobs** di Vercel dashboard setelah siklus pertama jalan (00:00 WIB), atau ganti ke `app.all` kalau ternyata `GET`.
- **Rate limiter (`express-rate-limit`) masih in-memory** — belum pindah ke shared store (Redis/Upstash). Konsekuensi: limit gak konsisten lintas Vercel Function instance (tiap instance punya counter sendiri). Diterima buat sekarang (traffic rendah), bukan blocker.

### Env var yang WAJIB di Vercel (project backend)
`DATABASE_URL` (pooler), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_ORIGIN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CRON_SECRET` — semua URL **tanpa trailing slash**. `NODE_ENV`/`PORT` gak perlu (Vercel/serverless handle otomatis), `DIRECT_URL` cuma dipakai migrasi manual dari lokal (bukan runtime).