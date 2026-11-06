// Per-model sell pricing. `input_cp_per_m` = credit points charged per
// 1,000,000 input tokens (same for output / cached input). `upstream_*`
// columns record what the call actually cost you, so margin = sell − cost is
// visible on every request.
import { v4 as uuidv4 } from "uuid";
import { getResellerDb } from "../db.js";

function rowToPricing(r) {
  if (!r) return null;
  return {
    id: r.id,
    model: r.model,
    displayName: r.display_name,
    inputCpPerM: Number(r.input_cp_per_m || 0),
    outputCpPerM: Number(r.output_cp_per_m || 0),
    cachedInputCpPerM: Number(r.cached_input_cp_per_m || 0),
    upstreamInputCpPerM: Number(r.upstream_input_cp_per_m || 0),
    upstreamOutputCpPerM: Number(r.upstream_output_cp_per_m || 0),
    enabled: Number(r.enabled) === 1,
    sortOrder: Number(r.sort_order ?? 100),
    updatedAt: r.updated_at,
  };
}

function toInt(value, def = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : def;
}

export async function listPricing({ onlyEnabled = false } = {}) {
  const db = await getResellerDb();
  const rows = await db.all(
    onlyEnabled
      ? `SELECT * FROM reseller_pricing WHERE enabled = 1 ORDER BY sort_order ASC, model ASC`
      : `SELECT * FROM reseller_pricing ORDER BY sort_order ASC, model ASC`
  );
  return rows.map(rowToPricing);
}

async function getRow(modelKey) {
  const db = await getResellerDb();
  const r = await db.get(`SELECT * FROM reseller_pricing WHERE model = ? AND enabled = 1`, [String(modelKey).toLowerCase()]);
  return rowToPricing(r);
}

export async function getPricing(model) {
  if (!model) return await getRow("*");
  const exact = await getRow(model);
  if (exact) return exact;
  // Bare model name without the provider prefix (clients may send either form).
  if (String(model).includes("/")) {
    const bare = await getRow(String(model).split("/").slice(1).join("/"));
    if (bare) return bare;
  }
  return await getRow("*");
}

/**
 * Resolve the sell price for a routed call.
 * Upstream reports `provider` + resolved `model`; the customer was quoted for
 * what they asked for, so try every reasonable key before the catch-all row.
 * Order: provider/model → model → provider/* → bare provider/* → '*'.
 */
export async function resolvePricing(provider, model) {
  const p = String(provider || "").toLowerCase();
  const m = String(model || "").toLowerCase();
  const bare = m.includes("/") ? m.split("/").slice(1).join("/") : m;

  const candidates = [];
  if (p && m) candidates.push(`${p}/${m}`);
  if (m) candidates.push(m, bare);
  if (p) candidates.push(`${p}/*`);
  if (m.includes("/")) candidates.push(`${m.split("/")[0]}/*`);
  candidates.push("*");

  for (const key of candidates) {
    const row = await getRow(key);
    if (row) return row;
  }
  return null;
}

export async function upsertPricing(model, data = {}) {
  if (!model || !String(model).trim()) throw new Error("model is required");
  const db = await getResellerDb();
  const key = String(model).toLowerCase().trim();
  const existing = await db.get(`SELECT id FROM reseller_pricing WHERE model = ?`, [key]);
  const now = new Date().toISOString();
  if (existing) {
    const sets = [];
    const params = [];
    const fields = {
      displayName: "display_name",
      inputCpPerM: "input_cp_per_m",
      outputCpPerM: "output_cp_per_m",
      cachedInputCpPerM: "cached_input_cp_per_m",
      upstreamInputCpPerM: "upstream_input_cp_per_m",
      upstreamOutputCpPerM: "upstream_output_cp_per_m",
      sortOrder: "sort_order",
    };
    for (const [k, col] of Object.entries(fields)) {
      if (data[k] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(k === "sortOrder" ? toInt(data[k], 100) : toInt(data[k]));
      }
    }
    if (data.enabled !== undefined) {
      sets.push(`enabled = ?`);
      params.push(data.enabled ? 1 : 0);
    }
    sets.push(`updated_at = ?`);
    params.push(now);
    params.push(key);
    await db.run(`UPDATE reseller_pricing SET ${sets.join(", ")} WHERE model = ?`, params);
    return rowToPricing(await db.get(`SELECT * FROM reseller_pricing WHERE model = ?`, [key]));
  }
  const id = uuidv4();
  await db.run(
    `INSERT INTO reseller_pricing(id, model, display_name, input_cp_per_m, output_cp_per_m, cached_input_cp_per_m, upstream_input_cp_per_m, upstream_output_cp_per_m, enabled, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      key,
      data.displayName || null,
      toInt(data.inputCpPerM),
      toInt(data.outputCpPerM),
      toInt(data.cachedInputCpPerM),
      toInt(data.upstreamInputCpPerM),
      toInt(data.upstreamOutputCpPerM),
      data.enabled === false ? 0 : 1,
      toInt(data.sortOrder, 100),
      now,
    ]
  );
  return rowToPricing(await db.get(`SELECT * FROM reseller_pricing WHERE id = ?`, [id]));
}

export async function deletePricing(model) {
  const db = await getResellerDb();
  const res = await db.run(`DELETE FROM reseller_pricing WHERE model = ?`, [String(model).toLowerCase().trim()]);
  return (res?.changes ?? 0) > 0;
}

/** charge = ceil(tokens_in * in_perM / 1e6) + ceil(tokens_out * out_perM / 1e6). */
export function quoteCostCp(pricing, { promptTokens = 0, completionTokens = 0, cachedTokens = 0 }) {
  if (!pricing) return 0;
  const inRate = Number(pricing.inputCpPerM || 0);
  const outRate = Number(pricing.outputCpPerM || 0);
  const cacheRate = pricing.cachedInputCpPerM > 0 ? Number(pricing.cachedInputCpPerM) : inRate;
  const cached = Math.min(Number(cachedTokens) || 0, Number(promptTokens) || 0);
  const fresh = Math.max((Number(promptTokens) || 0) - cached, 0);
  const inCp = Math.ceil((fresh * inRate + cached * cacheRate) / 1_000_000);
  const outCp = Math.ceil(((Number(completionTokens) || 0) * outRate) / 1_000_000);
  return inCp + outCp;
}

/** Your actual spend on the upstream call — same math, upstream rates. */
export function quoteUpstreamCostCp(pricing, { promptTokens = 0, completionTokens = 0 }) {
  if (!pricing) return 0;
  const inCp = Math.ceil(((Number(promptTokens) || 0) * Number(pricing.upstreamInputCpPerM || 0)) / 1_000_000);
  const outCp = Math.ceil(((Number(completionTokens) || 0) * Number(pricing.upstreamOutputCpPerM || 0)) / 1_000_000);
  return inCp + outCp;
}

export { rowToPricing };
