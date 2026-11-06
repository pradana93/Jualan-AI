import { ready } from "@/lib/reseller/db.js";
import { requireSessionUser } from "@/lib/reseller/session.js";
import { getKeyRecordById, updateKey, deleteKey, listKeysForUser } from "@/lib/reseller/repos/keysRepo.js";
import { json, jsonError, readJson } from "../../_utils.js";

export const dynamic = "force-dynamic";

async function ownKey(request, id) {
  const { user, error } = await requireSessionUser(request);
  if (error) return { error };
  // Ownership check: a customer may only touch their own keys. Admins may
  // manage any key (useful for support).
  if (user.role !== "admin") {
    const mine = await listKeysForUser(user.id);
    if (!mine.some((k) => k.id === id)) return { error: { status: 404, message: "Key not found" } };
    await ready();
    return { user, key: mine.find((k) => k.id === id) };
  }
  await ready();
  return { user, key: await getKeyRecordById(id) };
}

// PATCH /api/reseller/keys/[id] — rename, revoke/restore, change limits.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const { user, key, error } = await ownKey(request, id);
    if (error) return jsonError(error.message, error.status);
    if (!key) return jsonError("Key not found", 404);

    const body = (await readJson(request)) || {};
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name || "").slice(0, 100);
    if (body.status !== undefined) {
      if (!["active", "revoked"].includes(body.status)) return jsonError("status must be 'active' or 'revoked'");
      patch.status = body.status;
    }
    if (body.allowedModels !== undefined) {
      if (body.allowedModels === null) patch.allowedModels = null;
      else if (!Array.isArray(body.allowedModels)) return jsonError("allowedModels must be an array");
      else patch.allowedModels = body.allowedModels.map((m) => String(m).slice(0, 200));
    }
    if (body.rpmLimit !== undefined) {
      const n = Number(body.rpmLimit);
      if (!Number.isFinite(n) || n < 0 || n > 10000) return jsonError("rpmLimit must be between 0 and 10000");
      patch.rpmLimit = n;
    }

    const updated = await updateKey(id, patch);
    return json({ key: updated });
  } catch (e) {
    console.error("[reseller] key update failed:", e);
    return jsonError("Failed to update key", 500);
  }
}

// DELETE /api/reseller/keys/[id] — permanent delete (revocation is preferred:
// it keeps the usage history attached to a live key row).
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { key, error } = await ownKey(request, id);
    if (error) return jsonError(error.message, error.status);
    if (!key) return jsonError("Key not found", 404);
    const deleted = await deleteKey(id);
    if (!deleted) return jsonError("Key not found", 404);
    return json({ success: true });
  } catch (e) {
    console.error("[reseller] key delete failed:", e);
    return jsonError("Failed to delete key", 500);
  }
}
