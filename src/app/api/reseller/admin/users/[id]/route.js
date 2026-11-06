import { ready } from "@/lib/reseller/db.js";
import { requireAdmin } from "@/lib/reseller/session.js";
import { getUserById, updateUser, adjustBalance } from "@/lib/reseller/repos/usersRepo.js";
import { listKeysForUser } from "@/lib/reseller/repos/keysRepo.js";
import { createTransaction } from "@/lib/reseller/repos/ledgerRepo.js";
import { json, jsonError, readJson } from "../../../_utils.js";

export const dynamic = "force-dynamic";

// GET /api/reseller/admin/users/[id] — one customer + their keys.
export async function GET(request, { params }) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    const { id } = await params;
    await ready();

    const user = await getUserById(id);
    if (!user) return jsonError("Customer not found", 404);
    const keys = await listKeysForUser(user.id);
    return json({ user, keys });
  } catch (e) {
    console.error("[reseller] admin user get failed:", e);
    return jsonError("Failed to load customer", 500);
  }
}

// PATCH /api/reseller/admin/users/[id] — update profile, status, rpm, or
// credit/debit the balance. Provide `adjustCp` for a manual grant or clawback.
export async function PATCH(request, { params }) {
  try {
    const { user: admin, error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    const { id } = await params;
    await ready();

    const existing = await getUserById(id);
    if (!existing) return jsonError("Customer not found", 404);

    const body = (await readJson(request)) || {};
    const fields = {};
    if (body.name !== undefined) fields.name = String(body.name).slice(0, 120);
    if (body.status !== undefined) {
      if (!["active", "suspended"].includes(body.status)) return jsonError("Invalid status");
      fields.status = body.status;
    }
    if (body.role !== undefined) {
      if (!["customer", "admin"].includes(body.role)) return jsonError("Invalid role");
      fields.role = body.role;
    }
    if (body.rpmLimit !== undefined) {
      const rpm = Number(body.rpmLimit);
      if (!Number.isFinite(rpm) || rpm < 0 || rpm > 100000) return jsonError("Invalid rpm limit");
      fields.rpmLimit = rpm;
    }
    if (body.note !== undefined) fields.note = String(body.note || "").slice(0, 500);

    let user = await updateUser(id, fields);

    // Manual credit / debit — always booked in the ledger for auditability.
    if (body.adjustCp !== undefined) {
      const delta = Math.round(Number(body.adjustCp));
      if (!Number.isFinite(delta) || delta === 0) return jsonError("adjustCp must be a non-zero integer");
      const newBalance = await adjustBalance(id, delta);
      if (newBalance === null) return jsonError("Insufficient balance for this debit", 400);
      await createTransaction({
        userId: id,
        type: delta > 0 ? "manual_grant" : "adjustment",
        amountCp: delta,
        status: "completed",
        method: "admin",
        note: body.adjustNote ? String(body.adjustNote).slice(0, 500) : "Manual balance adjustment",
        createdBy: admin?.id || "operator",
      });
      user = await getUserById(id);
    }

    return json({ success: true, user });
  } catch (e) {
    console.error("[reseller] admin user update failed:", e);
    return jsonError("Failed to update customer", 500);
  }
}
