import { ready } from "@/lib/reseller/db.js";
import { requireAdmin } from "@/lib/reseller/session.js";
import { listPendingTopups, completeTopup, rejectTopup } from "@/lib/reseller/repos/ledgerRepo.js";
import { json, jsonError, readJson } from "../../_utils.js";

export const dynamic = "force-dynamic";

// GET /api/reseller/admin/topups — list pending requests.
export async function GET(request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    await ready();
    const topups = await listPendingTopups();
    return json({ topups });
  } catch (e) {
    console.error("[reseller] admin topups list failed:", e);
    return jsonError("Failed to list topups", 500);
  }
}
