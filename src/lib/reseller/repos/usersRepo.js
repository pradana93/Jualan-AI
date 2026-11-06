import { v4 as uuidv4 } from "uuid";
import { getResellerDb } from "../db.js";
import { getResellerConfig } from "../config.js";

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    balanceCp: Number(r.balance_cp || 0),
    totalSpentCp: Number(r.total_spent_cp || 0),
    rpmLimit: Number(r.rpm_limit || 0),
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getUserById(id) {
  const db = await getResellerDb();
  return rowToUser(await db.get(`SELECT * FROM reseller_users WHERE id = ?`, [id]));
}

export async function getUserByEmail(email) {
  const db = await getResellerDb();
  return rowToUser(await db.get(`SELECT * FROM reseller_users WHERE email = ?`, [String(email).toLowerCase()]));
}

/** Auth lookup — includes the password hash (never exposed by getUserByEmail). */
export async function getUserAuthByEmail(email) {
  const db = await getResellerDb();
  const row = await db.get(`SELECT * FROM reseller_users WHERE email = ?`, [String(email).toLowerCase()]);
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
}

export async function listUsers(limit = 500) {
  const db = await getResellerDb();
  const rows = await db.all(`SELECT * FROM reseller_users ORDER BY created_at DESC LIMIT ?`, [limit]);
  return rows.map(rowToUser);
}

export async function createUser({ email, name, passwordHash, role = "customer", balanceCp = 0, note }) {
  const db = await getResellerDb();
  const now = new Date().toISOString();
  const id = uuidv4();
  const cfg = getResellerConfig();
  await db.run(
    `INSERT INTO reseller_users(id, email, name, password_hash, role, status, balance_cp, rpm_limit, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [
      id,
      String(email).toLowerCase(),
      name || null,
      passwordHash,
      role,
      Number(balanceCp),
      cfg.defaultRpmLimit,
      note || null,
      now,
      now,
    ]
  );
  return getUserById(id);
}

export async function updateUser(id, fields) {
  const db = await getResellerDb();
  const map = {
    email: "email",
    name: "name",
    role: "role",
    status: "status",
    note: "note",
    rpmLimit: "rpm_limit",
    passwordHash: "password_hash",
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(k === "rpmLimit" ? Number(fields[k]) : fields[k]);
    }
  }
  if (!sets.length) return getUserById(id);
  sets.push(`updated_at = ?`);
  params.push(new Date().toISOString());
  params.push(id);
  await db.run(`UPDATE reseller_users SET ${sets.join(", ")} WHERE id = ?`, params);
  return getUserById(id);
}

/**
 * Atomically adjust a user's balance. Negative deltas only apply when the
 * balance covers them, making double-spend impossible at the SQL level.
 * Returns the new balance (cp) or null when funds were insufficient.
 */
export async function adjustBalance(id, deltaCp) {
  const db = await getResellerDb();
  const row = await db.get(
    `UPDATE reseller_users
        SET balance_cp = balance_cp + ?, updated_at = ?
      WHERE id = ? AND balance_cp + ? >= 0
      RETURNING balance_cp`,
    [Number(deltaCp), new Date().toISOString(), id, Number(deltaCp)]
  );
  if (!row) return null;
  return Number(row.balance_cp);
}

export async function recordSpend(id, spendCp) {
  const db = await getResellerDb();
  await db.run(
    `UPDATE reseller_users SET total_spent_cp = total_spent_cp + ?, updated_at = ? WHERE id = ?`,
    [Number(spendCp), new Date().toISOString(), id]
  );
}

/** Bootstrap the platform admin from env on first run. Idempotent. */
export async function ensureBootstrapAdmin() {
  const cfg = getResellerConfig();
  if (!cfg.adminEmail || !cfg.adminPassword) return null;
  const db = await getResellerDb();
  const existing = await db.get(`SELECT id FROM reseller_users WHERE role = 'admin' OR email = ?`, [cfg.adminEmail]);
  if (existing) return null;
  const { hashPassword } = await import("../passwords.js");
  const user = await createUser({
    email: cfg.adminEmail,
    name: cfg.adminName,
    passwordHash: await hashPassword(cfg.adminPassword),
    role: "admin",
    note: "Bootstrapped from RESELLER_ADMIN_EMAIL/PASSWORD",
  });
  console.log(`[reseller] bootstrap admin created: ${user.email}`);
  return user;
}

export async function countUsers() {
  const db = await getResellerDb();
  const row = await db.get(`SELECT COUNT(*) AS n FROM reseller_users`);
  return Number(row?.n || 0);
}
