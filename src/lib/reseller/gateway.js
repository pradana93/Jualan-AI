// Reseller gateway.
//
// Two jobs:
//   1. gateResellerRequest() — pre-flight: is this `sk-9r-` key valid, is the
//      owner active with balance, is the key under its rate limit, is the model
//      allowed for this key?
//   2. meterResellerCall() — post-call: price the tokens the upstream actually
//      reported and deduct the customer balance atomically.
//
// Metering is driven from usageRepo.saveRequestUsage(), the one choke point every
// modality (chat, responses, embeddings, image, audio) already funnels through,
// so no per-handler plumbing is needed.

import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getResellerConfig } from "./config.js";
import { getActiveKeyByRaw, touchKeyStats } from "./repos/keysRepo.js";
import { resolvePricing, quoteCostCp, quoteUpstreamCostCp } from "./repos/pricingRepo.js";
import { recordUsage } from "./repos/ledgerRepo.js";
import { adjustBalance, recordSpend, getUserById } from "./repos/usersRepo.js";
import { checkRpm } from "./rateLimit.js";

export function isResellerKey(raw, cfg = getResellerConfig()) {
  return !!raw && typeof raw === "string" && raw.startsWith(cfg.keyPrefix);
}

/**
 * Auth-only check (used by src/sse/services/auth.js isValidApiKey, which can
 * only answer true/false). Same rules as the full gate minus rate limiting and
 * model allowlist: key must exist, be active, owner active and funded.
 */
export async function isValidResellerKey(raw) {
  const cfg = getResellerConfig();
  if (!cfg.enabled || !isResellerKey(raw, cfg)) return false;
  try {
    const { ensureResellerSchema } = await import("./db.js");
    await ensureResellerSchema();
    const key = await getActiveKeyByRaw(raw);
    if (!key) return false;
    if (key.status !== "active" || key.owner?.status !== "active") return false;
    return key.owner.balanceCp >= cfg.minBalanceCp;
  } catch (e) {
    console.error("[reseller] key validation failed:", e?.message || e);
    return false;
  }
}

function matchAllowedModel(allowed, requested) {
  if (!allowed || !allowed.length) return true; // unrestricted key
  const req = String(requested || "").toLowerCase();
  const short = req.includes("/") ? req.split("/").slice(1).join("/") : req;
  return allowed.some((pattern) => {
    const p = String(pattern || "").toLowerCase();
    if (!p) return false;
    if (p === "*" || p === req || p === short) return true;
    if (p.endsWith("*")) {
      const head = p.slice(0, -1);
      if (req.startsWith(head) || short.startsWith(head)) return true;
    }
    return false;
  });
}

function errorResult(status, message, extra = {}) {
  return { ok: false, status, error: message, ...extra };
}

/**
 * Pre-flight gate for a customer key.
 * Returns { ok:true, ctx } | { ok:false, status, error } | { ok:"passthrough" }
 * "passthrough" means the key is not a reseller key (or reselling is off) and the
 * caller should continue with stock 9router behaviour.
 */
export async function gateResellerRequest({ request, model, clientRawRequest } = {}) {
  const cfg = getResellerConfig();
  if (!cfg.enabled) return { ok: "passthrough" };

  const raw =
    (typeof request?.headers?.get === "function"
      ? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
        request.headers.get("x-api-key")?.trim()
      : null) ||
    clientRawRequest?.headers?.authorization?.replace(/^Bearer\s+/i, "").trim() ||
    clientRawRequest?.headers?.["x-api-key"] ||
    null;

  if (!isResellerKey(raw, cfg)) return { ok: "passthrough" };

  try {
    const { ensureResellerSchema } = await import("./db.js");
    await ensureResellerSchema();
  } catch (e) {
    console.error("[reseller] schema init failed:", e.message);
    return errorResult(503, "Billing backend unavailable, try again shortly");
  }

  let key;
  try {
    key = await getActiveKeyByRaw(raw);
  } catch (e) {
    console.error("[reseller] key lookup failed:", e.message);
    return errorResult(503, "Billing backend unavailable, try again shortly");
  }
  if (!key) return errorResult(401, "Invalid API key");
  if (key.status !== "active") return errorResult(403, "This API key has been revoked");
  if (key.owner.status !== "active") return errorResult(403, "Account is suspended");
  if (key.owner.balanceCp < cfg.minBalanceCp) {
    return errorResult(402, "Insufficient balance — top up to keep coding");
  }

  // Key-level limit wins; otherwise fall back to the account-level limit.
  const rpm = Number(key.rpmLimit) > 0 ? Number(key.rpmLimit) : await ownerRpmLimit(key.userId, cfg);
  const rl = checkRpm(`reseller:key:${key.id}`, rpm);
  if (!rl.allowed) {
    return errorResult(429, `Rate limit exceeded (${rpm} requests/min)`, { retryAfter: rl.retryAfterSec });
  }

  if (!matchAllowedModel(key.allowedModels, model)) {
    return errorResult(403, `Model not permitted for this key: ${model}`);
  }

  return {
    ok: true,
    ctx: {
      requestId: uuidv4(),
      keyId: key.id,
      userId: key.userId,
      raw,
      requestedModel: model || null,
      endpoint: clientRawRequest?.endpoint || null,
    },
  };
}

async function ownerRpmLimit(userId, cfg) {
  try {
    const user = await getUserById(userId);
    const n = Number(user?.rpmLimit ?? 0);
    return n > 0 ? n : Number(cfg.defaultRpmLimit || 0);
  } catch {
    return Number(cfg.defaultRpmLimit || 0);
  }
}

/**
 * Deterministic id so a replayed usage write can never double-charge, while two
 * genuinely different calls can never collide (which would silently skip a charge).
 *
 * The tuple mirrors the dedup key used by usageRepo.saveRequestUsage()
 * (timestamp, provider, model, connectionId, apiKey, promptTokens,
 * completionTokens), so reseller_usage holds exactly one row per usageHistory
 * row. Timestamp precision is milliseconds: truncating to whole seconds would
 * make two distinct calls inside the same second collide and the second would
 * be dropped by `ON CONFLICT DO NOTHING` — free usage for the customer.
 */
function usageRequestId({ apiKeyHash, provider, model, connectionId, timestamp, prompt, completion }) {
  const ts = timestamp || new Date().toISOString();
  return crypto
    .createHash("sha256")
    .update(
      [
        apiKeyHash,
        provider || "",
        model || "",
        connectionId || "",
        ts,
        prompt,
        completion,
      ].join("|")
    )
    .digest("hex");
}

/**
 * Charge a customer for a completed call. `entry` is the same object
 * saveRequestUsage() receives: { apiKey, provider, model, tokens, endpoint, status }.
 * Never throws — billing must not break the response path.
 */
export async function meterResellerCall(entry) {
  const cfg = getResellerConfig();
  if (!cfg.enabled) return null;
  const raw = entry?.apiKey;
  if (!isResellerKey(raw, cfg)) return null;

  try {
    const { ensureResellerSchema } = await import("./db.js");
    await ensureResellerSchema();

    const key = await getActiveKeyByRaw(raw);
    if (!key) {
      console.warn("[reseller] usage for unknown key, not charged");
      return null;
    }

    const tokens = entry.tokens || {};
    const prompt = Number(tokens.prompt_tokens ?? tokens.input_tokens ?? 0);
    const completion = Number(tokens.completion_tokens ?? tokens.output_tokens ?? 0);
    const cached = Number(tokens.cached_tokens ?? tokens.cache_read_input_tokens ?? 0);

    const pricing = await resolvePricing(entry.provider, entry.model);
    const costCp = quoteCostCp(pricing, { promptTokens: prompt, completionTokens: completion, cachedTokens: cached });
    const upstreamCp = quoteUpstreamCostCp(pricing, { promptTokens: prompt, completionTokens: completion });

    const apiKeyHash = crypto.createHash("sha256").update(String(raw)).digest("hex");
    const requestId = usageRequestId({
      apiKeyHash,
      provider: entry.provider,
      model: entry.model,
      connectionId: entry.connectionId,
      timestamp: entry.timestamp,
      prompt,
      completion,
    });

    const written = await recordUsage({
      requestId,
      userId: key.userId,
      keyId: key.id,
      model: entry.model,
      provider: entry.provider,
      endpoint: entry.endpoint || null,
      promptTokens: prompt,
      completionTokens: completion,
      cachedTokens: cached,
      costCp,
      upstreamCostCp: upstreamCp,
      marginCp: Math.max(costCp - upstreamCp, 0),
      status: entry.status || "ok",
    });

    // written === false → duplicate row, already charged. Never charge twice.
    if (written && costCp > 0) {
      const applied = await adjustBalance(key.userId, -costCp);
      if (applied === null) {
        // Balance raced to zero mid-flight. Keep the ledger row (the call was
        // served) but flag it so the admin can see unpaid usage.
        console.warn(`[reseller] overage: user ${key.userId} unpaid ${costCp} cp`);
      }
      await recordSpend(key.userId, costCp);
      await touchKeyStats(key.id, { costCp });
    }

    return { costCp, upstreamCp, charged: !!written && costCp > 0 };
  } catch (e) {
    console.error("[reseller] metering failed:", e.message);
    return null;
  }
}
