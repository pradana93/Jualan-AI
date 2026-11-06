// Reseller platform configuration.
//
// Money is stored as an integer number of "credit points" (cp).
// 1000 cp = 1 currency unit (USD, IDR, ...). Integer math only — no floats
// ever touch a balance, so rounding can never drift.
//
// cp_per_million = credit points charged per 1,000,000 tokens.
// cost_cp = round(tokens * cp_per_million / 1_000_000)

export const CP_PER_UNIT = 1000;

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true" || String(value) === "1";
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getResellerConfig() {
  return {
    enabled: bool(process.env.RESELLER_ENABLED, true),
    currency: (process.env.RESELLER_CURRENCY || "USD").toUpperCase(),
    currencySymbol: process.env.RESELLER_CURRENCY_SYMBOL || "",
    // Postgres connection string. When set, the reseller store runs on
    // PostgreSQL (Supabase in production). When absent, it falls back to a
    // local SQLite file so the whole platform runs offline during development.
    databaseUrl:
      process.env.RESELLER_DATABASE_URL ||
      process.env.SUPABASE_DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      "",
    sqliteFile: process.env.RESELLER_SQLITE_FILE || "",
    sessionSecret: process.env.RESELLER_SESSION_SECRET || "",
    sessionMaxAgeSec: int(process.env.RESELLER_SESSION_MAX_AGE, 7 * 24 * 60 * 60),
    // Bootstrap admin — created on first schema init if no admin exists.
    adminEmail: (process.env.RESELLER_ADMIN_EMAIL || "").toLowerCase(),
    adminPassword: process.env.RESELLER_ADMIN_PASSWORD || "",
    adminName: process.env.RESELLER_ADMIN_NAME || "Platform Admin",
    // Signup open to the public? Turn off once you want invite-only resellers.
    allowSignup: bool(process.env.RESELLER_ALLOW_SIGNUP, true),
    // Credit points granted on signup (welcome balance).
    signupBonusCp: int(process.env.RESELLER_SIGNUP_BONUS_CP, 0),
    // Default per-user requests-per-minute ceiling. 0 = unlimited.
    defaultRpmLimit: int(process.env.RESELLER_DEFAULT_RPM_LIMIT, 60),
    // Minimum balance (cp) a customer must hold to pass the gateway gate.
    minBalanceCp: int(process.env.RESELLER_MIN_BALANCE_CP, 0),
    // Minimum top-up request (cp) a customer may submit. 0 = no minimum.
    minTopupCp: int(process.env.RESELLER_MIN_TOPUP_CP, 0),
    // Maximum single top-up request (cp). 0 = no maximum.
    maxTopupCp: int(process.env.RESELLER_MAX_TOPUP_CP, 0),
    // Customer key prefix. Keys with this prefix are validated against the
    // reseller store instead of the local 9router apiKeys table.
    keyPrefix: process.env.RESELLER_KEY_PREFIX || "sk-9r-",
  };
}

export function isResellerEnabled() {
  return getResellerConfig().enabled;
}

/** Format cp as a currency string for display. */
export function formatCp(cp, cfg = getResellerConfig()) {
  const units = (Number(cp) || 0) / CP_PER_UNIT;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cfg.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(units);
  } catch {
    return `${units.toFixed(3)} ${cfg.currency}`;
  }
}
