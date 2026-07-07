/**
 * SQLite -> Postgres data migration.
 *
 * Introspects the SQLite schema (all tables + columns + primary keys),
 * replicates each table in Postgres with mapped column types, copies every
 * row, adds the hot-path indexes, and verifies row counts match.
 *
 *   DATABASE_URL=postgres://postgres:gridsense@localhost:5433/gridsense \
 *     npx tsx scripts/migrate_sqlite_to_pg.ts
 */
import Database from "better-sqlite3";
import pg from "pg";

const PG_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:gridsense@localhost:5433/gridsense";

function pgType(sqliteType: string): string {
  const t = (sqliteType || "").toUpperCase();
  // NUMERIC (not BIGINT) because SQLite's dynamic typing lets an INTEGER-declared
  // column hold a float (e.g. weight = 0.5).
  if (t.includes("INT")) return "NUMERIC";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "DOUBLE PRECISION";
  if (t.includes("BLOB")) return "BYTEA";
  return "TEXT"; // TEXT, and SQLite's dynamic typing default
}

async function main() {
  const sqlite = new Database("data.db", { readonly: true });
  const pool = new pg.Pool({ connectionString: PG_URL });
  const client = await pool.connect();

  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];

  const summary: Array<{ table: string; sqlite: number; pg: number; ok: boolean }> = [];

  for (const { name } of tables) {
    const cols = sqlite.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
      name: string; type: string; notnull: number; pk: number;
    }>;
    if (!cols.length) continue;

    const colDefs = cols.map((c) => `"${c.name}" ${pgType(c.type)}`);
    const pks = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => `"${c.name}"`);
    const pkClause = pks.length ? `, PRIMARY KEY (${pks.join(", ")})` : "";

    await client.query(`DROP TABLE IF EXISTS "${name}" CASCADE`);
    await client.query(`CREATE TABLE "${name}" (${colDefs.join(", ")}${pkClause})`);

    const rows = sqlite.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
    const colNames = cols.map((c) => c.name);
    if (rows.length) {
      const quoted = colNames.map((c) => `"${c}"`).join(", ");
      // Batch inserts (multi-row VALUES) for speed.
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const params: unknown[] = [];
        const valueClauses = batch.map((r) => {
          const ph = colNames.map((c) => {
            params.push(r[c] ?? null);
            return `$${params.length}`;
          });
          return `(${ph.join(", ")})`;
        });
        await client.query(`INSERT INTO "${name}" (${quoted}) VALUES ${valueClauses.join(", ")}`, params);
      }
    }

    const pgCount = Number((await client.query(`SELECT COUNT(*)::int AS n FROM "${name}"`)).rows[0].n);
    summary.push({ table: name, sqlite: rows.length, pg: pgCount, ok: rows.length === pgCount });
  }

  // Hot-path indexes called out in the roadmap.
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_counties_state ON counties(state)`,
    `CREATE INDEX IF NOT EXISTS idx_counties_tier ON counties(score_tier)`,
    `CREATE INDEX IF NOT EXISTS idx_signals_fips ON signals(county_fips)`,
    `CREATE INDEX IF NOT EXISTS idx_permits_fips ON permits(county_fips)`,
    `CREATE INDEX IF NOT EXISTS idx_score_history_fips ON score_history(fips)`,
  ];
  for (const ix of indexes) { try { await client.query(ix); } catch (e) { /* table may lack column */ } }

  client.release();
  await pool.end();
  sqlite.close();

  const bad = summary.filter((s) => !s.ok);
  console.table(summary);
  console.log(`\n${summary.length} tables migrated · ${summary.reduce((a, s) => a + s.pg, 0)} rows · ${bad.length} mismatches`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
