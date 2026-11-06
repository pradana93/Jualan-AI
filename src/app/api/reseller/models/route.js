import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/reseller/session.js";
import { listPricing } from "@/lib/reseller/repos/pricingRepo.js";
import { ready } from "@/lib/reseller/db.js";

// GET /api/reseller/models - Returns the enabled, priced model catalog.
export async function GET(request) {
  try {
    const { user, error } = await requireSessionUser(request);
    if (error) return NextResponse.json({ error: error.message }, { status: error.status });

    await ready();
    const pricing = await listPricing({ onlyEnabled: true });

    // Customer-facing catalog: sell prices only, upstream margin hidden.
    const models = pricing.map((p) => ({
      model: p.model,
      name: p.displayName || p.model,
      inputCpPerM: p.inputCpPerM,
      outputCpPerM: p.outputCpPerM,
      cachedInputCpPerM: p.cachedInputCpPerM,
    }));

    return NextResponse.json({ models });
  } catch (error) {
    console.error("[reseller] catalog fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch model catalog" }, { status: 500 });
  }
}
