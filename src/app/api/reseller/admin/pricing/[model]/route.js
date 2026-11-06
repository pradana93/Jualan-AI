import { ready } from "@/lib/reseller/db.js";
import { requireAdmin } from "@/lib/reseller/session.js";
import { deletePricing } from "@/lib/reseller/repos/pricingRepo.js";
import { json, jsonError } from "../../../_utils.js";

export const dynamic = "force-dynamic";

// DELETE /api/reseller/admin/pricing/[model] — remove a model's pricing row.
export async function DELETE(request, { params }) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    const { model } = await params;
    await ready();
    const removed = await deletePricing(decodeURIComponent(model));
    if (!removed) return jsonError("Model not found", 404);
    return json({ success: true });
  } catch (e) {
    console.error("[reseller] admin pricing delete failed:", e);
    return jsonError("Failed to delete pricing", 500);
  }
}
