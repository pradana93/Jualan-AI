// Reseller schema — written to run unchanged on SQLite (local dev) and
// PostgreSQL (Supabase, production).
//
// Rules that keep the DDL portable:
//   - TEXT ids (uuid generated in app code), never auto-increment.
//   - TEXT timestamps (ISO-8601), never DATE/TIMESTAMPTZ.
//   - INTEGER booleans (0/1), never BOOLEAN.
//   - BIGINT money (credit points), never NUMERIC/DOUBLE.
//   - JSON payloads stored as TEXT, never JSONB.
//
// Table names are prefixed `reseller_` so the schema can live in the same
// PostgreSQL database as Supabase Auth without colliding.

export const RESELLER_TABLES = {
  reseller_users: `
    CREATE TABLE IF NOT EXISTS reseller_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      status TEXT NOT NULL DEFAULT 'active',
      balance_cp BIGINT NOT NULL DEFAULT 0,
      total_spent_cp BIGINT NOT NULL DEFAULT 0,
      rpm_limit INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  reseller_api_keys: `
    CREATE TABLE IF NOT EXISTS reseller_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      key_masked TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      allowed_models TEXT,
      rpm_limit INTEGER NOT NULL DEFAULT 0,
      requests BIGINT NOT NULL DEFAULT 0,
      spend_cp BIGINT NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES reseller_users(id)
    )
  `,
  reseller_pricing: `
    CREATE TABLE IF NOT EXISTS reseller_pricing (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL UNIQUE,
      display_name TEXT,
      input_cp_per_m BIGINT NOT NULL DEFAULT 0,
      output_cp_per_m BIGINT NOT NULL DEFAULT 0,
      cached_input_cp_per_m BIGINT NOT NULL DEFAULT 0,
      upstream_input_cp_per_m BIGINT NOT NULL DEFAULT 0,
      upstream_output_cp_per_m BIGINT NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100,
      updated_at TEXT NOT NULL
    )
  `,
  reseller_usage: `
    CREATE TABLE IF NOT EXISTS reseller_usage (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      key_id TEXT,
      model TEXT,
      provider TEXT,
      endpoint TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      cost_cp BIGINT NOT NULL DEFAULT 0,
      upstream_cost_cp BIGINT NOT NULL DEFAULT 0,
      margin_cp BIGINT NOT NULL DEFAULT 0,
      status TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES reseller_users(id)
    )
  `,
  reseller_transactions: `
    CREATE TABLE IF NOT EXISTS reseller_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_cp BIGINT NOT NULL DEFAULT 0,
      balance_after_cp BIGINT,
      status TEXT NOT NULL DEFAULT 'pending',
      reference TEXT,
      method TEXT,
      note TEXT,
      admin_note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES reseller_users(id)
    )
  `,
};

// Indexes kept separate so they can run after the tables exist.
export const RESELLER_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_reseller_keys_user ON reseller_api_keys(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_reseller_usage_user ON reseller_usage(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_reseller_usage_created ON reseller_usage(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_reseller_tx_user ON reseller_transactions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_reseller_tx_status ON reseller_transactions(status)",
];

/**
 * Split a DDL script into individual statements.
 * Our DDL contains no string literals with semicolons, so a plain split is safe.
 */
export function splitStatements(sql) {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
