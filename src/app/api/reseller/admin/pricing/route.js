import { ready } from "@/lib/reseller/db.js";
import { requireAdmin } from "@/lib/reseller/session.js";
import { listPricing, upsertPricing } from "@/lib/reseller/repos/pricingRepo.js";
import { json, jsonError, readJson } from "../../_utils.js";

export const dynamic = "force-dynamic";

// GET /api/reseller/admin/pricing — full pricing table (sell + upstream).
export async function GET(request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    await ready();
    const pricing = await listPricing();
    return json({ pricing });
  } catch (e) {
    console.error("[reseller] admin pricing list failed:", e);
    return jsonError("Failed to load pricing", 500);
  }
}

// POST /api/reseller/admin/pricing — create or update one model's pricing.
export async function POST(request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    await ready();

    const body = (await readJson(request)) || {};
    const model = String(body.model || "").trim();
    if (!model) return jsonError("model is required");

    const pricing = await upsertPricing(model, {
      displayName: body.displayName,
      inputCpPerM: body.inputCpPerM,
      outputCpPerM: body.outputCpPerM,
      cachedInputCpPerM: body.cachedInputCpPerM,
      upstreamInputCpPerM: body.upstreamInputCpPerM,
      upstreamOutputCpPerM: body.upstreamOutputCpPerM,
      enabled: body.enabled,
      sortOrder: body.sortOrder,
    });
    return json({ success: true, pricing }, 201);
  } catch (e) {
    console.error("[reseller] admin pricing upsert failed:", e);
    return jsonError(e.message || "Failed to save pricing", 500);
  }
}
