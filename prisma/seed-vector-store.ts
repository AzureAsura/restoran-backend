// ============================================================================
// [CATATAN BELAJAR — SEMENTARA, akan dirapikan lagi setelah dipahami]
//
// File ini adalah "script sekali-jalan" (bukan bagian dari server yang jalan
// terus). Tujuannya: mengisi tabel `vector_store` di database dengan
// "pengetahuan" tentang restoran (menu, meja, aturan), supaya nanti fitur
// AI Chat bisa "membaca" pengetahuan itu saat menjawab customer.
//
// Analoginya: bayangkan AI Chat itu murid baru yang belum tahu apa-apa soal
// restoran ini. Sebelum dia bisa ditanya-tanya customer, dia perlu "belajar"
// dulu — baca daftar menu, denah meja, dan aturan resto. Script ini adalah
// proses "mengajarkan" itu: ambil data asli dari tabel Restaurant/MenuItem/
// Table di database, ubah jadi kalimat manusiawi, lalu simpan kalimat itu
// (plus "sidik jari makna"-nya / embedding) ke tabel `vector_store`.
//
// Kenapa perlu "sidik jari makna" (embedding)? Supaya nanti saat customer
// nanya "ada makanan pedas?", sistem bisa cari kalimat mana di vector_store
// yang PALING MIRIP MAKNANYA dengan pertanyaan itu — bukan cocok kata
// persis, tapi cocok makna (ini yang disebut "semantic search").
// ============================================================================

import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaClient, type Restaurant } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { embedText } from '../src/lib/gemini'
import { buildMenuItemChunkContent } from '../src/modules/ai/ai.service'

// Sama seperti prisma/seed.ts — koneksi Prisma standalone punya script ini sendiri
// (bukan pinjam dari src/lib/prisma.ts), karena ini dijalankan manual lewat
// terminal, bukan sebagai bagian dari server Express yang jalan terus.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// "Chunk" = satu potongan pengetahuan siap-simpan: teksnya + label kategorinya
// (metadata). Satu Chunk nanti jadi satu baris di tabel vector_store.
type Chunk = {
  content: string
  metadata: { type: 'menu' | 'table' | 'faq'; source_id: string; category: string }
}

// Mengubah 1 Chunk jadi 1 baris di tabel vector_store.
// 1. embedText() manggil Gemini API, minta diubah jadi 768 angka (embedding) —
//    ini "sidik jari makna" yang disebut di atas.
// 2. $executeRaw dipakai (bukan prisma.vectorStore.create() biasa) karena
//    kolom `embedding` bertipe khusus Postgres (`vector(768)`, dari extension
//    pgvector) yang Prisma Client TIDAK bisa tulis lewat query builder normal
//    — makanya di schema.prisma kolom ini ditandai `Unsupported(...)`.
// 3. randomUUID() dibuat manual di sini karena kolom `id` di tabel ini TIDAK
//    punya default otomatis di level database (beda dari tabel lain yang
//    auto-generate UUID sendiri) — sudah dicek langsung ke file migration SQL-nya.
async function insertChunk(chunk: Chunk) {
  const embedding = await embedText(chunk.content)
  // pgvector menerima teks vector dalam format "[0.1,0.2,0.3,...]" — array
  // biasa dari JS diubah jadi string format itu di sini.
  const vectorLiteral = `[${embedding.join(',')}]`

  await prisma.$executeRaw`
    INSERT INTO vector_store (id, content, embedding, metadata)
    VALUES (${randomUUID()}, ${chunk.content}, ${vectorLiteral}::vector, ${JSON.stringify(chunk.metadata)}::jsonb)
  `
}

// Ambil semua menu item yang masih aktif (belum dihapus/soft-delete), lalu
// ubah masing-masing jadi 1 kalimat deskriptif. 1 menu item = 1 Chunk.
// Contoh hasil: "Beef Rendang: $32.00. Tender beef slow-cooked in rich
// Padang-style spices. Tags: best_seller, spicy. Category: Food."
async function buildMenuChunks(restaurantId: string): Promise<Chunk[]> {
  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId, deletedAt: null },
    include: { category: true },
  })

  return menuItems.map((item) => ({
    content: buildMenuItemChunkContent({
      name: item.name,
      price: item.price,
      description: item.description,
      tags: item.tags,
      categoryName: item.category.name,
    }),
    metadata: { type: 'menu', source_id: item.id, category: item.category.name },
  }))
}

// Beda dari menu (1 chunk per item), meja dirangkum 1 chunk PER AREA (indoor/
// outdoor) — soalnya AI gak perlu tahu detail "Meja 7 kapasitas 8", cukup
// tahu gambaran umum area itu. Angka jumlah meja & rentang kapasitas dihitung
// LANGSUNG dari data Table yang ada di database (bukan angka yang diketik
// manual di sini) — jadi kalau nanti meja ditambah/dikurangi lewat halaman
// admin, tinggal jalankan ulang script ini, otomatis ikut update.
async function buildTableChunks(restaurantId: string): Promise<Chunk[]> {
  const tables = await prisma.table.findMany({ where: { restaurantId } })
  const areas = [...new Set(tables.map((t) => t.area))]

  return areas.map((area) => {
    const areaTables = tables.filter((t) => t.area === area)
    const capacities = areaTables.map((t) => t.capacity)
    const minCap = Math.min(...capacities)
    const maxCap = Math.max(...capacities)
    const areaLabel = area.charAt(0).toUpperCase() + area.slice(1)

    return {
      content: `${areaLabel} seating: ${areaTables.length} tables, capacity ${minCap}-${maxCap} guests.`,
      metadata: { type: 'table', source_id: restaurantId, category: area },
    }
  })
}

// Chunk "aturan umum" — identitas/kontak, jam buka, waktu tahan reservasi,
// pajak/service charge, kapasitas meja terbesar. SEMUA angka & fakta di sini
// diambil dari kolom restaurant.* yang beneran ada di database — sengaja
// TIDAK ada kebijakan yang dikarang manual (misal soal parkir/smoking)
// karena itu belum dikonfirmasi datanya. Prinsipnya: AI cuma boleh "tahu"
// hal yang memang benar adanya, biar gak salah kasih info ke customer.
function buildFaqChunks(restaurant: Restaurant, maxTableCapacity: number): Chunk[] {
  const hours = restaurant.openingHours as Record<string, string>
  const settings = restaurant.settings as { hold_time_minutes?: number; tax_rate?: number; service_charge?: number }

  const hoursText = Object.entries(hours)
    .map(([day, range]) => `${day.charAt(0).toUpperCase() + day.slice(1)}: ${range}`)
    .join(', ')

  return [
    {
      content: `${restaurant.name} is located at ${restaurant.address ?? 'address not available'}. Phone: ${restaurant.phone ?? 'not available'}. Email: ${restaurant.email ?? 'not available'}.`,
      metadata: { type: 'faq', source_id: 'restaurant-contact', category: 'general' },
    },
    {
      content: `Opening hours: ${hoursText}.`,
      metadata: { type: 'faq', source_id: 'opening-hours', category: 'general' },
    },
    {
      content: `A confirmed reservation holds the table for ${settings.hold_time_minutes ?? 15} minutes after the booking time before it is released.`,
      metadata: { type: 'faq', source_id: 'hold-time', category: 'general' },
    },
    {
      content: `Bills include a ${settings.tax_rate ?? 10}% tax and a ${settings.service_charge ?? 5}% service charge on top of the subtotal.`,
      metadata: { type: 'faq', source_id: 'tax-service-charge', category: 'general' },
    },
    {
      content: `The largest table seats ${maxTableCapacity} guests. Combining multiple tables for larger parties is not currently supported.`,
      metadata: { type: 'faq', source_id: 'party-size-policy', category: 'general' },
    },
  ]
}

// Titik masuk script — urutannya:
// 1. Ambil data restoran (harus sudah ada — dari `npm run db:seed`).
// 2. Kosongkan vector_store dulu (biar script ini AMAN dijalankan berkali-kali
//    tanpa numpuk data duplikat — "rebuild total" tiap dipanggil).
// 3. Kumpulkan semua Chunk (menu + table + faq).
// 4. Simpan satu-satu ke database (pakai for...of biasa, BUKAN Promise.all
//    yang jalan bareng semua — sengaja diperlambat begini biar gak nembak
//    Gemini API kebanyakan request sekaligus dan kena limit).
// 5. REINDEX index ivfflat-nya (lihat komentar di bawah — index ini dibuat
//    waktu tabel masih kosong, jadi harus dibangun ulang tiap kali datanya
//    di-rebuild total, kalau tidak similarity search bisa balikin hasil
//    kosong/salah untuk sebagian query walau datanya ada).
async function main() {
  const restaurant = await prisma.restaurant.findFirst()
  if (!restaurant) {
    throw new Error('No restaurant found — run `npm run db:seed` first.')
  }

  await prisma.$executeRaw`DELETE FROM vector_store`

  const tables = await prisma.table.findMany({ where: { restaurantId: restaurant.id } })
  const maxTableCapacity = Math.max(...tables.map((t) => t.capacity))

  const chunks = [
    ...(await buildMenuChunks(restaurant.id)),
    ...(await buildTableChunks(restaurant.id)),
    ...buildFaqChunks(restaurant, maxTableCapacity),
  ]

  for (const chunk of chunks) {
    await insertChunk(chunk)
  }

  // pgvector's ivfflat index clusters rows into "lists" based on the data
  // present AT INDEX-CREATION TIME. idx_vector_store_embedding was created
  // by a migration back when this table was empty, so its clusters were
  // never meaningful — rows inserted afterward can land in a way the index
  // scan silently skips, returning 0 rows for some queries even though
  // matching data exists (confirmed via manual seq-scan test). REINDEX
  // rebuilds the clusters from the data that's actually in the table now.
  await prisma.$executeRaw`REINDEX INDEX idx_vector_store_embedding`

  console.log('Vector store seeded:', {
    menu: chunks.filter((c) => c.metadata.type === 'menu').length,
    table: chunks.filter((c) => c.metadata.type === 'table').length,
    faq: chunks.filter((c) => c.metadata.type === 'faq').length,
  })
}

main()
  .catch((err) => {
    console.error('Vector store seed failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
