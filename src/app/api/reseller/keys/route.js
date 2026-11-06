import { ready } from "@/lib/reseller/db.js";
import { requireSessionUser } from "@/lib/reseller/session.js";
import { listKeysForUser, createKeyForUser } from "@/lib/reseller/repos/keysRepo.js";
import { checkRpm } from "@/lib/reseller/rateLimit.js";
import { json, jsonError, readJson } from "../_utils.js";
import { getResellerConfig } from "@/lib/reseller/config.js";

export const dynamic = "force-dynamic";

function rowToPublic(k) {
  return {
    id: k.id,
    name: k.name,
    keyMasked: k.keyMasked,
    status: k.status,
    allowedModels: k.allowedModels,
    rpmLimit: k.rpmLimit,
    requests: k.requests,
    spendCp: k.spendCp,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  };
}

// GET /api/reseller/keys — list my API keys (masked, never raw).
export async function GET(request) {
  try {
    const { user, error } = await requireSessionUser(request);
    if (error) return jsonError(error.message, error.status);
    await ready();
    const keys = await listKeysForUser(user.id);
    return json({ keys: keys.map(rowToPublic) });
  } catch (e) {
    console.error("[reseller] keys list failed:", e);
    return jsonError("Failed to list keys", 500);
  }
}

// POST /api/reseller/keys — mint a new key. The raw secret is returned exactly
// once; only its SHA-256 hash is ever stored.
export async function POST(request) {
  try {
    const { user, error } = await requireSessionUser(request);
    if (error) return jsonError(error.message, error.status);
    if (!checkRpm(`reseller:keys:${user.id}`, 10).allowed) {
      return jsonError("Too many key operations, slow down", 429);
    }
    await ready();

    const body = (await readJson(request)) || {};
    const allowedModels = body.allowedModels === undefined ? undefined : body.allowedModels;
    if (allowedModels !== undefined && allowedModels !== null) {
      if (!Array.isArray(allowedModels)) return jsonError("allowedModels must be an array of model strings");
      if (allowedModels.some((m) => typeof m !== "string" || m.length > 200)) {
        return jsonError("allowedModels contains an invalid entry");
      }
      if (allowedModels.length > 100) return jsonError("allowedModels is limited to 100 entries");
    }
    const rpmLimit = body.rpmLimit === undefined ? undefined : Number(body.rpmLimit);
    if (rpmLimit !== undefined && (!Number.isFinite(rpmLimit) || rpmLimit < 0 || rpmLimit > 10000)) {
      return jsonError("rpmLimit must be between 0 and 10000 (0 = account default)");
    }

    const { raw, record } = await createKeyForUser(user.id, {
      name: String(body.name || "").slice(0, 100),
      allowedModels,
      rpmLimit,
    });
    return json({ key: { ...rowToPublic(record), raw }, status: 201 ? raw : undefined }, 201);
  } catch (e) {
    console.error("[reseller] key create failed:", e);
    return jsonError("Failed to create key", 500);
  }
}
