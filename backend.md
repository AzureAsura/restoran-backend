# Product Requirements Document (PRD)
# Megatha Kitchen Backend — Express API untuk Restaurant Booking & Operations System

**Version:** 2.2
**Date:** 8 Juli 2026
**Status:** Final
**Author:** Technical Lead — Megatha Tech
**Target Release:** 1 Month (4 Sprints)
**Team:** 3 Developers (Frontend, Backend, AI Specialist)
**Client:** Single Restaurant (MVP), Multi-tenant ready architecture

> **Catatan versi:** Dokumen ini adalah pecahan dari PRD fullstack Next.js v1.0. Mulai v2.0, sistem
> dipecah jadi dua project terpisah: **backend (dokumen ini)** dan **frontend** (lihat `frontend/frontend.md`).
> Backend ini murni REST API — tidak render halaman apapun. Semua UI, routing halaman, dan
> data-fetching strategi (termasuk polling untuk update kitchen/cashier, lihat §9) ada di PRD frontend.

---

## 1. Executive Summary

### 1.1 Product Vision
Megatha Kitchen adalah sistem manajemen restoran berbasis web dengan AI Concierge yang mengotomatisasi booking, meja assignment, dan customer service. Backend ini menyediakan seluruh logika bisnis, data persistence, auth, dan AI/RAG layer yang dikonsumsi oleh frontend Next.js secara terpisah. Update kitchen/cashier ditangani via **polling** dari frontend (lihat §9), bukan push event dari backend.

**Bukan food delivery app.** Bukan e-commerce. Fokus: **dine-in reservation + in-house operations**.

### 1.2 Peran Backend dalam Arsitektur
- Menyediakan **REST API** untuk semua operasi (booking, POS, kitchen, menu, analytics, AI chat).
- Endpoint yang datanya sering berubah (kitchen queue, booking list) didesain ringan & cepat supaya aman **di-polling** frontend (TanStack Query `refetchInterval`) — tidak ada WebSocket/koneksi realtime terpisah.
- Menangani **auth staff** (Owner, Cashier, Kitchen) via better-auth — customer/guest tetap tanpa akun.
- Menjalankan **AI Concierge** (Gemini + RAG via pgvector) untuk availability check, rekomendasi menu, FAQ.
- Menjadi satu-satunya layer yang bicara ke **Neon (Postgres)** dan **Cloudinary**.

### 1.3 Scope Boundaries (In vs Out)

| In Scope | Out of Scope (Post-MVP) |
|----------|------------------------|
| Guest booking API (nama + HP, no OTP) | Pre-order menu saat booking |
| AI Concierge chat endpoint | Checkout / payment gateway |
| Meja assignment otomatis oleh AI | WhatsApp integration (OTP/notif) |
| Cashier POS API (order input, bill, status) | Multi-branch / franchise |
| Kitchen queue API (polling-friendly) | Inventory / supplier management |
| Menu management API (CRUD + upload Cloudinary) | Delivery / takeaway module |
| Booking calendar API (admin) | Loyalty points / membership |
| Customer light profile (by HP) | Review / rating system |
| RAG dengan menu + meja + rules + FAQ | AI review analyzer |
| Role system (Owner, Cashier, Kitchen) via better-auth | AI staff scheduler |

---

## 2. Problem Statement & Solution

### 2.1 Pain Points (Restoran Client)
1. **Double Booking**: Customer WA booking, staff lupa catat di Excel → meja double book saat hari H.
2. **No-Show**: Customer booking tapi tidak datang, meja kosong, revenue hilang. Tidak ada data untuk follow-up.
3. **Customer Tanya Berulang**: "Masih ada slot jam 7?" "Menu apa yang recommended?" "Bisa request meja outdoor?" — staff sibuk jawab pertanyaan repetitif.
4. **Kitchen Tidak Sync**: Kasir tulis order di kertas, antre ke kitchen, kertas hilang, order salah.
5. **Tidak Ada Data**: Owner tidak tahu hari apa paling ramai, menu apa paling laris, berapa no-show rate.

### 2.2 Solution (Megatha Kitchen Backend)
1. **Centralized Booking API**: Semua booking masuk ke satu database (Neon). AI assign meja otomatis. Conflict detection via unique constraint + transaction di level Prisma.
2. **Light Customer Profile**: Nomor HP sebagai ID. Backend track histori: berapa kali visit, no-show history, preferensi meja.
3. **AI Concierge 24/7**: Endpoint chat yang handle FAQ dan booking inquiry via RAG.
4. **Kitchen Queue (Polling)**: Order dari cashier masuk ke `GET /admin/kitchen-queue`, di-poll berkala oleh frontend. Status update (pending → cooking → ready → served) terlihat pada poll berikutnya.
5. **Analytics API**: Endpoint agregasi harian: booking rate, occupancy, menu performance, no-show rate.

---

## 3. Target Users & Personas (Konsumen API)

Backend melayani dua kategori client, keduanya lewat frontend Next.js:

### 3.1 Public/Guest (tanpa auth)
- Landing, menu publik, booking form, AI chat widget.
- Endpoint: `GET /menu`, `POST /bookings`, `POST /ai/chat`.

### 3.2 Staff (auth via better-auth, role-based)
- **Owner**: akses semua endpoint admin + analytics.
- **Cashier**: akses booking, POS, order, menu (read).
- **Kitchen**: akses kitchen queue + update status order item.

---

## 4. Functional Requirements

> Requirement domain (nomor FR) dipertahankan dari PRD v1.0 — hanya diselaraskan agar berbentuk kontrak API/backend, bukan UI.

### 4.1 Public Booking & Chat

#### FR-CUST-02: Booking Endpoint
- **Description**: `POST /bookings` menerima nama, nomor HP (wajib), jumlah orang (1-20), tanggal, waktu (30-menit slot), preferensi area, catatan khusus.
- **Validation**: Nomor HP format Indonesia (08xx). Tanggal tidak boleh di masa lalu. Waktu dalam jam operasional (dari `restaurants.opening_hours`).
- **Priority**: P0

#### FR-CUST-03: AI Chat Endpoint
- **Description**: `POST /ai/chat` menerima pesan customer + optional `customer_phone`/`session_id`. Backend jalankan RAG + Gemini, return response + action metadata.
- **Capabilities**: cek availability, rekomendasi menu, dietary filter, FAQ, booking via chat (collect data → insert booking).
- **Priority**: P0

#### FR-CUST-04: Booking Confirmation
- **Description**: Response `POST /bookings` mengembalikan kode booking, meja assigned, area, pesan hold time (default 15 menit, dari `restaurants.settings`).
- **Priority**: P0

#### FR-CUST-05: Menu Endpoint (Public)
- **Description**: `GET /menu` return menu grouped by category, dengan filter query (`?category=`, `?tag=`, `?search=`).
- **Priority**: P1

### 4.2 Booking & Meja Management (Admin)

#### FR-ADM-01: Booking List
- **Description**: `GET /admin/bookings?date=&status=&area=&search=` — list booking dengan filter & search by nama/HP.
- **Priority**: P0

#### FR-ADM-02: Meja Management
- **Description**: CRUD `/admin/tables` — nama, area (indoor/outdoor), kapasitas (1-20), status (available/reserved/occupied/maintenance).
- **Priority**: P0

#### FR-ADM-03: Booking Status Workflow
- **Description**: `PATCH /admin/bookings/:id` update status: `confirmed → seated → completed | no_show | cancelled`.
- **Priority**: P0

#### FR-ADM-04: Walk-in Handling
- **Description**: Cashier submit walk-in via endpoint order langsung (tanpa booking record wajib). Cashier pilih meja manual dari POS (`table_id` wajib di `POST /admin/orders`) — beda dari booking (FR-AI-02) yang di-assign otomatis, karena kasir sudah tahu persis meja mana yang dipakai walk-in tsb (lihat FR-POS-01, `frontend.md` FR-POS-01: grid meja visual).
- **Priority**: P0

#### FR-ADM-05: No-Show Tracking
- **Description**: Scheduled job (cron di backend) auto-flag booking sebagai `no_show` jika booking_time + 15 menit lewat dan status masih `confirmed`. Update `customers.no_show_count`.
- **Priority**: P1

### 4.3 POS / Cashier (Admin)

#### FR-POS-01: Order Input
- **Description**: `POST /admin/orders` — pilih meja, menu items + qty + notes. Backend hitung subtotal, tax, service charge, total. Order baru otomatis muncul di `GET /admin/kitchen-queue` pada poll berikutnya (tidak ada event push terpisah).
- **Priority**: P0

#### FR-POS-02: Bill & Payment
- **Description**: `GET /admin/orders/:id/bill` generate bill breakdown. `PATCH /admin/orders/:id` update `payment_status` unpaid → paid.
- **Priority**: P0

#### FR-POS-03: Order History
- **Description**: `GET /admin/orders?date=&table_id=&status=&customer_phone=&page=&limit=` — paginated (default `page=1`, `limit=20`, max `limit=100`).
- **Priority**: P1

### 4.4 Kitchen (Admin)

#### FR-KIT-01: Kitchen Queue Endpoint
- **Description**: `GET /admin/kitchen-queue` return order items dengan status `pending`/`cooking`, sorted FIFO by `created_at`.
- **Priority**: P0

#### FR-KIT-02: Status Update
- **Description**: `PATCH /admin/order-items/:id` update status `pending → cooking → ready → served`. Perubahan status terlihat oleh cashier & kitchen pada poll `GET /admin/kitchen-queue`/`GET /admin/bookings` berikutnya (tidak ada broadcast push).
- **Priority**: P0

#### FR-KIT-03: Order Detail
- **Description**: `GET /admin/order-items/:id` return detail item + waktu elapsed (dihitung dari `created_at`).
- **Priority**: P0

### 4.5 AI Concierge (RAG Layer)

#### FR-AI-01: Availability Check
- **Description**: Service function cek meja available untuk tanggal + waktu + party size. Jika tidak ada, suggest alternatif (±30 menit atau hari lain).
- **Priority**: P0

#### FR-AI-02: Meja Assignment
- **Description**: Auto-assign meja optimal: party size vs kapasitas, preferensi area, histori customer, availability. Jika tidak ada exact fit, suggest kombinasi meja.
- **Priority**: P0

#### FR-AI-03: Menu Recommendation
- **Description**: Retrieve menu dari vector store sesuai query, tag, dietary filter, budget hint. Return 3-5 item + alasan singkat.
- **Priority**: P0

#### FR-AI-04: FAQ Answering
- **Description**: Jawab dari RAG context (rules & FAQ) yang ter-index di `vector_store`.
- **Priority**: P0

#### FR-AI-05: Customer Context Awareness
- **Description**: Retrieve customer histori by HP (total visits, last visit, meja favorit, menu favorit dari order histori) untuk personalisasi respons AI.
- **Priority**: P1

#### FR-AI-06: RAG Retrieval
- **Description**: Sebelum generate response, retrieve context relevan dari `vector_store` (pgvector di Neon) via cosine similarity search.
- **Priority**: P0

### 4.6 Menu Management (Admin)

#### FR-MENU-01: Menu CRUD
- **Description**: `POST/PATCH/DELETE /admin/menu` — nama, harga, kategori, deskripsi, foto (upload ke Cloudinary, simpan `image_url`), tag, status.
- **Priority**: P0

#### FR-MENU-02: Category Management
- **Description**: CRUD `/admin/menu-categories`.
- **Priority**: P1

### 4.7 Dashboard & Analytics (Admin)

#### FR-DASH-01: Daily Overview
- **Description**: `GET /admin/analytics?date=` — total booking, walk-in, revenue, occupancy rate, no-show count, top menu.
- **Priority**: P1

#### FR-DASH-02: Booking Timeline
- **Description**: `GET /admin/analytics/timeline?date=` — booking count per jam (08:00-22:00).
- **Priority**: P1

#### FR-DASH-03: Menu Performance
- **Description**: `GET /admin/analytics/menu-performance?range=today|week` — order count per menu item.
- **Priority**: P1

### 4.8 Auth (Staff — better-auth)

#### FR-AUTH-01: Staff Login/Session
- **Description**: better-auth email+password untuk staff (magic link tidak dipakai). Endpoint bawaan better-auth: `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session`, dst. Public sign-up (`/api/auth/sign-up/email`) dinonaktifkan (`disableSignUp: true`).
- **Priority**: P0

#### FR-AUTH-02: Role Assignment
- **Description**: Setiap user staff punya field `role` (`owner`/`cashier`/`kitchen`) via better-auth additional fields, di-set saat provisioning akun (bukan self-signup publik).
- **Priority**: P0

---

## 5. Non-Functional Requirements

### 5.1 Performance (NFR-PERF)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-PERF-01 | AI response time (chat) | < 2 detik untuk availability check |
| NFR-PERF-02 | Kitchen queue data freshness (interval polling FE) | ≤ 5 detik |
| NFR-PERF-03 | REST API response time (non-AI) | < 300ms p95 |
| NFR-PERF-04 | Neon cold start (serverless) | Mitigasi via connection pooling (Prisma + Neon pooled connection) |

### 5.2 Security (NFR-SEC)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-SEC-01 | Role-based middleware guard aktif di semua route `/admin/*`. | Mandatory |
| NFR-SEC-02 | Customer HP tidak expose di response endpoint publik (hanya endpoint admin/cashier). | Mandatory |
| NFR-SEC-03 | Input sanitization untuk chat & semua input publik (XSS/SQL injection prevention — Prisma parametrized query membantu). | Mandatory |
| NFR-SEC-04 | Role-based access: Owner (all), Cashier (POS + booking), Kitchen (queue only) — di-enforce via middleware, bukan RLS database. | Mandatory |
| NFR-SEC-05 | Tidak boleh menyimpan secret di repository — pakai `.env` + env vars platform hosting (Vercel). | Mandatory |
| NFR-SEC-06 | CORS dikonfigurasi ketat: hanya origin frontend (Vercel domain) yang di-allow, `credentials: true` untuk cookie better-auth cross-origin. | Mandatory |
| NFR-SEC-07 | Cookie session better-auth: `secure`, `httpOnly`, `sameSite=none` (karena FE & BE beda domain), scoped ke domain BE. | Mandatory |
| NFR-SEC-08 | Rate limiting: endpoint publik 100 req/menit per IP (`GET /menu`, `POST /bookings`, `POST /ai/chat`, `/api/auth/*`), `POST /bookings` tambahan 10 req/jam per IP, endpoint `/admin/*` 300 req/menit per staff account (bukan per IP, supaya kolega sekantor tidak berbagi kuota). Respons `429` + header `Retry-After`. | Mandatory |

### 5.3 Reliability (NFR-REL)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-REL-01 | Uptime target | 99% (Vercel + Neon) |
| NFR-REL-02 | Neon branching/backup (point-in-time restore bawaan Neon). | Mandatory |
| NFR-REL-03 | AI fallback: kalau Gemini fail, return static FAQ atau "Silakan hubungi kami di [nomor]". | Mandatory |
| NFR-REL-04 | Booking conflict detection: prevent double book via Prisma unique constraint + DB transaction. | Mandatory |
| NFR-REL-05 | Update kitchen/cashier murni via polling TanStack Query `refetchInterval` (bukan fallback — ini satu-satunya mekanisme, tidak ada WebSocket). Endpoint yang di-poll wajib `Cache-Control: no-store` supaya tidak ke-cache CDN/edge. | Mandatory |

### 5.4 Maintainability (NFR-MAINT)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-MAINT-01 | Semua akses DB lewat Prisma Client (tidak ada raw SQL kecuali untuk operasi vector/ivfflat). | Mandatory |
| NFR-MAINT-02 | Schema migration terkelola via `prisma migrate`. | Mandatory |
| NFR-MAINT-03 | API terdokumentasi (OpenAPI/Swagger atau README endpoint list) untuk dikonsumsi tim frontend. | Recommended |

---

## 6. Technical Architecture

### 6.1 Stack Overview

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Node.js + Express | HTTP server, routing, middleware |
| Language | TypeScript | Type safety |
| ORM | Prisma | Schema, migration, query builder ke Neon |
| Database | Neon (Serverless PostgreSQL) | Data persistence, pgvector extension |
| Auth | better-auth (Prisma adapter) | Staff auth (Owner, Cashier, Kitchen), session/cookie management |
| Vector Store | pgvector (extension di Neon) | RAG embeddings, cosine similarity search |
| AI | Google Gemini API | Concierge chat, recommendation, availability reasoning, embedding |
| Storage | Cloudinary | Upload & serve foto menu, gambar restoran |
| Validation | Zod (atau setara) | Request payload validation |
| Job Scheduler | node-cron (atau setara) | No-show auto-flag job |
| Rate Limiting | express-rate-limit | Batasi request per IP (publik) / per staff account (admin) — lihat NFR-SEC-08 |
| Deploy | Vercel Functions | Hosting serverless, CI/CD, env vars |

> **Realtime:** tidak ada layer WebSocket (Socket.io sempat dipertimbangkan, di-drop — lihat §9). Update kitchen/cashier ditangani via polling dari frontend.

### 6.2 System Architecture Diagram

```
┌──────────────────────────────────────────────┐
│      Next.js Frontend (Vercel) — SSR/CSR     │
│  Server: fetch awal (SSR)                     │
│  Client: TanStack Query (polling refetchInterval) │
└──────────────────────────────────────────────┘
              │ REST (fetch/TanStack Query)
              ▼
┌──────────────────────────────────────────────────────┐
│           Express API (Vercel Functions)               │
│  ┌─────────────────────────────────────────┐          │
│  │  Public Routes (No Auth Required)         │          │
│  │  ├─ GET  /menu                            │          │
│  │  ├─ POST /bookings                        │          │
│  │  └─ POST /ai/chat                         │          │
│  └─────────────────────────────────────────┘          │
│  ┌─────────────────────────────────────────┐          │
│  │  Auth Routes (better-auth)                │          │
│  │  └─ /api/auth/*  (sign-in, session, ...)  │          │
│  └─────────────────────────────────────────┘          │
│  ┌─────────────────────────────────────────┐          │
│  │  Admin Routes (Auth + Role Guard)         │          │
│  │  ├─ /admin/bookings/*                     │          │
│  │  ├─ /admin/tables/*                       │          │
│  │  ├─ /admin/orders/*                       │          │
│  │  ├─ /admin/order-items/*                  │          │
│  │  ├─ /admin/kitchen-queue                  │          │
│  │  ├─ /admin/menu/*                         │          │
│  │  └─ /admin/analytics/*                    │          │
│  └─────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
      ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
      │  Neon         │    │  Cloudinary  │    │  Google Gemini    │
      │  (Prisma ORM) │    │  (photo/img) │    │  • RAG retrieval  │
      │  + pgvector   │    │              │    │  • Availability   │
      │               │    │              │    │  • Menu recs      │
      │               │    │              │    │  • FAQ answers    │
      └──────────────┘    └──────────────┘    └──────────────────┘
```

> **Catatan:** frontend & backend deploy ke Vercel yang sama, tapi sebagai dua project/deployment terpisah (bukan monolith) — frontend tetap konsumsi backend sebagai REST API eksternal via `NEXT_PUBLIC_API_URL`.

### 6.3 Data Flow: Customer Booking via AI Chat

1. Customer (di FE) buka chat widget → kirim pesan ke `POST /ai/chat`.
2. Express handler: intent detection → retrieve context dari `vector_store` (meja available, customer history by HP, rules).
3. Construct prompt dengan context → call Gemini.
4. Gemini generate response (Bahasa Indonesia, suggest meja).
5. Response dikembalikan ke FE dengan `action` metadata (`show_availability`, `booking_form`, dst).
6. Customer kirim nama + HP → FE panggil `POST /bookings`.
7. Backend validasi: cek conflict (table_id + date + time via Prisma unique constraint), cek jam operasional.
8. Backend insert booking dalam transaction Prisma, update status meja.
9. Backend return confirmation (kode booking, meja assigned, waktu).
10. Booking baru otomatis terlihat oleh dashboard admin/cashier pada poll `GET /admin/bookings` berikutnya (tidak ada event push dari backend).

### 6.4 Data Flow: Order → Kitchen Queue (Polling)

1. Cashier submit order via `POST /admin/orders` (FE panggil via TanStack Query mutation).
2. Backend hitung total, simpan `Order` + `OrderItem` (status `pending`) via Prisma transaction.
3. Kitchen client (FE) polling `GET /admin/kitchen-queue` tiap beberapa detik (`refetchInterval`) — order baru otomatis muncul di poll berikutnya, tanpa event push dari backend.
4. Kitchen update status via `PATCH /admin/order-items/:id`.
5. Cashier dashboard ikut ter-update saat query terkait (`['bookings']`/`['orders']`) di-poll ulang pada interval-nya sendiri (bukan instan).

---

## 7. Database Schema (Prisma)

### 7.1 Entity Relationship

```
Restaurant (1 record for MVP)
    │ 1:N
    ▼
Table (meja)
    │ 1:N
    ▼
Booking (reservasi)
    │ N:1
    ▼
Customer (light profile by HP)
    │ 1:N
    ▼
Order (POS)
    │ 1:N
    ▼
OrderItem
    │ N:1
    ▼
MenuItem

User (better-auth — Owner, Cashier, Kitchen)
    │ 1:N
    ▼
Session / Account / Verification (better-auth managed tables)
```

### 7.2 Prisma Schema (`schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL") // Neon pooled connection string
}

model Restaurant {
  id             String   @id @default(uuid())
  name           String
  slug           String   @unique
  description    String?
  address        String?
  phone          String?
  email          String?
  openingHours   Json     @map("opening_hours") // { "monday": "08:00-22:00", ... }
  timezone       String   @default("Asia/Jakarta")
  logoUrl        String?  @map("logo_url")
  coverImageUrl  String?  @map("cover_image_url")
  settings       Json     @default("{}") // { hold_time_minutes, tax_rate, service_charge }
  createdAt      DateTime @default(now()) @map("created_at")

  tables         Table[]
  bookings       Booking[]
  menuCategories MenuCategory[]
  menuItems      MenuItem[]
  orders         Order[]

  @@map("restaurants")
}

model Table {
  id           String   @id @default(uuid())
  restaurantId String   @map("restaurant_id")
  name         String   // "Meja 1"
  area         String   // 'indoor' | 'outdoor'
  capacity     Int
  status       String   @default("available") // available | reserved | occupied | maintenance
  sortOrder    Int      @default(0) @map("sort_order")
  createdAt    DateTime @default(now()) @map("created_at")

  restaurant Restaurant @relation(fields: [restaurantId], references: [id])
  bookings   Booking[]
  orders     Order[]

  @@map("tables")
}

model Customer {
  id             String    @id @default(uuid())
  phone          String    @unique
  name           String?
  email          String?
  preferences    Json      @default("{}") // { preferred_area, dietary: [] }
  totalVisits    Int       @default(0) @map("total_visits")
  totalSpent     Int       @default(0) @map("total_spent")
  noShowCount    Int       @default(0) @map("no_show_count")
  lastVisitDate  DateTime? @map("last_visit_date")
  createdAt      DateTime  @default(now()) @map("created_at")

  bookings Booking[]

  @@map("customers")
}

model Booking {
  id              String    @id @default(uuid())
  restaurantId    String    @map("restaurant_id")
  customerId      String?   @map("customer_id")
  customerName    String    @map("customer_name")
  customerPhone   String    @map("customer_phone")
  tableId         String?   @map("table_id")
  partySize       Int       @map("party_size")
  bookingDate     DateTime  @map("booking_date") @db.Date
  bookingTime     DateTime  @map("booking_time") @db.Time
  areaPreference  String?   @map("area_preference") // indoor | outdoor | no_preference
  specialRequests String?   @map("special_requests")
  status          String    @default("confirmed") // confirmed | seated | completed | no_show | cancelled
  source          String    @default("web") // web | walk_in | phone
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  restaurant Restaurant @relation(fields: [restaurantId], references: [id])
  customer   Customer?  @relation(fields: [customerId], references: [id])
  table      Table?     @relation(fields: [tableId], references: [id])
  orders     Order[]

  @@index([bookingDate])
  @@index([status])
  @@index([customerPhone])
  @@index([tableId, bookingDate, bookingTime])
  // Anti double-book: dijaga juga secara aplikatif via transaction check
  // karena partial unique index (where status in confirmed/seated) tidak
  // didukung langsung oleh Prisma — dibuat via raw migration SQL (lihat 7.3).
  @@map("bookings")
}

model MenuCategory {
  id           String  @id @default(uuid())
  restaurantId String  @map("restaurant_id")
  name         String
  sortOrder    Int     @default(0) @map("sort_order")
  isActive     Boolean @default(true) @map("is_active")

  restaurant Restaurant @relation(fields: [restaurantId], references: [id])
  menuItems  MenuItem[]

  @@map("menu_categories")
}

model MenuItem {
  id           String   @id @default(uuid())
  restaurantId String   @map("restaurant_id")
  categoryId   String   @map("category_id")
  name         String
  price        Int
  description  String?
  imageUrl     String?  @map("image_url") // Cloudinary secure_url
  tags         String[] @default([])      // best_seller, spicy, vegetarian, new
  status       String   @default("available") // available | out_of_stock
  sortOrder    Int      @default(0) @map("sort_order")
  createdAt    DateTime @default(now()) @map("created_at")

  restaurant Restaurant   @relation(fields: [restaurantId], references: [id])
  category   MenuCategory @relation(fields: [categoryId], references: [id])
  orderItems OrderItem[]

  @@map("menu_items")
}

model Order {
  id             String   @id @default(uuid())
  restaurantId   String   @map("restaurant_id")
  bookingId      String?  @map("booking_id") // nullable untuk walk-in
  customerPhone  String?  @map("customer_phone")
  tableId        String   @map("table_id")
  subtotal       Int      @default(0)
  tax            Int      @default(0)
  serviceCharge  Int      @default(0) @map("service_charge")
  total          Int      @default(0)
  status         String   @default("active") // active | completed | cancelled
  paymentStatus  String   @default("unpaid") @map("payment_status") // unpaid | paid
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  restaurant Restaurant  @relation(fields: [restaurantId], references: [id])
  booking    Booking?    @relation(fields: [bookingId], references: [id])
  table      Table       @relation(fields: [tableId], references: [id])
  items      OrderItem[]

  @@map("orders")
}

model OrderItem {
  id          String   @id @default(uuid())
  orderId     String   @map("order_id")
  menuItemId  String   @map("menu_item_id")
  qty         Int      @default(1)
  priceAtTime Int      @map("price_at_time") // snapshot harga saat order
  notes       String?  // "kurang pedas", "no msg"
  status      String   @default("pending") // pending | cooking | ready | served
  createdAt   DateTime @default(now()) @map("created_at")

  order    Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  menuItem MenuItem @relation(fields: [menuItemId], references: [id])

  @@index([status])
  @@map("order_items")
}

// ── better-auth managed models (nama disesuaikan default adapter better-auth) ──

model User {
  id            String    @id @default(uuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false) @map("email_verified")
  image         String?
  role          String    // owner | cashier | kitchen — custom additional field
  isActive      Boolean   @default(true) @map("is_active")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  sessions Session[]
  accounts Account[]

  @@map("users")
}

model Session {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  token     String   @unique
  expiresAt DateTime @map("expires_at")
  ipAddress String?  @map("ip_address")
  userAgent String?  @map("user_agent")
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("sessions")
}

model Account {
  id                    String    @id @default(uuid())
  userId                String    @map("user_id")
  accountId             String    @map("account_id")
  providerId            String    @map("provider_id")
  accessToken           String?   @map("access_token")
  refreshToken          String?   @map("refresh_token")
  password              String?
  createdAt             DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("accounts")
}

model Verification {
  id         String   @id @default(uuid())
  identifier String
  value      String
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("verifications")
}

// ── RAG vector store ──

model VectorStore {
  id        String                 @id @default(uuid())
  content   String
  embedding Unsupported("vector(768)") // Gemini embedding dimension
  metadata  Json                   // { type: 'menu'|'meja'|'rule'|'faq'|'customer', source_id, category }
  createdAt DateTime               @default(now()) @map("created_at")

  @@map("vector_store")
}
```

### 7.3 Raw Migration Additions (di luar jangkauan Prisma schema)

Ditambahkan lewat migration SQL manual (`prisma migrate dev --create-only` lalu edit file SQL):

```sql
-- Enable extension
create extension if not exists vector;

-- Similarity search index
create index idx_vector_store_embedding on vector_store using ivfflat (embedding vector_cosine_ops);

-- Anti double-book: partial unique index (Prisma belum support kondisi WHERE di @@unique)
create unique index idx_bookings_no_conflict on bookings(table_id, booking_date, booking_time)
  where status in ('confirmed', 'seated');
```

> Catatan: cek konflik booking tetap dilakukan dulu di application layer (di dalam Prisma transaction)
> sebelum insert, supaya error dari partial unique index bisa diterjemahkan jadi pesan error yang jelas
> ("meja sudah dibooking di jam ini") daripada raw constraint violation.

> **Peringatan operasional:** `idx_vector_store_embedding` dan `idx_bookings_no_conflict` tidak
> terekspresikan di `schema.prisma` (Prisma belum punya syntax untuk index `ivfflat`/partial). Akibatnya,
> `prisma migrate dev` biasa (tanpa `--create-only`) akan mendeteksi keduanya sebagai "drift" dan
> **menyiapkan migration yang men-DROP index tersebut**. Selalu jalankan
> `prisma migrate dev --create-only` dulu, periksa isi SQL yang dihasilkan, dan buang/edit migration itu
> kalau isinya `DROP INDEX idx_vector_store_embedding` atau `DROP INDEX idx_bookings_no_conflict` —
> jangan pernah apply itu secara blind. Catatan ini sengaja ditaruh di sini (bukan di dalam file
> `migration.sql` yang sudah ter-apply) karena mengedit migration yang sudah apply akan mengubah
> checksum-nya dan memicu Prisma minta `migrate reset`.

### 7.4 Seed Data (ringkas)
- 1 `Restaurant` ("Warung Bagas"), `settings: { hold_time_minutes: 15, tax_rate: 10, service_charge: 5 }`.
- 20 `Table` (10 indoor, 10 outdoor, kapasitas 2/4/6/8 bervariasi) — sesuai daftar PRD v1.0 §7.2.
- 3 `MenuCategory` (Food, Beverages, Dessert), 18 `MenuItem` — harga dalam **USD cents** (lihat §14.3 changelog).
- 3 akun staff (`owner`, `cashier`, `kitchen`) di-provision manual via seed script, bukan via signup publik.

---

## 8. API Specifications

Semua response mengikuti kontrak:
```json
{ "success": true, "data": { ... } }
```
atau saat error:
```json
{ "success": false, "error": { "code": "NO_TABLE_AVAILABLE", "message": "No table available for that time and party size." } }
```

### 8.1 Public API (No Auth)

#### `GET /menu`
**Query:** `?category=&tag=&search=`
**Response:** List menu items grouped by category.

#### `POST /bookings`
**Request:**
```json
{
  "customer_name": "Budi Santoso",
  "customer_phone": "081234567890",
  "party_size": 4,
  "booking_date": "2026-07-10",
  "booking_time": "19:00",
  "area_preference": "indoor",
  "special_requests": "Ulang tahun, bawa kue"
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "booking_id": "uuid",
    "booking_code": "WB-10072026-001",
    "customer_name": "Budi Santoso",
    "customer_phone": "081234567890",
    "party_size": 4,
    "booking_date": "2026-07-10",
    "booking_time": "19:00",
    "table": { "id": "uuid", "name": "Table 5", "area": "indoor", "capacity": 6 },
    "status": "confirmed",
    "message": "Table 5 (indoor) has been reserved. Please arrive 15 minutes before your booking time."
  }
}
```

#### `POST /ai/chat`
**Request:**
```json
{
  "message": "Jam 7 malam untuk 4 orang masih ada?",
  "customer_phone": "081234567890",
  "session_id": "uuid"
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "response": "Halo! Untuk jam 7 malam (19:00) hari ini, kami masih punya Meja 5 (indoor, 4 orang) dan Meja 13 (outdoor, 4 orang). Area mana yang Anda prefer?",
    "action": "show_availability",
    "suggested_tables": [
      { "id": "uuid", "name": "Meja 5", "area": "indoor", "capacity": 4 },
      { "id": "uuid", "name": "Meja 13", "area": "outdoor", "capacity": 4 }
    ]
  }
}
```

### 8.2 Auth API (better-auth, mounted di `/api/auth/*`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/sign-in/email` | POST | Login staff (email + password) |
| `/api/auth/sign-out` | POST | Logout, invalidate session |
| `/api/auth/get-session` | GET | Ambil session aktif (dipakai FE untuk cek role) |
| `/api/auth/sign-up/email` | POST | **Dinonaktifkan** (`disableSignUp: true`) — staff tidak bisa self-register |

> Endpoint di atas otomatis di-generate better-auth handler (verified path names, bukan asumsi) —
> ditulis di sini sebagai kontrak yang dikonsumsi FE. Ganti password staff dilakukan lewat
> `auth.api.changePassword` bawaan better-auth begitu FE mengimplementasikan halaman settings staff.

### 8.3 Admin API (Auth + Role Guard Required)

Middleware urutan: `requireAuth` → `requireRole(['owner', 'cashier', 'kitchen'])` (role spesifik per route).

#### `GET /admin/bookings`
**Roles:** owner, cashier
**Query:** `?date=2026-07-10&status=confirmed&area=indoor&search=budi`
**Response:** List bookings dengan data customer, meja.

#### `PATCH /admin/bookings/:id`
**Roles:** owner, cashier
**Request:** `{ "status": "seated" }` atau `{ "status": "no_show" }` atau `{ "status": "cancelled" }`

#### `GET /admin/tables` · `POST /admin/tables` · `PATCH /admin/tables/:id` · `DELETE /admin/tables/:id`
**Roles:** owner (write), owner+cashier (read)

#### `POST /admin/orders`
**Roles:** owner, cashier
**Request:**
```json
{
  "table_id": "uuid",
  "customer_phone": "081234567890",
  "items": [
    { "menu_item_id": "uuid", "qty": 2, "notes": "kurang pedas" },
    { "menu_item_id": "uuid", "qty": 1 }
  ]
}
```

#### `PATCH /admin/orders/:id`
**Roles:** owner, cashier
**Request:** `{ "payment_status": "paid" }`

#### `GET /admin/orders/:id/bill`
**Roles:** owner, cashier
**Response:** items, qty, harga per item, subtotal, tax (10%), service charge (5%), total.

#### `GET /admin/kitchen-queue`
**Roles:** owner, kitchen
**Response:** List order items status `pending`/`cooking`, sorted by `created_at`.

#### `PATCH /admin/order-items/:id`
**Roles:** owner, kitchen
**Request:** `{ "status": "cooking" }` atau `{ "status": "ready" }` atau `{ "status": "served" }`

#### `POST /admin/menu` · `PATCH /admin/menu/:id` · `DELETE /admin/menu/:id`
**Roles:** owner (write), semua (read via `GET /menu` publik)
**Request (multipart/form-data):** field menu + file foto → backend upload ke Cloudinary → simpan `image_url`.

#### `GET /admin/analytics`
**Roles:** owner
**Query:** `?date=2026-07-10`
**Response:**
```json
{
  "total_bookings": 25,
  "total_walk_ins": 10,
  "total_revenue": 142500,
  "occupancy_rate": 75,
  "no_show_count": 2,
  "menu_top": [
    { "name": "Mixed Rice Platter", "order_count": 45 },
    { "name": "Crispy Fried Chicken", "order_count": 38 }
  ]
}
```

> Catatan: semua nilai uang (`total_revenue`, `price`, `subtotal`, `tax`, dst di seluruh API) disimpan & dikembalikan sebagai **integer USD cents** (mis. `142500` = $1,425.00) — lihat §7.4 & §14.3 changelog.

#### `GET /admin/analytics/timeline` · `GET /admin/analytics/menu-performance`
**Roles:** owner

---

## 9. Update Strategy: Polling (Bukan Realtime Push)

Backend **tidak menyediakan WebSocket/realtime push** apa pun. Socket.io sempat diimplementasi penuh (kitchen & cashier namespace, event `order:created`/`orderItem:statusChanged`) lalu **dicabut total** — alasannya backend deploy ke **Vercel Functions** (serverless), yang tidak bisa menahan koneksi persisten seperti yang dibutuhkan WebSocket. Semua "update realtime" di frontend murni hasil **polling**: frontend fetch ulang endpoint GET yang sama secara berkala via TanStack Query `refetchInterval`. Backend tidak perlu tahu atau peduli siapa yang "subscribe" — setiap endpoint GET tetap stateless seperti biasa.

### 9.1 Endpoint yang Di-poll & Interval yang Disarankan

| Endpoint | Dipoll oleh | Interval Disarankan | Alasan |
|---|---|---|---|
| `GET /admin/kitchen-queue` | Kitchen display | 3-5 detik | Butuh terasa responsif — staff dapur nunggu order baru |
| `GET /admin/bookings` | Cashier / booking dashboard | 10-15 detik | Kurang time-sensitive dibanding kitchen |
| `GET /admin/orders` (kalau dipakai live) | Cashier POS | 10-15 detik | Sama seperti bookings |

### 9.2 Perubahan yang "Terlihat" via Polling

Tabel ini menggantikan tabel event Socket.io versi sebelumnya — sekarang murni dokumentasi "perubahan apa yang bakal muncul di endpoint mana pada poll berikutnya", bukan event yang di-emit:

| Perubahan | Trigger | Terlihat di | Field yang berubah |
|---|---|---|---|
| Order baru masuk kitchen | `POST /admin/orders` | `GET /admin/kitchen-queue` | item baru dengan `status: "pending"` |
| Status order item berubah | `PATCH /admin/order-items/:id` | `GET /admin/kitchen-queue` | `status` |
| Booking baru | `POST /bookings` | `GET /admin/bookings` | record baru |
| Status booking berubah | `PATCH /admin/bookings/:id` | `GET /admin/bookings` | `status` |

### 9.3 Konsekuensi & Trade-off

- **Delay maksimum** = interval polling (bukan instan). Untuk tool internal staff-only skala kecil (≤5 concurrent user), ini acceptable — lihat NFR-PERF-02.
- **`Cache-Control: no-store` wajib** di endpoint yang di-poll — Vercel Functions/CDN bisa nge-cache response GET kalau tidak diset, bikin staff lihat data basi walau polling jalan normal.
- Kalau di masa depan butuh update benar-benar instan (<1 detik): opsi yang tersedia adalah pindah hosting backend ke platform yang support long-running process (Railway/Render) + Socket.io, atau pakai Supabase Realtime — dua-duanya sudah dievaluasi dan **di-drop untuk MVP ini** demi kesederhanaan & kompatibilitas Vercel (lihat Change Log §14.3).

---

## 10. AI Concierge Architecture (RAG)

### 10.1 RAG Data Sources

| Source | Content | Update Frequency |
|--------|---------|------------------|
| **Menu Items** | "Nasi Campur: Rp 25.000. Nasi dengan lauk komplit. Best seller. Bumbu kuning." | Real-time (saat menu update via `POST/PATCH /admin/menu`) |
| **Meja Data** | "Meja 1-10: indoor, capacity 2-8. Meja 11-20: outdoor, capacity 2-8." | Static (jarang berubah) |
| **Rules & FAQ** | "Jam operasional: 08:00-22:00. Hold time: 15 menit. Parkiran: tersedia. Smoking: outdoor only." | Static |
| **Customer History** | "0812-xxx: 3 visits, last 2026-05-20, prefer indoor, pernah pesan Nasi Campur 2x." | Per booking/order |
| **Booking Context** | "Hari ini: 20 booking confirmed, 5 meja available jam 19:00." | Real-time |

Semua source di atas di-embed dan disimpan di tabel `vector_store` (Neon + pgvector), diakses lewat Prisma raw query (`$queryRaw`) untuk cosine similarity search karena tipe `vector` adalah `Unsupported` di Prisma.

### 10.2 RAG Flow

```
Customer message: "Mau booking 4 orang jam 7"
    ↓
Intent detection: "booking_request"
    ↓
Retrieve (via Prisma $queryRaw ke vector_store + regular query):
  - Meja available: jam 19:00, capacity >= 4 → [Meja 5 (indoor, 6), Meja 13 (outdoor, 4)]
  - Customer history: 0812-xxx → 3 visits, prefer indoor
  - Rules: hold time 15 menit
    ↓
Construct prompt → Gemini generate response
    ↓
Parse response + inject action metadata (suggested_tables)
    ↓
Return via POST /ai/chat response ke frontend
```

### 10.3 Intent Detection (Simple Rule-Based + LLM)

| Intent | Keywords | Action |
|--------|----------|--------|
| `check_availability` | "masih ada", "slot", "jam", "available" | Retrieve meja available |
| `booking_request` | "booking", "reservasi", "pesan meja" | Collect data + submit booking |
| `menu_recommendation` | "rekomendasi", "enak", "gurih", "pedas" | Retrieve menu by filter |
| `menu_query` | "menu", "harga", "apa aja" | List menu categories |
| `faq` | "parkir", "jam", "bawa anak", "halal" | Retrieve rules & FAQ |
| `cancel_booking` | "cancel", "batal" | Retrieve booking by HP + cancel |

### 10.4 Embedding Strategy
- **Model**: Gemini embedding (`text-embedding-004`)
- **Chunking**: Per menu item (1 chunk = 1 item), per FAQ (1 chunk = 1 Q&A), per meja (1 chunk = area summary)
- **Metadata**: `type` (menu/meja/rule/faq/customer), `source_id`, `category`
- **Update**: Saat menu/meja/rules berubah via admin endpoint, re-index entry terkait di `vector_store`

---

## 11. Security & Access Control

### 11.1 Role-Based Access (Application Layer Middleware)

Karena database (Neon) tidak punya fitur RLS seperti Supabase, otorisasi 100% ditegakkan di **middleware Express**:

```
requireAuth()        // validasi session better-auth aktif
requireRole([...])   // cek field role user vs daftar role yang diizinkan
```

| Role | Public Endpoints | Admin Endpoints |
|------|-------------------|------------------|
| **Guest** | `GET /menu`, `POST /bookings`, `POST /ai/chat` | — |
| **Owner** | Semua public | Semua admin endpoint |
| **Cashier** | Semua public | `/admin/bookings/*`, `/admin/orders/*`, `/admin/menu` (read only) |
| **Kitchen** | — | `/admin/kitchen-queue`, `/admin/order-items/:id` (update status) |

### 11.2 Data Privacy
- Customer HP tidak expose di response `GET /menu` atau endpoint publik lain (kecuali untuk admin/cashier).
- Chat history tidak disimpan permanen (opsional, retention 7 hari untuk debugging, disimpan di tabel terpisah bukan `vector_store`).
- Payment data tidak disimpan (MVP tidak ada online payment gateway).

### 11.3 Environment Secrets

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon pooled connection string (dipakai Prisma) |
| `DIRECT_URL` | Neon direct connection (dipakai Prisma migrate) |
| `BETTER_AUTH_SECRET` | Signing secret better-auth |
| `BETTER_AUTH_URL` | Base URL backend (untuk cookie/callback) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Upload gambar |
| `GEMINI_API_KEY` | AI Concierge & embedding |
| `FRONTEND_ORIGIN` | Whitelist CORS origin (domain Vercel) |

---

## 12. Success Criteria & KPIs

### 12.1 Functional Success
| Criteria | Target | Measurement |
|----------|--------|-------------|
| Booking API | 100% | E2E test pass |
| AI chat response | <2s | Timer test |
| Kitchen queue data freshness | ≤5s | Polling interval test |
| No double booking | 100% | Conflict detection test (concurrent request) |
| Role-based access | 100% | Penetration test tiap role |

### 12.2 Performance Success
| Criteria | Target | Tool |
|----------|--------|------|
| REST API p95 latency | <300ms | Load test (k6/Artillery) |
| Kitchen queue data freshness | ≤5s | Manual + polling interval test |

### 12.3 Business Success
| Criteria | Target | Measurement |
|----------|--------|-------------|
| Booking conversion rate | >60% | (booking submitted / booking page visit, diukur dari FE) |
| AI handle inquiry | >70% | (chat sessions tanpa human intervention) |
| Kitchen queue accuracy | 100% | (no missed orders) |
| No-show tracking | >90% | (auto-flag accuracy) |

---

## 13. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Gemini API rate limit / downtime | Medium | High | Fallback: static FAQ response + "hubungi kami" |
| Double booking (race condition) | Medium | High | Prisma transaction + partial unique index (§7.3) + application-level check |
| Kitchen display delay (bukan instan, sifatnya polling) | Low | Medium | Interval polling pendek khusus kitchen (3-5 detik), `Cache-Control: no-store`, optimistic UI di FE saat update status |
| Neon cold start / connection limit | Medium | Medium | Gunakan pooled connection string, tune Prisma connection pool |
| Cross-origin cookie better-auth bermasalah di beberapa browser | Medium | Medium | `sameSite=none; secure`, test di Safari/iOS, dokumentasikan domain setup |
| Cloudinary upload gagal / kuota | Low | Medium | Validasi ukuran file di FE sebelum upload, monitor kuota |
| Scope creep (tambah takeaway, delivery) | High | High | Strict MVP. Post-MVP list documented. |
| Meja assignment AI tidak optimal | Medium | Medium | Admin bisa override meja assignment. AI suggest, admin confirm. |

---

## 14. Appendix

### 14.1 Glossary
| Term | Definition |
|------|------------|
| **Booking** | Reservasi meja untuk dine-in pada tanggal dan waktu tertentu. |
| **Walk-in** | Customer datang tanpa booking sebelumnya. |
| **Hold Time** | Waktu toleransi (15 menit) sebelum booking di-flag sebagai no-show. |
| **RAG** | Retrieval-Augmented Generation — AI retrieve konteks dari database sebelum generate response. |
| **Light Profile** | Data customer minimal (nama + HP + histori) tanpa formal akun. |
| **POS** | Point of Sale — sistem kasir untuk input order dan generate bill. |
| **Kitchen Queue** | Antrean order yang masuk ke kitchen, dengan status update. |

### 14.2 Reference Links
- Express: https://expressjs.com
- Prisma: https://www.prisma.io/docs
- Neon: https://neon.tech/docs
- better-auth: https://www.better-auth.com/docs
- Cloudinary: https://cloudinary.com/documentation
- Gemini API: https://ai.google.dev/gemini-api/docs
- pgvector: https://github.com/pgvector/pgvector
- Vercel: https://vercel.com/docs

### 14.3 Change Log

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-06-06 | Initial PRD (fullstack Next.js + Supabase) | Technical Lead — Megatha Tech |
| 2.0 | 2026-07-07 | Pisah jadi PRD backend-only. Migrasi Supabase → Neon + Prisma. Auth Supabase → better-auth. Realtime Supabase → Socket.io. Storage Supabase → Cloudinary. Deploy Vercel → Railway (backend). | Technical Lead — Megatha Tech |
| 2.1 | 2026-07-08 | Drop Socket.io/WebSocket sepenuhnya (sempat diimplementasi penuh, lalu dicabut). Deploy target backend pindah dari Railway ke **Vercel Functions** (serverless, tidak support koneksi persisten). Update kitchen/cashier diganti jadi **polling** (TanStack Query `refetchInterval`) — lihat §9. | Technical Lead — Megatha Tech |
| 2.2 | 2026-07-08 | Semua endpoint & FR/POS/POS-02/POS-03/KIT/DASH selesai diimplementasi (kecuali AI Concierge). Currency diganti dari IDR ke **USD** (integer cents di seluruh nilai uang, lihat §7.4, §8.3). Tambah **NFR-SEC-08** rate limiting (`express-rate-limit`, 429 + `Retry-After`). Semua contoh response & seed data diselaraskan ke bahasa Inggris (nama meja, kategori, menu). `FR-POS-03` ditambah pagination. | Technical Lead — Megatha Tech |

---

**End of Document**
