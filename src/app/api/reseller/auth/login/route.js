import { NextResponse } from "next/server";
import { ready } from "@/lib/reseller/db.js";
import { getResellerConfig } from "@/lib/reseller/config.js";
import { getUserAuthByEmail, getUserById } from "@/lib/reseller/repos/usersRepo.js";
import { verifyPassword } from "@/lib/reseller/passwords.js";
import { createSessionToken, getSessionCookieName, sessionCookieOptions } from "@/lib/reseller/session.js";
import { checkRpm } from "@/lib/reseller/rateLimit.js";
import { jsonError, clientIp } from "../../_utils.js";

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

// POST /api/reseller/auth/login — email + password → session cookie.
export async function POST(request) {
  try {
    const ip = clientIp(request);
    if (!checkRpm(`reseller:login:${ip}`, 10).allowed) {
      return jsonError("Too many login attempts, try again in a minute", 429);
    }

    const body = await request.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body");

    const cfg = getResellerConfig();
    if (!cfg.enabled) return jsonError("Reseller platform is disabled", 503);

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!EMAIL_RE.test(email) || !password) return jsonError("Email and password are required");

    // Per-account throttle on top of the per-IP one, so a single target cannot
    // be brute-forced from a pool of rotating IPs.
    if (!checkRpm(`reseller:login:acct:${email}`, 10).allowed) {
      return jsonError("Too many login attempts, try again in a minute", 429);
    }

    await ready();

    const user = await getUserAuthByEmail(email);
    // Always run a bcrypt compare so a missing account takes the same time as a
    // wrong password (no user-enumeration oracle).
    const hash = user?.passwordHash || "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
    const ok = await verifyPassword(password, hash);

    if (!user || !ok) return jsonError("Incorrect email or password", 401);
    if (user.status !== "active") return jsonError("Account is suspended", 403);

    const fresh = (await getUserById(user.id)) || user;
    const token = await createSessionToken(fresh);
    const res = NextResponse.json(
      { success: true, user: publicUser(fresh) },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    res.cookies.set(getSessionCookieName(), token, sessionCookieOptions(request));
    return res;
  } catch (error) {
    console.error("[reseller] login failed:", error);
    return jsonError("Login failed", 500);
  }
}
