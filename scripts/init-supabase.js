// Supabase schema init + admin bootstrap.
// Run: node scripts/init-supabase.js
// Requires RESELLER_DATABASE_URL.
// Imports the reseller schema directly (no @/ alias) and runs it against Postgres.
import postgres from "postgres";
import { RESELLER_TABLES, RESELLER_INDEXES } from "../src/lib/reseller/schema.js";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

function splitStatements(sql) {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const url = process.env.RESELLER_DATABASE_URL;
  if (!url) {
    console.error("[init] RESELLER_DATABASE_URL not set");
    process.exit(1);
  }

  const sql = postgres(url, {
    prepare: false,
    max: 5,
    connect_timeout: 15,
    idle_timeout: 20,
    ssl: "require",
    onnotice: () => {},
  });

  try {
    console.log("[init] connected to Supabase Postgres");

    // 1. Tables
    for (const [name, ddl] of Object.entries(RESELLER_TABLES)) {
      for (const stmt of splitStatements(ddl)) {
        await sql.unsafe(stmt);
      }
      console.log(`[init] table ensured: ${name}`);
    }

    // 2. Indexes
    for (const stmt of RESELLER_INDEXES) {
      await sql.unsafe(stmt);
    }
    console.log("[init] indexes ensured");

    // 3. Bootstrap admin
    const email = (process.env.RESELLER_ADMIN_EMAIL || "").toLowerCase();
    const password = process.env.RESELLER_ADMIN_PASSWORD;
    const name = process.env.RESELLER_ADMIN_NAME || "Platform Administrator";
    if (!email) throw new Error("RESELLER_ADMIN_EMAIL is required");
    if (!password) throw new Error("RESELLER_ADMIN_PASSWORD is required");
    // Use transaction pooler for INSERTs and SELECTs
    const existing = await sql.unsafe("SELECT id, role FROM reseller_users WHERE email = $1", [email]).then((r) => r[0] || null);

    if (existing) {
      console.log(`[init] admin exists: ${existing.id} (role=${existing.role})`);
    } else {
      const id = crypto.randomUUID();
      const hash = await bcrypt.hash(password, 12);
      const now = new Date().toISOString();
      // Use transaction pooler for INSERTs and SELECTs
      await sql.unsafe(
        `INSERT INTO reseller_users
           (id, email, name, password_hash, role, status, balance_cp, total_spent_cp, rpm_limit, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'admin', 'active', 0, 0, 0, $5, $5)`,
        [id, email, name, hash, now]
      );
      console.log(`[init] admin created: ${id} (${email})`);
    }

    // 4. Quick sanity query
    const count = await sql.unsafe("SELECT COUNT(*) AS n FROM reseller_users").then((r) => Number(r[0]?.n || 0));
    console.log(`[init] reseller_users count = ${count}`);
    console.log("[init] DONE");
  } catch (e) {
    console.error("[init] FAILED:", e.message);
    if (e.stack) console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main();