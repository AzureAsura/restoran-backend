# Context — Referensi Teknis Backend Megatha Kitchen

**Terakhir diupdate:** 8 Juli 2026
**Tujuan file ini:** referensi teknis & gotcha yang perlu diingat kalau lanjut ngoding backend ini, plus checklist deploy Vercel. Detail requirement/kontrak API lengkap ada di `backend.md`.

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

## 4. Checklist sebelum deploy ke Vercel (belum dikerjakan, sengaja ditunda)

1. **`src/index.ts` masih pola `app.listen()`** — gak jalan di Vercel Functions apa adanya. Perlu entrypoint baru (mis. `api/index.ts`) yang export `app` langsung, plus `vercel.json` rewrite semua path ke situ. `src/index.ts` tetap dipertahankan buat dev lokal.
2. **Connection string Neon buat production harus yang `-pooler`** (bukan direct) — serverless function bisa spawn banyak instance paralel, tanpa pooling gampang kehabisan slot koneksi Postgres.
3. **Daftarkan `POST /internal/cron/no-show` ke `vercel.json` `crons`** (`*/15 * * * *`) + set `CRON_SECRET` di env var Vercel.
4. **`app.set('trust proxy', ...)`** buat `generalRateLimiter`/`bookingRateLimiter` baca `req.ip` yang benar di belakang proxy Vercel. (`adminRateLimiter` gak kena masalah ini — key per `user.id`, bukan IP.)
5. **Ganti store `express-rate-limit` ke shared store** (Redis/Upstash) supaya limit konsisten lintas Vercel Function instance — in-memory store cuma valid untuk 1 proses long-running (dev lokal).
6. Sengaja ditunda sampai beneran mau deploy, karena gak bisa divalidasi penuh tanpa deploy asli, dan gak ngeblok dev lokal.


Context

 Backend sekarang cuma jalan lewat app.listen() (src/index.ts) — gak jalan apa adanya di Vercel Functions (serverless, gak ada proses
 long-running). Ini pertama kalinya user hosting backend, jadi plan ini dipisah jelas: kode yang saya ubah vs langkah manual di dashboard
 Vercel/GitHub yang cuma bisa dikerjain user sendiri.

 Checklist awal udah ada di backend/context.md §4 (ditulis pas awal proyek, sengaja ditunda sampai beneran mau deploy — sekarang saatnya). Saya
 cross-check lagi ke kode aktual (app.ts, rate-limit.ts, tsconfig.json, package.json) dan nemu 1 hal yang gak ada di catatan lama tapi
 krusial: prisma generate gak pernah jalan otomatis pas install — node_modules di-gitignore, jadi tiap fresh install (termasuk build server
 Vercel) butuh regenerasi Prisma Client, kalau kelewat aplikasi bakal crash pas start.

 Kabar baik: DATABASE_URL di .env lokal udah pakai endpoint -pooler Neon — jadi poin "connection string harus pooler" di checklist lama udah
 otomatis kelar, tinggal reuse value yang sama di env var Vercel.

 Keputusan user: push backend ke GitHub repo baru dulu (bukan Vercel CLI langsung) — biar auto-redeploy tiap push. Rate limiter Redis/Upstash
 di-skip buat deploy pertama (in-memory diterima, dicatat sebagai keterbatasan, bukan blocker).

 Part A — Perubahan kode (saya kerjain)

 1. backend/package.json — tambah "postinstall": "prisma generate" di scripts. Wajib, bukan opsional — tanpa ini Prisma Client gak ke-generate
 ulang di server Vercel dan aplikasi bakal crash saat start.
 2. backend/src/app.ts:
   - Tambah app.set('trust proxy', 1) tepat setelah export const app = express() — Vercel selalu di belakang proxy, tanpa ini req.ip yang
 dibaca generalRateLimiter/bookingRateLimiter/adminRateLimiter (ipKeyGenerator(req.ip)) bakal salah/gak akurat.
   - /internal/cron/no-show: ganti app.post(...) → app.all(...). Alasan konkret: Vercel Cron selalu ngirim request pakai method GET ke path
 yang didaftarkan (bukan POST) — endpoint yang cuma nerima POST bakal 404 pas dipanggil cron beneran. Auth tetap sama (Authorization: Bearer
 <CRON_SECRET>, dibaca dari header, gak terikat method), jadi ganti ke app.all aman dan sekalian bikin manual testing via POST (Postman) tetap
 jalan.
 3. backend/api/index.ts (baru, root — bukan di dalam src/, ini konvensi Vercel) — entrypoint serverless: import { app } from '../src/app';
 export default app. src/index.ts (app.listen) tetap dipertahankan buat dev lokal, gak dihapus.
 4. backend/vercel.json (baru) — rewrites semua path ke /api/index (biar Express yang urus routing internal, bukan Vercel filesystem routing) +
 crons daftarin /internal/cron/no-show jadwal */15 * * * * (match node-cron interval yang udah ada di dev).
 5. backend/tsconfig.json — tambah "api" ke include (di samping "src" yang udah ada), biar npx tsc --noEmit lokal ikut ngecek file baru ini
 juga. Catatan: ini gak bentrok sama rootDir: "src" yang udah ada — Vercel gak pernah manggil npm run build/tsc -p tsconfig.json buat compile
 api/index.ts, dia punya compiler sendiri (esbuild) yang jalan independen pas deploy. Jadi dist//outDir tetap cuma relevan buat dev lokal, gak
 kepake sama sekali di Vercel.
 6. backend/.gitignore — tambah baris .vercel (folder config lokal yang dibuat Vercel CLI kalau nanti dipakai, standar di-gitignore).
 7. backend/.env.example — tambah 1 baris comment di atas DATABASE_URL nyebutin "production wajib pakai endpoint -pooler Neon" — dokumentasi
 doang, biar gak lupa kalau nanti reset/ganti database.

 Part B — Langkah manual (kamu yang jalanin, saya bisa bantu command persisnya)

 1. Push backend ke GitHub repo baru. gh CLI gak tersedia di environment ini, jadi kamu perlu bikin repo kosong dulu manual di github.com (New
 Repository, jangan centang "add README"). Setelah itu kasih saya URL repo-nya (mis. https://github.com/username/nama-repo.git), saya bantu
 jalanin git init + commit awal + git remote add + git push dari folder backend (tetap saya minta konfirmasi kamu sebelum push, itu aksi
 visible ke luar).
 2. Buat Vercel project dari dashboard (vercel.com) → Import Git Repository → pilih repo backend yang baru dibikin.
 3. Set environment variables di Vercel project settings (Production):
   - DATABASE_URL — reuse persis value dari .env lokal kamu (udah pooler ✓).
   - BETTER_AUTH_SECRET, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET — reuse dari .env lokal.
   - NODE_ENV = production.
   - FRONTEND_ORIGIN = URL frontend production kamu (kalau frontend belum di-deploy juga, isi placeholder dulu, update belakangan).
   - CRON_SECRET = bikin string random baru (bukan reuse yang lain) — ini yang Vercel otomatis kirim sebagai Authorization: Bearer <value> pas
 manggil cron endpoint.
   - BETTER_AUTH_URL = isi placeholder dulu (mis. https://placeholder.vercel.app) — nilai aslinya baru ketahuan SETELAH deploy pertama (Vercel
 kasih domain *.vercel.app otomatis), balik ke sini update abis itu.
 4. Deploy pertama kali (otomatis begitu di-import, atau trigger manual dari dashboard).
 5. Setelah dapet domain (https://nama-project-xxx.vercel.app) — balik ke env vars, update BETTER_AUTH_URL ke domain asli itu, lalu redeploy
     │ (Vercel kasih domain *.vercel.app otomatis), balik ke sini update abis itu.                                                             │
     │ 4. Deploy pertama kali (otomatis begitu di-import, atau trigger manual dari dashboard).                                                 │
     │ 5. Setelah dapet domain (https://nama-project-xxx.vercel.app) — balik ke env vars, update BETTER_AUTH_URL ke domain asli itu, lalu      │
     │ redeploy (env var baru butuh redeploy manual buat kepake).                                                                              │
     │ 6. Update frontend: NEXT_PUBLIC_API_URL (env var frontend, baik di Vercel project frontend atau .env.local kalau masih dev) diarahin ke │
     │ domain backend baru itu.                                                                                                                │
     │ 7. Cek tab "Cron Jobs" di Vercel project settings — pastiin /internal/cron/no-show muncul terdaftar jadwal */15 * * * * setelah deploy. │
     │                                                                                                                                         │
     │ Sengaja di-skip (keputusan user, bukan lupa)                                                                                            │
     │                                                                                                                                         │
     │ - Rate limiter shared store (Redis/Upstash) — tetap in-memory. Konsekuensi: limit                                                       │
     │ generalRateLimiter/bookingRateLimiter/adminRateLimiter gak konsisten kalau Vercel spawn banyak instance function paralel (tiap instance │
     │ punya counter sendiri-sendiri) — bukan fatal buat awal-awal, tapi dicatat sebagai kerjaan lanjutan kalau traffic naik.                  │
     │                                                                                                                                         │
     │ Verifikasi                                                                                                                              │
     │                                                                                                                                         │
     │ - Lokal dulu (sebelum push): npm run dev masih jalan normal (gak somehow ke-break sama perubahan app.set/route method), npx tsc         │
     │ --noEmit bersih termasuk api/index.ts baru.                                                                                             │
     │ - Setelah deploy: curl https://<domain>/health → {"success":true,"data":{"status":"ok"}}. Test login staff (POST                        │
     │ /api/auth/sign-in/email) beneran dari domain production. Test 1 alur booking end-to-end (POST /bookings publik) ke database production  │
     │ yang sama. Cek log Vercel function buat mastiin Prisma Client jalan (gak ada error "client not generated").                             │
     │ - Cron: tunggu siklus 15 menit pertama, cek Vercel Cron Jobs log beneran ke-invoke, atau trigger manual curl -X POST                    │
     │ https://<domain>/internal/cron/no-show -H "Authorization: Bearer <CRON_SECRET>".      