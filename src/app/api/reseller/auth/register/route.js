import { NextResponse } from "next/server";
import { ready } from "@/lib/reseller/db.js";
import { getResellerConfig } from "@/lib/reseller/config.js";
import { getUserByEmail, createUser, adjustBalance } from "@/lib/reseller/repos/usersRepo.js";
import { hashPassword, passwordPolicyError } from "@/lib/reseller/passwords.js";
import { createSessionToken, getSessionCookieName, sessionCookieOptions } from "@/lib/reseller/session.js";
import { checkRpm } from "@/lib/reseller/rateLimit.js";
import { createTransaction } from "@/lib/reseller/repos/ledgerRepo.js";
import { jsonError } from "../../_utils.js";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    balanceCp: u.balanceCp,
    totalSpentCp: u.totalSpentCp,
    createdAt: u.createdAt,
  };
}

// POST /api/reseller/auth/register — create a customer account.
export async function POST(request) {
  try {
    const ip = (request.headers.get("x-9r-real-ip") || "unknown").split(",")[0].trim();
    if (!checkRpm(`reseller:register:${ip}`, 5).allowed) {
      return jsonError("Too many sign-up attempts, slow down", 429);
    }

    const body = await request.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body");

    const cfg = getResellerConfig();
    if (!cfg.enabled) return jsonError("Reseller platform is disabled", 503);
    if (!cfg.allowSignup) return jsonError("Sign-ups are currently closed", 403);

    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");

    if (!EMAIL_RE.test(email)) return jsonError("Enter a valid email address");
    const pwErr = passwordPolicyError(password);
    if (pwErr) return jsonError(pwErr);

    await ready();

    if (await getUserByEmail(email)) return jsonError("An account with this email already exists", 409);

    const user = await createUser({
      email,
      name: name || email.split("@")[0],
      passwordHash: await hashPassword(password),
      role: "customer",
    });

    // Welcome bonus (optional) — booked as a completed transaction for audit.
    if (cfg.signupBonusCp > 0) {
      await adjustBalance(user.id, cfg.signupBonusCp);
      await createTransaction({
        userId: user.id,
        type: "signup_bonus",
        amountCp: cfg.signupBonusCp,
        status: "completed",
        note: "Welcome bonus",
      });
    }

    const token = await createSessionToken(user);
    const res = NextResponse.json(
      { success: true, user: publicUser(user) },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
    res.cookies.set(getSessionCookieName(), token, sessionCookieOptions(request));
    return res;
  } catch (error) {
    console.error("[reseller] register failed:", error);
    return jsonError("Registration failed", 500);
  }
}
