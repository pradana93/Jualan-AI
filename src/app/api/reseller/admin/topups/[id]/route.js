import { ready } from "@/lib/reseller/db.js";
import { requireAdmin } from "@/lib/reseller/session.js";
import { completeTopup, rejectTopup } from "@/lib/reseller/repos/ledgerRepo.js";
import { json, jsonError, readJson } from "../../../_utils.js";

export const dynamic = "force-dynamic";

// POST /api/reseller/admin/topups/[id]/approve — approve top-up.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    await ready();

    const result = await completeTopup(id, user.id);
    return json({ success: true, credited: result.credited, tx: result.transaction });
  } catch (e) {
    console.error("[reseller] topup approve failed:", e);
    return jsonError(e.message || "Failed to approve top-up", e.statusCode || 500);
  }
}

// DELETE /api/reseller/admin/topups/[id] — reject top-up.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    await ready();

    const body = await readJson(request);
    const tx = await rejectTopup(id, user.id, body?.reason);
    return json({ success: true, tx });
  } catch (e) {
    console.error("[reseller] topup reject failed:", e);
    return jsonError("Failed to reject top-up", 500);
  }
}
