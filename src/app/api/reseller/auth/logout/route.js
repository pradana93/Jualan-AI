import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/reseller/session.js";

export const dynamic = "force-dynamic";

// POST /api/reseller/auth/logout — clear the session cookie.
export async function POST() {
  const res = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(getSessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
