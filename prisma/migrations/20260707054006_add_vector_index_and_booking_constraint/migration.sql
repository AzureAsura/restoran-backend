-- Similarity search index for RAG retrieval
CREATE INDEX idx_vector_store_embedding ON vector_store USING ivfflat (embedding vector_cosine_ops);

-- Anti double-book: partial unique index (Prisma does not support WHERE conditions in @@unique)
CREATE UNIQUE INDEX idx_bookings_no_conflict ON bookings(table_id, booking_date, booking_time)
  WHERE status IN ('confirmed', 'seated');
