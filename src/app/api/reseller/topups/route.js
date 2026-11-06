import { ready } from "@/lib/reseller/db.js";
import { requireSessionUser } from "@/lib/reseller/session.js";
import { getResellerConfig } from "@/lib/reseller/config.js";
import { createTransaction, listTransactionsForUser } from "@/lib/reseller/repos/ledgerRepo.js";
import { checkRpm } from "@/lib/reseller/rateLimit.js";
import { json, jsonError, readJson } from "../_utils.js";

export const dynamic = "force-dynamic";

// GET /api/reseller/topups — my top-up history (pending + completed).
export async function GET(request) {
  try {
    const { user, error } = await requireSessionUser(request);
    if (error) return jsonError(error.message, error.status);
    await ready();

    const txs = await listTransactionsForUser(user.id, 100);
    const topups = txs
      .filter((t) => t.type === "topup" || t.type === "manual_grant")
      .map((t) => ({
        id: t.id,
        type: t.type,
        amountCp: Number(t.amount_cp || 0),
        status: t.status,
        method: t.method,
        reference: t.reference,
        note: t.note,
        adminNote: t.admin_note,
        createdAt: t.created_at,
      }));
    return json({ topups });
  } catch (e) {
    console.error("[reseller] topup list failed:", e);
    return jsonError("Failed to list top-ups", 500);
  }
}

// POST /api/reseller/topups — customer submits a credit top-up request.
// Creates a *pending* transaction; an admin must approve it at
// /api/reseller/admin/topups/[id] before the balance is credited.
export async function POST(request) {
  try {
    const { user, error } = await requireSessionUser(request);
    if (error) return jsonError(error.message, error.status);
    if (!checkRpm(`reseller:topup:${user.id}`, 5).allowed) {
      return jsonError("Too many top-up requests, slow down", 429);
    }
    await ready();

    const cfg = getResellerConfig();
    const body = (await readJson(request)) || {};

    const amountCp = Math.round(Number(body.amountCp));
    if (!Number.isFinite(amountCp) || amountCp <= 0) {
      return jsonError("Enter a valid top-up amount");
    }
    if (cfg.minTopupCp > 0 && amountCp < cfg.minTopupCp) {
      return jsonError(`Minimum top-up is ${cfg.minTopupCp} credit points`);
    }
    if (cfg.maxTopupCp > 0 && amountCp > cfg.maxTopupCp) {
      return jsonError(`Maximum top-up is ${cfg.maxTopupCp} credit points`);
    }

    const method = String(body.method || "manual").slice(0, 40);
    const reference = String(body.reference || "").slice(0, 120);
    const note = String(body.note || "").slice(0, 500);

    const tx = await createTransaction({
      userId: user.id,
      type: "topup",
      amountCp,
      status: "pending",
      method,
      reference: reference || undefined,
      note: note || null,
    });

    return json(
      {
        success: true,
        topup: {
          id: tx.id,
          amountCp: Number(tx.amount_cp || 0),
          status: tx.status,
          method: tx.method,
          reference: tx.reference,
          createdAt: tx.created_at,
        },
      },
      201
    );
  } catch (e) {
    console.error("[reseller] topup request failed:", e);
    return jsonError("Failed to submit top-up request", 500);
  }
}
