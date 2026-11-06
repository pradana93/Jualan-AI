// Platform-admin authorization.
//
// Two independent credentials can open the admin console at /dashboard:
//
//  1. The 9router operator session (`auth_token` JWT). This install has a
//     single shared operator password and that JWT carries no role claim, so a
//     valid token *is* the install owner.
//  2. A reseller session (`reseller_session`) whose user has role = 'admin' in
//     reseller_users — i.e. the bootstrapped RESELLER_ADMIN_EMAIL account.
//
// A customer reseller session is never an admin: those requests are sent back
// to the customer portal at / instead.
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getSessionPayload } from "./session.js";
import { getUserById } from "./repos/usersRepo.js";

export const RESELLER_SESSION_COOKIE = "reseller_session";
export const OPERATOR_SESSION_COOKIE = "auth_token";

/** Resolve the reseller session user (customer or admin) from the request. */
export async function getResellerSessionUser(request) {
  const token = request?.cookies?.get?.(RESELLER_SESSION_COOKIE)?.value || null;
  if (!token) return null;
  const payload = await getSessionPayload(token);
  if (!payload) return null;
  const user = await getUserById(payload.uid);
  if (!user || user.status !== "active") return null;
  return user;
}

/** True when the request carries a valid (non-admin) reseller session. */
export async function hasResellerSession(request) {
  try {
    return !!(await getResellerSessionUser(request));
  } catch {
    return false;
  }
}

/**
 * Resolve the platform admin for this request, or null.
 * Returns `{ id, email, name, role, source }`.
 */
export async function getPlatformAdminUser(request) {
  // 1. Operator session — the 9router dashboard JWT.
  const operatorToken = request?.cookies?.get?.(OPERATOR_SESSION_COOKIE)?.value;
  if (operatorToken && (await verifyDashboardAuthToken(operatorToken))) {
    return {
      id: "operator",
      email: null,
      name: "Platform Operator",
      role: "admin",
      source: "dashboard",
    };
  }

  // 2. Reseller admin account.
  const user = await getResellerSessionUser(request);
  if (user?.role === "admin") return { ...user, source: "reseller" };

  return null;
}

/** Boolean helper — never throws, so it is safe to call from the proxy. */
export async function isPlatformAdmin(request) {
  try {
    return !!(await getPlatformAdminUser(request));
  } catch {
    return false;
  }
}

/**
 * Resolve the platform admin for this request or respond 401/403 directly.
 * Returns `{ admin, response }` — exactly one is non-null.
 */
export async function requirePlatformAdmin(request) {
  let admin = null;
  try {
    admin = await getPlatformAdminUser(request);
  } catch {
    admin = null;
  }
  if (!admin) {
    return {
      admin: null,
      response: Response.json({ error: "Admin authorization required" }, { status: 401 }),
    };
  }
  return { admin, response: null };
}
