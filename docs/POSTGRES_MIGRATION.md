# Postgres Migration — status

Branch: `postgres-migration`.

## Done ✅
- Postgres 16 stood up (Docker): `docker run -d --name gridsense-pg -e POSTGRES_PASSWORD=gridsense -e POSTGRES_DB=gridsense -p 5433:5432 postgres:16`
- `scripts/migrate_sqlite_to_pg.ts` — introspects SQLite, replicates every table
  in Postgres (type-mapped; INTEGER→NUMERIC because SQLite's loose typing allows
  floats in int columns), copies all rows, adds hot-path indexes, verifies counts.
- **Verified: 33 tables, 116,069 rows, 0 mismatches.**

Run it:
```
DATABASE_URL=postgres://postgres:gridsense@localhost:5433/gridsense \
  npx tsx scripts/migrate_sqlite_to_pg.ts
```

## Remaining — the runtime driver flip
The app still reads SQLite. Flipping it is a **sync → async refactor across ~222
`better-sqlite3` call sites** (`sqlite.prepare(sql).get/all/run()` →
`await pool.query(sql, params)`), plus SQL-dialect fixes (`?`→`$1`,
`INSERT OR REPLACE`, `date('now')`, `AUTOINCREMENT`→`GENERATED`). Most callers
(storage methods, route handlers, ingest fns) are already `async`, which limits
the signature cascade — but it's still a large, must-be-fully-tested change, so
it lives on this branch, not `master`.

Order to convert: `storage.ts` (bootstrap + IStorage) → `auth.ts` / `apikeys.ts`
schema bootstrap → `routes.ts` raw queries → ingest modules. Swap `drizzle-orm/
better-sqlite3` for `drizzle-orm/node-postgres`. Keep the 53 tests green through it.
