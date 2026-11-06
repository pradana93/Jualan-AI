import { ready } from "@/lib/reseller/db.js";
import { requireSessionUser } from "@/lib/reseller/session.js";
import { getUsageForUser, getUsageSummary, listTransactionsForUser } from "@/lib/reseller/repos/ledgerRepo.js";
import { json, jsonError } from "../_utils.js";

export const dynamic = "force-dynamic";

// GET /api/reseller/usage — my metered calls, summary and ledger.
export async function GET(request) {
  try {
    const { user, error } = await requireSessionUser(request);
    if (error) return jsonError(error.message, error.status);
    await ready();

    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);

    const [usage, summary, transactions] = await Promise.all([
      getUsageForUser(user.id, limit),
      getUsageSummary(user.id),
      listTransactionsForUser(user.id, 100),
    ]);

    return json({
      summary,
      usage: usage.map((u) => ({
        id: u.id,
        requestId: u.request_id ? `${String(u.request_id).slice(0, 12)}…` : null,
        keyId: u.key_id,
        model: u.model,
        provider: u.provider,
        endpoint: u.endpoint,
        promptTokens: Number(u.prompt_tokens || 0),
        completionTokens: Number(u.completion_tokens || 0),
        cachedTokens: Number(u.cached_tokens || 0),
        costCp: Number(u.cost_cp || 0),
        status: u.status,
        createdAt: u.created_at,
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amountCp: Number(t.amount_cp || 0),
        status: t.status,
        method: t.method,
        note: t.note,
        adminNote: t.admin_note,
        createdAt: t.created_at,
      })),
    });
  } catch (e) {
    console.error("[reseller] usage fetch failed:", e);
    return jsonError("Failed to load usage", 500);
  }
}
