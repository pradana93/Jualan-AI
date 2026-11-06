import { getSessionUser } from "@/lib/reseller/session.js";
import { getResellerConfig, CP_PER_UNIT } from "@/lib/reseller/config.js";
import { ready } from "@/lib/reseller/db.js";
import { json, jsonError } from "../../_utils.js";

export const dynamic = "force-dynamic";

// GET /api/reseller/auth/me — who am I + platform display settings.
export async function GET(request) {
  try {
    const cfg = getResellerConfig();
    if (!cfg.enabled) return jsonError("Reseller platform is disabled", 503);

    await ready();
    const user = await getSessionUser(request);
    if (!user) return json({ user: null, config: publicConfig(cfg) }, 200);

    return json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        balanceCp: user.balanceCp,
        totalSpentCp: user.totalSpentCp,
        rpmLimit: user.rpmLimit,
        createdAt: user.createdAt,
      },
      config: publicConfig(cfg),
    });
  } catch (error) {
    console.error("[reseller] me failed:", error);
    return jsonError("Failed to load session", 500);
  }
}

function publicConfig(cfg) {
  return {
    currency: cfg.currency,
    currencySymbol: cfg.currencySymbol,
    cpPerUnit: CP_PER_UNIT,
    allowSignup: cfg.allowSignup,
    signupBonusCp: cfg.signupBonusCp,
    minBalanceCp: cfg.minBalanceCp,
    defaultRpmLimit: cfg.defaultRpmLimit,
  };
}
