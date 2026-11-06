// Reseller database client.
//
// Two drivers behind one tiny async interface:
//   - PostgreSQL via `postgres` (postgres.js) when a DATABASE_URL is configured
//     → this is the Supabase path used in production.
//   - SQLite via 9router's own adapters, on a separate file, when no URL is set
//     → lets the whole platform run locally without installing Postgres.
//
// All reseller SQL is written with `?` placeholders; the Postgres driver
// rewrites them to $1..$n. Do not put a literal `?` inside SQL strings.

import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";
import { getResellerConfig } from "./config.js";
import { RESELLER_TABLES, RESELLER_INDEXES, splitStatements } from "./schema.js";

if (!globalThis._resellerDb) {
  globalThis._resellerDb = { instance: null, initPromise: null, schemaPromise: null };
}
const state = globalThis._resellerDb;

/** Convert `?` placeholders to Postgres-style $1..$n. */
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function createPostgresAdapter(url) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, {
    // Required when connecting through the Supabase session/transaction pooler
    // (PgBouncer). Also keeps serverless invocations cheap on Vercel.
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: process.env.RESELLER_DB_SSL === "disable" ? false : "require",
    onnotice: () => {},
  });

  const query = async (text, params = []) => {
    const rows = await sql.unsafe(toPgPlaceholders(text), params);
    return Array.isArray(rows) ? rows : [];
  };

  return {
    driver: "postgres",
    all: (text, params = []) => query(text, params),
    get: async (text, params = []) => (await query(text, params))[0] || null,
    run: async (text, params = []) => {
      const rows = await query(text, params);
      return { changes: rows.length, rows };
    },
    exec: async (text) => {
      for (const stmt of splitStatements(text)) await sql.unsafe(stmt);
    },
    raw: sql,
    close: () => sql.end({ timeout: 2 }),
  };
}

async function createSqliteAdapter(file) {
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (!process.versions.bun && (maj > 22 || (maj === 22 && min >= 5))) {
    try {
      const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
      const a = await createNodeSqliteAdapter(file);
      return { driver: a.driver, all: wrap(a.all), get: wrap(a.get), run: wrap(a.run), exec: wrap(a.exec) };
    } catch (e) {
      console.warn(`[reseller-db] node:sqlite unavailable: ${e.message}`);
    }
  }
  if (!process.versions.bun && maj < 24) {
    try {
      const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
      const a = createBetterSqliteAdapter(file);
      return { driver: a.driver, all: wrap(a.all), get: wrap(a.get), run: wrap(a.run), exec: wrap(a.exec) };
    } catch (e) {
      console.warn(`[reseller-db] better-sqlite3 unavailable: ${e.message}`);
    }
  }
  const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
  const a = await createSqlJsAdapter(file);
  return { driver: a.driver, all: wrap(a.all), get: wrap(a.get), run: wrap(a.run), exec: wrap(a.exec) };
}

// Keep the sync sqlite call sites async so repos are driver-agnostic.
function wrap(fn) {
  return (...args) => Promise.resolve(fn(...args));
}

async function init() {
  const cfg = getResellerConfig();
  if (cfg.databaseUrl) {
    const adapter = await createPostgresAdapter(cfg.databaseUrl);
    console.log("[reseller-db] driver: postgres (Supabase)");
    return adapter;
  }
  const fs = await import("node:fs");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = cfg.sqliteFile || path.join(DATA_DIR, "reseller.sqlite");
  const adapter = await createSqliteAdapter(file);
  console.log(`[reseller-db] driver: ${adapter.driver} | file: ${file}`);
  return adapter;
}

export async function getResellerDb() {
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = init().then((a) => {
      state.instance = a;
      return a;
    });
  }
  return state.initPromise;
}

/** Create tables/indexes once per process, then bootstrap the admin account. */
export async function ensureResellerSchema() {
  if (state.schemaPromise) return state.schemaPromise;
  state.schemaPromise = (async () => {
    const db = await getResellerDb();
    for (const ddl of Object.values(RESELLER_TABLES)) {
      for (const stmt of splitStatements(ddl)) await db.exec(stmt);
    }
    for (const stmt of RESELLER_INDEXES) await db.exec(stmt);
    const { ensureBootstrapAdmin } = await import("./repos/usersRepo.js");
    await ensureBootstrapAdmin();
  })().catch((e) => {
    state.schemaPromise = null;
    throw e;
  });
  return state.schemaPromise;
}

/** Convenience wrapper used by the API routes. */
export async function ready() {
  await ensureResellerSchema();
  return getResellerDb();
}
