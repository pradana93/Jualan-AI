import { ready } from "@/lib/reseller/db.js";
import { requireAdmin } from "@/lib/reseller/session.js";
import { getPlatformSummary, listPendingTopups } from "@/lib/reseller/repos/ledgerRepo.js";
import { countUsers } from "@/lib/reseller/repos/usersRepo.js";
import { listAllKeys } from "@/lib/reseller/repos/keysRepo.js";
import { json, jsonError } from "../../_utils.js";

export const dynamic = "force-dynamic";

// GET /api/reseller/admin/summary — platform-wide revenue/margin snapshot.
export async function GET(request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    await ready();

    const [summary, customers, keys, pending] = await Promise.all([
      getPlatformSummary(),
      countUsers(),
      listAllKeys(5000),
      listPendingTopups(1000),
    ]);

    return json({
      summary,
      customers,
      keys: keys.length,
      activeKeys: keys.filter((k) => k.status === "active").length,
      pendingTopups: pending.length,
    });
  } catch (e) {
    console.error("[reseller] admin summary failed:", e);
    return jsonError("Failed to load summary", 500);
  }
}
