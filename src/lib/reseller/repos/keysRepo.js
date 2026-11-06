// Customer API keys for the gateway.
//
// Stored format: only a SHA-256 hash of the raw key is persisted, so a
// database dump can never be used to call the API. What you see in the
// dashboard (`keyMasked`) is display-only. The secret is shown exactly once
// at creation time and never again.
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getResellerDb } from "../db.js";
import { getResellerConfig } from "../config.js";

function hashRaw(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

export function generateRawKey(cfg = getResellerConfig()) {
  return `${cfg.keyPrefix}${crypto.randomBytes(24).toString("hex")}`;
}

export function extractCandidateKey(request) {
  const auth = request?.headers?.get?.("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const xApi = request?.headers?.get?.("x-api-key") || "";
  if (xApi) return xApi.trim();
  return null;
}

function parseModels(raw, fallback = null) {
  if (raw === null || raw === undefined) return fallback;
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {}
    return t.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return fallback;
}

function toDbModels(list) {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) return null;
  return JSON.stringify(list);
}

function rowToKey(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    keyMasked: r.key_masked,
    keyPrefixShown: r.key_prefix,
    status: r.status,
    allowedModels: parseModels(r.allowed_models),
    rpmLimit: Number(r.rpm_limit || 0),
    requests: Number(r.requests || 0),
    spendCp: Number(r.spend_cp || 0),
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  };
}

export async function listKeysForUser(userId) {
  const db = await getResellerDb();
  const rows = await db.all(`SELECT * FROM reseller_api_keys WHERE user_id = ? ORDER BY created_at DESC`, [userId]);
  return rows.map(rowToKey);
}

export async function listAllKeys(limit = 1000) {
  const db = await getResellerDb();
  const rows = await db.all(`SELECT * FROM reseller_api_keys ORDER BY created_at DESC LIMIT ?`, [limit]);
  return rows.map(rowToKey);
}

export function maskedFor(keyPrefix, raw) {
  return `${keyPrefix}...${raw.slice(-4)}`;
}

export async function createKeyForUser(userId, { name, allowedModels, rpmLimit } = {}) {
  const db = await getResellerDb();
  const cfg = getResellerConfig();
  const raw = generateRawKey(cfg);
  const now = new Date().toISOString();
  const id = uuidv4();
  await db.run(
    `INSERT INTO reseller_api_keys(id, user_id, name, key_hash, key_prefix, key_masked, status, allowed_models, rpm_limit, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      id,
      userId,
      name || null,
      hashRaw(raw),
      cfg.keyPrefix,
      maskedFor(cfg.keyPrefix, raw),
      toDbModels(allowedModels),
      Number(rpmLimit || 0),
      now,
    ]
  );
  return { raw, record: rowToKey(await db.get(`SELECT * FROM reseller_api_keys WHERE id = ?`, [id])) };
}

export async function getKeyRecordById(id) {
  const db = await getResellerDb();
  return rowToKey(await db.get(`SELECT * FROM reseller_api_keys WHERE id = ?`, [id]));
}

/** Gateway lookup: returns the key row joined to its (active) owner. */
export async function getActiveKeyByRaw(raw) {
  if (!raw) return null;
  const cfg = getResellerConfig();
  if (!raw.startsWith(cfg.keyPrefix)) return null; // not a reseller key
  const db = await getResellerDb();
  const r = await db.get(
    `SELECT k.*, u.status AS owner_status, u.role AS owner_role, u.balance_cp AS owner_balance_cp
       FROM reseller_api_keys k JOIN reseller_users u ON u.id = k.user_id
      WHERE k.key_hash = ?`,
    [hashRaw(raw)]
  );
  if (!r) return null;
  return {
    ...rowToKey(r),
    owner: {
      id: r.user_id,
      status: r.owner_status,
      role: r.owner_role,
      balanceCp: Number(r.owner_balance_cp || 0),
    },
  };
}

export async function updateKey(id, { name, status, allowedModels, rpmLimit }) {
  const db = await getResellerDb();
  const sets = [];
  const params = [];
  if (name !== undefined) {
    sets.push("name = ?");
    params.push(name || null);
  }
  if (status !== undefined) {
    if (!["active", "revoked"].includes(status)) throw new Error("Invalid status");
    sets.push("status = ?");
    params.push(status);
  }
  if (allowedModels !== undefined) {
    sets.push("allowed_models = ?");
    params.push(toDbModels(allowedModels));
  }
  if (rpmLimit !== undefined) {
    sets.push("rpm_limit = ?");
    params.push(Number(rpmLimit));
  }
  if (!sets.length) return getKeyRecordById(id);
  params.push(id);
  await db.run(`UPDATE reseller_api_keys SET ${sets.join(", ")} WHERE id = ?`, params);
  return getKeyRecordById(id);
}

export async function deleteKey(id) {
  const db = await getResellerDb();
  const res = await db.run(`DELETE FROM reseller_api_keys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function touchKeyStats(id, { costCp }) {
  const db = await getResellerDb();
  await db.run(
    `UPDATE reseller_api_keys
        SET requests = requests + 1, spend_cp = spend_cp + ?, last_used_at = ?
      WHERE id = ?`,
    [Number(costCp) || 0, new Date().toISOString(), id]
  );
}
