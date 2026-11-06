import { ready } from "@/lib/reseller/db.js";
import { requireAdmin } from "@/lib/reseller/session.js";
import { listUsers, createUser, getUserByEmail } from "@/lib/reseller/repos/usersRepo.js";
import { hashPassword, passwordPolicyError } from "@/lib/reseller/passwords.js";
import { listAllKeys } from "@/lib/reseller/repos/keysRepo.js";
import { json, jsonError, readJson } from "../../_utils.js";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/reseller/admin/users — every customer, with their key count.
export async function GET(request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    await ready();

    const [users, keys] = await Promise.all([listUsers(1000), listAllKeys(5000)]);
    const keyCounts = new Map();
    for (const k of keys) keyCounts.set(k.userId, (keyCounts.get(k.userId) || 0) + 1);

    return json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        balanceCp: u.balanceCp,
        totalSpentCp: u.totalSpentCp,
        rpmLimit: u.rpmLimit,
        note: u.note,
        keyCount: keyCounts.get(u.id) || 0,
        createdAt: u.createdAt,
      })),
    });
  } catch (e) {
    console.error("[reseller] admin users list failed:", e);
    return jsonError("Failed to list customers", 500);
  }
}

// POST /api/reseller/admin/users — provision a customer account.
export async function POST(request) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return jsonError(error.message, error.status);
    await ready();

    const body = (await readJson(request)) || {};
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    const role = body.role === "admin" ? "admin" : "customer";

    if (!EMAIL_RE.test(email)) return jsonError("Enter a valid email address");
    const pwErr = passwordPolicyError(password);
    if (pwErr) return jsonError(pwErr);
    if (await getUserByEmail(email)) return jsonError("An account with this email already exists", 409);

    const user = await createUser({
      email,
      name: name || email.split("@")[0],
      passwordHash: await hashPassword(password),
      role,
      balanceCp: 0,
      note: String(body.note || "").slice(0, 500) || null,
    });
    return json({ success: true, user }, 201);
  } catch (e) {
    console.error("[reseller] admin user create failed:", e);
    return jsonError("Failed to create customer", 500);
  }
}
