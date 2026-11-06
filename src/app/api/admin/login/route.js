// POST /api/admin/login — platform-admin sign-in.
//
// Two accepted credentials, in this order:
//
//   1. A reseller account whose role is "admin" (the bootstrapped
//      RESELLER_ADMIN_EMAIL account, or any admin promoted later). Issues the
//      normal `reseller_session` cookie — the same session the customer portal
//      uses, so the admin console and the portal share one identity.
//
//   2. The 9router operator password (settings.password / INITIAL_PASSWORD).
//      Issues the operator `auth_token` cookie, which dashboardGuard already
//      treats as platform-admin.
//
// Both paths share one rate-limit bucket, and a customer (non-admin) account
// is rejected outright — it must not be able to reach the console.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getSettings } from "@/lib/localDb";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { ready } from "@/lib/reseller/db.js";
import { getResellerConfig } from "@/lib/reseller/config.js";
import { getUserAuthByEmail, getUserById } from "@/lib/reseller/repos/usersRepo.js";
import { verifyPassword } from "@/lib/reseller/passwords.js";
import {
  createSessionToken,
  getSessionCookieName,
  sessionCookieOptions,
} from "@/lib/reseller/session.js";
import { jsonError, clientIp } from "../../reseller/_utils.js";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Constant-time dummy hash so a missing account costs the same as a wrong password. */
const DUMMY_HASH = "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";

export async function POST(request) {
  try {
    const ip = getClientIp(request) || clientIp(request) || "unknown";

    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`,
          retryAfter: lock.retryAfter,
        },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(lock.retryAfter) } }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON body");

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!password) return jsonError("Password is required");

    const cfg = getResellerConfig();

    // ── 1. Reseller admin account ──────────────────────────────────────────
    let adminUser = null;
    if (EMAIL_RE.test(email) && cfg.enabled) {
      await ready();
      const auth = await getUserAuthByEmail(email);
      const hash = auth?.passwordHash || DUMMY_HASH;
      const ok = await verifyPassword(password, hash);
      if (auth && ok && auth.role === "admin" && auth.status === "active") {
        adminUser = (await getUserById(auth.id)) || auth;
      }
    }

    if (adminUser) {
      recordSuccess(ip);
      const token = await createSessionToken(adminUser);
      const res = NextResponse.json(
        { success: true, role: "admin", email: adminUser.email },
        { status: 200, headers: NO_STORE }
      );
      res.cookies.set(getSessionCookieName(), token, sessionCookieOptions(request));
      return res;
    }

    // ── 2. Operator password fallback ──────────────────────────────────────
    const settings = await getSettings();
    const storedHash = settings?.password;
    let operatorOk = false;
    if (storedHash) {
      operatorOk = await bcrypt.compare(password, storedHash);
    } else {
      const initialPassword = process.env.INITIAL_PASSWORD || "123456";
      operatorOk = password === initialPassword;
    }
    // The operator password only unlocks the console when paired with the
    // admin email, so a stray operator password alone cannot sign in here.
    if (operatorOk && EMAIL_RE.test(email) && email === cfg.adminEmail) {
      recordSuccess(ip);
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);
      return NextResponse.json(
        { success: true, role: "operator", email },
        { status: 200, headers: NO_STORE }
      );
    }

    // ── Failure ────────────────────────────────────────────────────────────
    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Try again in ${postLock.retryAfter}s.`,
          retryAfter: postLock.retryAfter,
        },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid credentials. ${remainingBeforeLock} attempt(s) left before lockout.` },
      { status: 401, headers: NO_STORE }
    );
  } catch (error) {
    console.error("[api/admin/login] failed:", error);
    return jsonError("Login failed", 500);
  }
}
