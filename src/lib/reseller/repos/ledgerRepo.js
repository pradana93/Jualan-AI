// Ledger — usage records and top-up transactions.
import { v4 as uuidv4 } from "uuid";
import { getResellerDb } from "../db.js";

/**
 * Insert a usage row. Returns true when a new row was written, false when the
 * request_id already existed (replay) — the caller must not charge twice.
 * `ON CONFLICT DO NOTHING ... RETURNING` behaves identically on SQLite and
 * PostgreSQL, so one statement covers both drivers.
 */
export async function recordUsage(usage) {
  const db = await getResellerDb();
  const rows = await db.all(
    `INSERT INTO reseller_usage(id, request_id, user_id, key_id, model, provider, endpoint, prompt_tokens, completion_tokens, cached_tokens, cost_cp, upstream_cost_cp, margin_cp, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(request_id) DO NOTHING
     RETURNING id`,
    [
      uuidv4(),
      usage.requestId,
      usage.userId,
      usage.keyId || null,
      usage.model || null,
      usage.provider || null,
      usage.endpoint || null,
      Number(usage.promptTokens) || 0,
      Number(usage.completionTokens) || 0,
      Number(usage.cachedTokens) || 0,
      Number(usage.costCp) || 0,
      Number(usage.upstreamCostCp) || 0,
      Number(usage.marginCp) || 0,
      usage.status || "ok",
      new Date().toISOString(),
    ]
  );
  return rows.length > 0;
}

export async function getUsageForUser(userId, limit = 200) {
  const db = await getResellerDb();
  return db.all(`SELECT * FROM reseller_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]);
}

export async function getUsageSummary(userId) {
  const db = await getResellerDb();
  const row = await db.get(
    `SELECT COUNT(*) AS requests, COALESCE(SUM(cost_cp), 0) AS spend_cp,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens
       FROM reseller_usage WHERE user_id = ?`,
    [userId]
  );
  return {
    requests: Number(row?.requests || 0),
    spendCp: Number(row?.spend_cp || 0),
    promptTokens: Number(row?.prompt_tokens || 0),
    completionTokens: Number(row?.completion_tokens || 0),
  };
}

export async function getPlatformSummary() {
  const db = await getResellerDb();
  const usage = await db.get(
    `SELECT COUNT(*) AS requests, COALESCE(SUM(cost_cp), 0) AS revenue_cp,
            COALESCE(SUM(upstream_cost_cp), 0) AS upstream_cp,
            COALESCE(SUM(margin_cp), 0) AS margin_cp FROM reseller_usage`
  );
  const tx = await db.get(
    `SELECT COALESCE(SUM(amount_cp), 0) AS topped FROM reseller_transactions WHERE type IN ('topup', 'manual_grant', 'signup_bonus') AND status = 'completed'`
  );
  return {
    requests: Number(usage?.requests || 0),
    revenueCp: Number(usage?.revenue_cp || 0),
    upstreamCp: Number(usage?.upstream_cp || 0),
    marginCp: Number(usage?.margin_cp || 0),
    toppedUpCp: Number(tx?.topped || 0),
  };
}

// ---------------------------------------------------------------- transactions

export async function createTransaction({ userId, type, amountCp, reference, method, note, adminNote, createdBy, status = "completed" }) {
  const db = await getResellerDb();
  const now = new Date().toISOString();
  const id = uuidv4();
  await db.run(
    `INSERT INTO reseller_transactions(id, user_id, type, amount_cp, status, reference, method, note, admin_note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, userId, type, Number(amountCp) || 0, status,
      reference || `tx-${id.slice(0, 8)}`, method || null, note || null,
      adminNote || null, createdBy || null, now, now,
    ]
  );
  return db.get(`SELECT * FROM reseller_transactions WHERE id = ?`, [id]);
}

export async function listTransactionsForUser(userId, limit = 200) {
  const db = await getResellerDb();
  return db.all(`SELECT * FROM reseller_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]);
}

export async function listPendingTopups(limit = 200) {
  const db = await getResellerDb();
  return db.all(
    `SELECT t.*, u.email AS user_email FROM reseller_transactions t
       JOIN reseller_users u ON u.id = t.user_id
      WHERE t.status = 'pending' AND t.type = 'topup'
      ORDER BY t.created_at ASC LIMIT ?`,
    [limit]
  );
}

export async function getTransactionById(id) {
  const db = await getResellerDb();
  return db.get(`SELECT * FROM reseller_transactions WHERE id = ?`, [id]);
}

/**
 * Complete a top-up: credit the user (atomic), mark completed.
 * Idempotent — a second call for the same tx returns the current row.
 * The status flip happens FIRST and is the gate: only the caller that actually
 * moves pending → completed credits the balance, so two admins clicking
 * "approve" at the same time can never double-credit.
 * Returns { transaction, credited }.
 */
export async function completeTopup(id, adminId) {
  const db = await getResellerDb();
  const tx = await getTransactionById(id);
  if (!tx) throw Object.assign(new Error("Transaction not found"), { statusCode: 404 });
  if (tx.status === "completed") return { transaction: tx, credited: false };

  const flipped = await db.all(
    `UPDATE reseller_transactions
        SET status = 'completed', created_by = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
      RETURNING id`,
    [adminId || null, new Date().toISOString(), id]
  );
  if (!flipped.length) return { transaction: await getTransactionById(id), credited: false };

  const { adjustBalance } = await import("./usersRepo.js");
  const newBalance = await adjustBalance(tx.user_id, Number(tx.amount_cp));
  if (newBalance === null) throw new Error("Balance update failed");
  await db.run(`UPDATE reseller_transactions SET balance_after_cp = ? WHERE id = ?`, [newBalance, id]);
  return { transaction: await getTransactionById(id), credited: true };
}

export async function rejectTopup(id, adminId, reason) {
  const db = await getResellerDb();
  await db.run(
    `UPDATE reseller_transactions SET status = 'failed', admin_note = ?, created_by = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
    [reason || "Rejected", adminId || null, new Date().toISOString(), id]
  );
  return getTransactionById(id);
}
