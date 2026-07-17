# Plan: AI Concierge (RAG Chat) — Backend + Frontend

**Status: DRAFT — baca dulu, kasih go baru dieksekusi.**

## Context

`src/modules/ai/*` masih placeholder kosong sejak awal project — ini satu-satunya FR di `backend.md` yang belum diimplementasi (lihat `context.md` §0: "Semua FR sudah diimplementasi **kecuali AI Concierge**"). Spec lengkapnya sudah ada di `backend.md` §4.5 (FR-AI-01..06), §8.1 (kontrak `POST /ai/chat`), §10 (arsitektur RAG) — plan ini adalah breakdown eksekusi dari spec itu, disusun senumbang mungkin ke pola step-by-step referensi Notion yang sebelumnya ada di file ini (project serupa, tapi fullstack Next.js + Supabase + Rupiah — beda stack dari project kita).

**Kenapa reuse-heavy**: banyak infra yang dibutuhkan RAG **sudah ada**, cuma belum disambungkan:
- `vector_store` table + index `idx_vector_store_embedding` (ivfflat, cosine ops) — sudah live di migration `20260707054006_add_vector_index_and_booking_constraint`.
- `@google/generative-ai` — sudah di `package.json` (`^0.24.1`).
- Table-assignment logic (`findAvailableTable` di `booking.service.ts`) dan flow booking penuh (`createBooking`) — sudah ada & teruji, dipakai form booking web. AI Concierge **reuse fungsi ini**, bukan reimplement.
- Cancel booking (`updateBookingStatus`) — sudah ada.
- Route `/ai` sudah di-mount di `app.ts` (`generalRateLimiter`), tinggal isi `aiRouter`.

## Keputusan Desain (dikonfirmasi user)

1. **Bahasa respons AI**: **auto-detect & mirror** — AI balas pakai bahasa yang sama dengan pesan customer (Indonesia→Indonesia, English→English), instruksi 1-baris di system prompt, **bukan** konten RAG terpisah per bahasa (data menu/rules tetap 1 sumber di English, Gemini translate on-the-fly saat generate). Beda dari draft asli `backend.md` §10 yang contohnya full Bahasa Indonesia — itu draft lama sebelum migrasi UI ke English (lihat `context.md` §2 "Bahasa & Konten").
2. **Scope**: **full-stack** — backend (RAG + `/ai/chat`) **dan** widget chat publik di frontend. `frontend/DEV_NOTES.md` sudah nandain "AI Chat Widget — deferred, nunggu backend" sebagai fitur yang direncanakan, bukan out-of-scope.
3. **Conversation memory**: **stateless, client-driven** — frontend simpan history di React state, kirim beberapa turn terakhir tiap request; backend tidak nyimpen session state. Alasan: project ini serverless (Vercel Functions, proses freeze antar invocation — sama alasan kenapa gak ada WebSocket/node-cron gak reliable, lihat `context.md` §2 "Polling & Realtime"), jadi server-side session store (Redis/DB) nambah kompleksitas infra yang gak match arsitektur existing. Chat log (opsional, buat debugging) kalau ada tetap **log-only**, bukan dipakai buat context — lihat Fase 12.
4. **Currency**: tetap **integer USD cents** (`formatUsd`) — bukan Rupiah seperti contoh di referensi Notion.
5. **Retrieval**: `prisma.$queryRaw` cosine similarity ke `vector_store` (`embedding` kolom `Unsupported("vector(768)")` gak bisa lewat query builder biasa) — sesuai `backend.md` §10.1.
6. **Booking/cancel via chat manggil service function yang SUDAH ADA** (`createBooking`, `updateBookingStatus`) — bukan duplikasi logic baru khusus AI.

---

## BACKEND

### Fase 1: Environment & SDK setup — ✅ SELESAI
1. Tambah `GEMINI_API_KEY` ke `.env`, `.env.example`, `src/config/env.ts` (`geminiApiKey: process.env.GEMINI_API_KEY ?? ''`) — sudah terdaftar di `backend.md` §11.3, tinggal wiring kode. Tambah juga ke checklist env var Vercel di `context.md` §4 begitu implementasi jalan.
2. Cek model apa yang tersedia di `@google/generative-ai` versi terpasang (embedding model + chat/generation model) — **cek dokumentasi/SDK langsung saat implementasi**, jangan asumsi nama model dari referensi lama (nama model Gemini berubah-ubah, `backend.md` §10.4 nyebut `text-embedding-004` tapi verifikasi masih valid).
3. Buat `src/lib/gemini.ts` (pola sama `src/lib/cloudinary.ts` — thin singleton client wrapper) — export `embedText(text: string): Promise<number[]>` dan `generateChatResponse(prompt: string): Promise<string>`.
4. Smoke-test lewat script sekali-pakai (`ts-node`, dihapus setelah verifikasi): `embedText` harus balikin vector 768 dimensi (match kolom `vector(768)`), `generateChatResponse` harus balikin teks.

**Temuan implementasi (18 Jul 2026) — catat biar Fase 2+ gak nebak ulang:**
- `text-embedding-004` (dugaan awal dari `backend.md` §10.4) **sudah gak ada** — 404. Model embedding yang valid sekarang: `gemini-embedding-001` (juga ada varian `-2-preview`/`-2`).
- `gemini-embedding-001` **default output 3072 dim**, bukan 768 — harus eksplisit minta `outputDimensionality: 768` di request. SDK terpasang (`@google/generative-ai@0.24.1`) **gak declare field ini di TS type**-nya (SDK ini sendiri sudah legacy, digantikan `@google/genai`), tapi API-nya tetap terima field itu (dites langsung lewat curl REST ke `v1beta/models/gemini-embedding-001:embedContent`) dan SDK-nya cuma `JSON.stringify(params)` mentah-mentah tanpa whitelist field — jadi aman di-pass asal bukan lewat shortcut string (`.embedContent(text)`), harus lewat object literal + type assertion.
- `gemini-1.5-flash` (dugaan awal) juga udah gak ada. `gemini-2.5-flash` **muncul di `ListModels` tapi ternyata 404** juga pas dipanggil — pesan error-nya eksplisit "no longer available to new users". Yang dipakai final: **`gemini-flash-latest`** (alias yang di-maintain Google nunjuk ke flash model stabil terkini) — lebih aman dari pin ke versi angka yang bisa disunset kapan aja.
- Pelajaran umum: **jangan trust `ListModels` doang** buat nentuin model valid — beberapa entry yang muncul di situ ternyata masih 404 pas beneran dipanggil. Smoke-test aktual (bukan cuma baca daftar) itu wajib.

File: `src/lib/gemini.ts`, `src/config/env.ts` (+`geminiApiKey`), `context.md` §4 (env var checklist +`GEMINI_API_KEY`).

### Fase 2: RAG content ingestion (isi vector_store)
1. Buat `prisma/seed-vector-store.ts` (**terpisah** dari `prisma/seed.ts` — base seed tetap deterministik & gak gantung ke Gemini API, prinsip surgical):
   - **Menu**: 1 chunk per `MenuItem` aktif (`deletedAt: null`). Template teks: `"{name}: {formatUsd(price)}. {description}. Tags: {tags}. Category: {category.name}."`. Metadata `{type: 'menu', source_id: item.id, category: category.name}`.
   - **Table**: 1 chunk **per area** (bukan per meja, ikut granularitas contoh `backend.md` §10.1), mis. `"Indoor: 10 tables, capacity 2-8. Outdoor: 10 tables, capacity 2-8."`. Metadata `{type: 'table', source_id: restaurant.id, category: area}`.
   - **Rules/FAQ**: chunk dari `restaurant.openingHours` + `restaurant.settings` (`hold_time_minutes`, `tax_rate`, `service_charge`) yang sudah ada di DB (bukan hardcode angka baru) + beberapa fakta statis (parkir, smoking policy, dll) — **konfirmasi teks faktualnya ke user dulu sebelum ditulis**, jangan invent kebijakan yang belum tentu benar. Metadata `{type: 'faq', source_id: <slug>, category: 'general'}`.
2. Tiap chunk: `embedText()` → insert manual via `prisma.$executeRaw` (kolom `Unsupported` gak bisa lewat `.create()` biasa).
3. Jalankan sekali di dev DB, verifikasi row count + spot-check query `$queryRaw` similarity search buat 1 sample query (mis. "vegetarian spicy food") return hasil yang masuk akal.

### Fase 3: Retrieval layer
1. Di `ai.service.ts` (ikut pola existing — modul lain gak punya file `*.repository.ts` terpisah, raw query tetap inline di service): `searchVectorStore(queryEmbedding, topK, filterType?)` via `prisma.$queryRaw`, `ORDER BY embedding <=> $1::vector LIMIT $2`, optional `WHERE metadata->>'type' = $3`. Return `{content, metadata, similarity}[]`.
2. Test 5 sample query yang cover skenario FR-AI-03 (rekomendasi menu) & FR-AI-04 (FAQ).

### Fase 4: Intent detection (rule-based, ringan)
1. `detectIntent(message): Intent` — keyword/regex matching ikut tabel `backend.md` §10.3, **keyword di-extend dua bahasa** (Indonesia + English) karena keputusan auto-mirror di atas — mis. availability: `["available","slot","masih ada","kosong"]`, booking: `["book","reservation","booking","reservasi","pesan meja"]`. Fallback ke `'general'`.
2. Catatan desain: intent ini **cuma filter kasar** buat prioritas retrieval (`type` mana yang di-boost), **bukan** hard-branch logic — Gemini tetap generate jawaban akhir dari context yang di-retrieve, biar sistem gak brittle kalau keyword miss.

### Fase 5: Domain read functions (reuse-first)
1. **Availability check (FR-AI-01)**: `findAvailableTable` di `booking.service.ts` saat ini `private` dan cuma dipakai di dalam transaction `createBooking`. Extract jadi variant **non-transactional** (plain `prisma`, bukan `tx`) yang bisa dipanggil AI buat cek availability **tanpa** create booking. Kalau gak ada match exact, sweep waktu alternatif (±30/60 menit) pakai query yang sama, sesuai FR-AI-01.
2. **Customer context (FR-AI-05)**: `getCustomerContext(phone)` baru di `ai.service.ts` — `prisma.customer.findUnique` (total_visits, last_visit_date, no_show_count) + booking terakhir (area preference) + top menu item dari order history (reuse pola `groupBy` yang sudah ada di `analytics.service.ts` — **inget gotcha Prisma 7** dari `context.md` §2: `orderBy` gak bisa `_count._all`, harus field spesifik).

### Fase 6: Prompt construction & Gemini call
1. Base system prompt: instruksi factual/no-hallucination + **directive "mirror bahasa customer"** + tone concierge restoran.
2. `buildPrompt(message, intent, retrievedContext, customerContext, history)` — assembles semuanya jadi 1 prompt final.
3. Response parsing: minta Gemini balikin structured hint (JSON block / JSON mode kalau SDK support) buat extract `action` + `suggested_tables` sesuai kontrak `backend.md` §8.1. **Guardrail wajib**: sebelum `suggested_tables` dikirim ke client, cross-check tiap table ID terhadap hasil query DB yang beneran di-retrieve — strip apapun yang gak ada di situ (cegah hallucinated table).

### Fase 7: `POST /ai/chat` endpoint
1. `ai.schema.ts`: `message` (string, required, max length wajar), `customer_phone` (optional, `phoneRegex` — reuse pattern dari `booking.schema.ts`), `session_id` (optional uuid), `history` (optional `{role, content}[]` — client-driven memory).
2. `ai.service.ts`: `handleChatMessage(input)` — orchestrate Fase 3–6, return shape `{response, action, suggested_tables}`.
3. `ai.controller.ts`: handler tipis, **tanpa** try/catch manual (ikut konvensi existing — `AppError` bubble ke `errorHandler` global).
4. `ai.routes.ts`: `router.post('/chat', handler)` — mount di `app.ts` **sudah ada** (`/ai` + `generalRateLimiter`), gak perlu ubah `app.ts`.
5. Test manual curl (pola sama modul lain — tambah ke Postman collection `megatha-kitchen-core` kalau relevan), beberapa sample percakapan cover tiap intent.

### Fase 8: Booking via chat (FR-AI-02, multi-turn)
1. Karena memory stateless/client-driven, "state machine" pengumpulan data (nama→HP→jumlah→tanggal→waktu→area→confirm) hidup di **system prompt + history**, bukan server state — instruksikan Gemini nanya field yang kurang satu-satu, dan begitu semua field + konfirmasi customer lengkap, emit signal terstruktur (`action: "confirm_booking"` + extracted fields) di responsnya.
2. Begitu backend detect `action: "confirm_booking"` dengan field lengkap & valid — **validasi lewat `createBookingSchema` yang sudah ada** (`booking.schema.ts`, reuse bukan duplikasi) lalu panggil **`createBooking()` yang sudah ada** (`booking.service.ts`) langsung. Gabungkan `message` hasil return-nya ke respons chat.
3. Handle `NO_TABLE_AVAILABLE` (`AppError` yang sudah di-throw `createBooking`) secara graceful di chat — catch, biar Gemini phrase alternatif natural pakai hasil sweep waktu dari Fase 5.1.

### Fase 9: Cancel booking — **TIDAK self-service via chat** (keputusan keamanan)
1. **Dipertimbangkan lalu sengaja dibuang**: awalnya didesain AI cari booking by `customer_phone` lalu cancel setelah "konfirmasi" di chat. **Ditolak** — nomor HP bukan rahasia (siapapun yang tau/nebak nomor orang lain bisa liat & cancel booking-nya), dan `booking_code` (opsi mitigasi kedua) juga lemah karena formatnya sequential & low-entropy (`{inisial}-{tanggal}-{urutan 3 digit}`, realistiknya cuma puluhan kemungkinan per hari) — brute-forceable dalam window `generalRateLimiter` yang ada. Kombinasi phone+code cuma naikin bar dari "trivial" ke "butuh ratusan percobaan kalau attacker udah tau nomor HP target" (skenario paling realistis, bukan random attacker) — bukan solved.
2. **Keputusan**: intent `cancel_booking` di chat **tidak** memicu mutasi apapun. AI cukup jawab natural (pakai konteks `restaurant.phone` dari DB) — arahkan customer telepon resto buat cancel, staff yang eksekusi manual lewat `PATCH /admin/bookings/:id` yang **sudah ada & sudah aman** (`requireAuth` + role guard). Verifikasi identitas pindah ke channel yang manusia bisa nanya balik (telepon), bukan endpoint publik yang bisa di-otomasi/di-script.
3. Kalau nanti beneran mau self-service cancel via chat, opsi yang tersedia (didokumentasikan buat referensi masa depan, **bukan** dikerjakan sekarang): (a) rate-limit/lockout ketat khusus lookup-cancel (mis. 5x gagal/jam, reuse pola `bookingRateLimiter`), atau (b) token cancel terpisah dari `booking_code` (field baru random, khusus kredensial — `booking_code` didesain buat dibaca manusia, bukan buat jadi secret, dua fungsi itu gak boleh dicampur).

### Fase 10: Guardrail, fallback & hardening
1. Gemini API gagal/timeout → catch, fallback ke pesan statis (bukan panggil LLM lagi) yang arahkan ke `restaurant.phone` dari DB (bukan hardcode string) — mirror ide di referensi Notion tapi sumber data real.
2. Cek ulang rate limit: `/ai/chat` sudah share `generalRateLimiter` (100 req/menit per IP, 1 bucket bareng `/bookings`/`/menu` — lihat `context.md` §2) — evaluasi saat implementasi apakah perlu limiter terpisah biar 1 percakapan panjang gak exhaust kuota endpoint publik lain. Cek juga limit RPM tier gratis Gemini **saat implementasi** (jangan percaya angka lama dari referensi, itu berubah-ubah).
3. Guardrail hallucination (extend Fase 6.3) — berlaku juga buat menu item yang disebut di respons, bukan cuma table.
4. Validasi input: reject message kosong/oversized (`zod` `.max()`), catatan: sanitasi prompt-injection dasar aja buat MVP (bukan solved problem sepenuhnya) — dokumentasikan sebagai known limitation, bukan diklaim aman 100%.

### Fase 11: Re-index hook (jaga vector_store tetap fresh)
1. Wire re-embed ke `createMenuItem`/`updateMenuItem`/`softDeleteMenuItem` (**yang sudah ada**, `menu.service.ts`) — upsert/delete row `vector_store` terkait (`metadata->>'source_id' = item.id`) setelah tiap write. **Fire-and-forget**: log kalau gagal, jangan fail-kan mutation menu-nya — CRUD menu gak boleh gantung ke uptime Gemini.
2. Chunk table/FAQ statis (`backend.md` §10.1: "jarang berubah") — gak perlu hook live, re-run script Fase 2 manual kalau layout meja berubah signifikan.

### Fase 12: Monitoring & docs
1. Structured console log per chat call (input, intent, jumlah retrieval, response time, token usage kalau SDK expose) — **log-only, bukan tabel DB** (konsisten keputusan stateless), ditangkap Vercel log sama kayak `morgan` existing, gak nambah infra baru.
2. Update `context.md`/`backend.md` (changelog) setelah implementasi — dokumentasikan gotcha spesifik Gemini/pgvector yang kejadian beneran (ikut pola entry §2 existing).

---

## FRONTEND

### Fase 13: Tipe & API client
1. `types/api.ts`: tambah `ChatMessage {role: 'user'|'assistant', content: string}`, `ChatRequest`, `ChatResponse` — mirror kontrak `backend.md` §8.1 persis, snake_case.
2. `lib/queries/ai.ts` (baru, ikut pola 1-file-per-domain existing): `sendChatMessage(payload)` pakai `apiFetch` yang sudah ada. Dipanggil lewat `useMutation` di widget (pola sama `createOrder`/`createBooking`), **bukan** `useQuery` — ini bukan data yang di-cache.

### Fase 14: Chat widget component
1. `components/public/chat/ChatWidget.tsx` — floating button (bottom-right) + panel expandable, `'use client'`, `useState` buat message list + input (state lokal murni, **bukan** TanStack Query — ikut prinsip DEV_NOTES.md "cart POS, dialog open/close = useState biasa").
2. `session_id` di-generate client (`crypto.randomUUID()`), disimpan di state komponen (tentukan lifetime — reset tiap reload vs persist `sessionStorage` — saat implementasi).
3. Kirim beberapa turn terakhir (mis. 6) sebagai `history` tiap request (sesuai keputusan stateless client-driven) — trim turn lama biar payload/token cost gak membengkak.
4. `suggested_tables` (kalau ada) di-render sebagai chip — opsional deep-link ke `/booking` dengan query prefill (stretch, bukan wajib MVP).
5. Loading/error state — `sonner` toast buat hard error (konsisten pola error UX project), typing indicator buat latency normal.

### Fase 15: Mount widget
1. Tambah `<ChatWidget />` ke `app/(public)/layout.tsx` (sejajar `Navbar`/`Footer`) — **cuma** public, jangan render di `(admin)`/`(admin-standalone)` (staff gak butuh concierge customer).

### Fase 16: Verifikasi end-to-end
Ikut disiplin verifikasi yang sama kayak fase finance sebelumnya di file ini:
1. `tsc --noEmit` bersih backend & frontend.
2. Jalankan dev server kedua sisi, percakapan manual nyata cover: tiap intent (§10.3, termasuk `cancel_booking` → pastikan cuma arahkan telepon, **tidak** mutasi apapun), booking selesai via chat, skenario `NO_TABLE_AVAILABLE`, skenario Gemini down (matikan API key sementara → cek fallback).
3. Cross-check: booking yang dibuat lewat chat menghasilkan row DB yang sama persis strukturnya dengan booking dari form web biasa (`POST /bookings`).
4. Cek log server bersih, tidak ada error tersembunyi di retrieval/embedding call.

---

## Out of scope (sengaja tidak dikerjakan)
- Toggle bahasa UI / konten RAG terpisah per bahasa (digantikan keputusan auto-detect & mirror).
- Redis/DB-backed session memory (digantikan keputusan stateless — revisit cuma kalau pindah dari serverless).
- Voice/image input, integrasi channel lain (WhatsApp, dll).
- Dashboard analytics khusus chat (Fase 12 cuma log, bukan UI).
- AI proactive outreach (chat ini reactive/inbound-only, AI gak mulai chat duluan).
- Prompt-injection hardening tingkat lanjut (dicatat sebagai known limitation MVP, bukan solved).
- **Self-service cancel booking via chat** (lihat Fase 9) — **deviasi sengaja dari draft asli `backend.md` §10.3** yang nyebut intent `cancel_booking` → "Retrieve booking by HP + cancel". Dibuang karena verifikasi kepemilikan cuma modal nomor HP (atau HP+booking_code) gak cukup aman buat aksi publik tanpa auth — nomor HP bukan rahasia, `booking_code` low-entropy/sequential. Kalau nanti mau diimplementasi, baca opsi mitigasi di Fase 9.3 dulu (rate-limit/lockout ketat, atau token cancel terpisah) — jangan bikin versi naive-nya lagi.
