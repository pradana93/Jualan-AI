// Shared helpers for reseller API routes.
import { NextResponse } from "next/server";

export function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonError(message, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function clientIp(request) {
  const fwd = request.headers.get("x-9r-real-ip") || request.headers.get("x-forwarded-for");
  if (fwd) return String(fwd).split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
