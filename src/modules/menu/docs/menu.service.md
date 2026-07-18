# menu.service.ts

## `reindexMenuItem` / `deindexMenuItem` — Fase 11, `vector_store` live sync

Since Fase 2, `vector_store` (used by the AI concierge's RAG retrieval — see `src/modules/ai/docs/ai.service.md`) only got populated by manually running `npm run db:seed-vectors`. Any menu item created/edited/deleted through the admin panel after that point was invisible to the AI until someone remembered to re-run that script. Fase 11 closes that gap: `createMenuItem`, `updateMenuItem`, and `softDeleteMenuItem` now each call one of these two helpers right after their own Prisma write succeeds.

### Why fire-and-forget (`.catch()`, not `await`)

`upsertMenuItemEmbedding`/`deleteMenuItemEmbedding` (in `ai.service.ts`) call Gemini to compute an embedding — an external network call that can be slow or fail (rate limit, outage, bad key). Menu CRUD is a day-to-day staff operation that must not depend on Gemini's uptime or latency. `reindexMenuItem`/`deindexMenuItem` deliberately don't `await` the embedding call; they fire it and attach a `.catch()` that only logs (`console.error`), so:
- `createMenuItem`/`updateMenuItem`/`softDeleteMenuItem` return to the caller as soon as their own DB write is done, not after Gemini responds.
- If Gemini fails entirely, the menu mutation still succeeds — `vector_store` is just temporarily stale for that one item until the next successful write or a manual `db:seed-vectors` re-run. This trade-off (staff-facing CRUD is unaffected; AI Concierge is the only thing that can be a bit stale) is the whole reason this API is separate from `checkAvailability`/`getCustomerContext`, which are awaited results the caller actually needs immediately.

### Why delete-then-insert instead of a real `UPDATE`

`vector_store` has no unique constraint on `metadata->>'source_id'` (it's a JSONB field, not an indexed column), so there's no `ON CONFLICT` to upsert against. `upsertMenuItemEmbedding` deletes any existing row for that item's `source_id` first, then inserts a fresh one — same net effect (exactly one current chunk per active menu item), simpler than trying to `UPDATE ... SET embedding = ...` against a JSONB-matched row.

### Chunk content template shared with the bulk seed script, not duplicated

`buildMenuItemChunkContent` (in `ai.service.ts`) is the same function `prisma/seed-vector-store.ts`'s `buildMenuChunks` now calls too (previously that script had its own inline copy of the exact same template string). One source of truth means a menu item indexed via the initial bulk seed and one indexed later via this live hook always produce identically-formatted content — no risk of the two ever drifting apart if the template is tweaked in the future.

### Verified live, 3 rounds (dev DB, real Gemini API)

1. **Create** — timed the actual call: `createMenuItem()` returned in **292ms**; a `vector_store` check immediately after found **0** rows for the new item (the embedding was still in flight), and after waiting ~6s, exactly 1 correctly-formatted chunk existed. Confirms the fire-and-forget is genuinely non-blocking, not just "awaited but fast."
2. **Update, then soft-delete** — updated the same item's name/price/tags: `vector_store` still had exactly **1** row afterward (not 2 — confirms delete-then-insert prevents duplicates), with content reflecting the *new* values. Then soft-deleted it: the row was removed entirely, while `MenuItem.deletedAt` was set exactly as before this change (unrelated to indexing).
3. **Resilience** — deliberately broke `GEMINI_API_KEY` in `.env`, then ran create → update → soft-delete on a fresh item. All three **succeeded** despite Gemini rejecting every embedding call with `400 API_KEY_INVALID` — each failure was caught and logged (`[vector_store] Failed to re-index menu item ...`), never surfaced to the caller, never rolled back the actual menu mutation. `vector_store` correctly ended up with 0 rows for that item (both the create and update embedding attempts failed, as expected with a broken key). Key restored and reconfirmed working (a real embedding call succeeded again) before cleanup.

All test menu items and their `vector_store` rows were removed after verification; final counts confirmed back to the pre-test baseline (18 menu items, 25 `vector_store` rows).
