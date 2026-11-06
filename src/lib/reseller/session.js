// Dashboard sessions — customer/admin login for the reseller portal.
// A separate hardened JWT (HS256) from the local 9router dashboard session:
//   claim { uid, email, role, type:"reseller" }  → cookie `reseller_session`.
import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";
import { getResellerConfig } from "./config.js";

const COOKIE_NAME = "reseller_session";

function loadSecret() {
  // Vercel/Production: prefer explicitly set env vars (set via Vercel dashboard or
  // `vercel env add` — these persist across cold starts and are the recommended way).
  if (process.env.RESELLER_SESSION_SECRET)
    return new TextEncoder().encode(process.env.RESELLER_SESSION_SECRET);
  if (process.env.JWT_SECRET) return new TextEncoder().encode(`${process.env.JWT_SECRET}:reseller`);
  // Local dev fallback: read from file (generated on first boot, persists while
  // the local process runs; NOT suitable for ephemeral platforms like Vercel).
  const file = path.join(DATA_DIR, "reseller-session-secret");
  try {
    return new TextEncoder().encode(fs.readFileSync(file, "utf8").trim());
  } catch {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, generated, { mode: 0o600 });
    return new TextEncoder().encode(generated);
  }
}

let CACHED = null;
function getSecret() {
  if (!CACHED) CACHED = loadSecret();
  return CACHED;
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export async function createSessionToken(user, maxAgeSec) {
  const cfg = getResellerConfig();
  const exp = Math.floor(Date.now() / 1000) + (maxAgeSec || cfg.sessionMaxAgeSec);
  return new SignJWT({ uid: user.id, email: user.email, role: user.role, type: "reseller" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(getSecret());
}

export async function getSessionPayload(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload || payload.type !== "reseller" || !payload.uid) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSessionCookie(request) {
  try {
    return request?.cookies?.get?.(COOKIE_NAME)?.value || null;
  } catch {
    return null;
  }
}

export async function getSessionUser(request) {
  const payload = await getSessionPayload(readSessionCookie(request));
  if (!payload) return null;
  const { getUserById } = await import("./repos/usersRepo.js");
  const user = await getUserById(payload.uid);
  if (!user || user.status !== "active") return null;
  return user;
}

export async function requireSessionUser(request) {
  const user = await getSessionUser(request);
  return user ? { user, error: null } : { user: null, error: { status: 401, message: "Not signed in" } };
}

/**
 * Admin gate for the reseller admin APIs.
 *
 * Accepts either a reseller session whose user has role = 'admin', or the
 * 9router operator session (dashboard JWT) — the install owner, who has no
 * reseller user row but must still be able to approve top-ups and manage
 * pricing from /dashboard.
 */
export async function requireAdmin(request) {
  const { user, error } = await requireSessionUser(request);
  if (!error && user.role === "admin") return { user, error: null };

  // Operator session fallback (lazy import avoids a static import cycle).
  try {
    const { isPlatformAdmin } = await import("./adminAuth.js");
    if (await isPlatformAdmin(request)) {
      return {
        user: user || { id: "operator", email: null, name: "Platform Operator", role: "admin" },
        error: null,
      };
    }
  } catch {
    // fall through to the error below
  }

  if (error) return { user: null, error };
  return { user: null, error: { status: 403, message: "Admin only" } };
}

export function sessionCookieOptions(request) {
  const forceSecure = process.env.AUTH_COOKIE_SECURE === "true";
  const forwarded = request?.headers?.get?.("x-forwarded-proto");
  const secure = forceSecure || forwarded === "https";
  const cfg = getResellerConfig();
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: cfg.sessionMaxAgeSec,
  };
}
