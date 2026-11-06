"use client";

// Tiny fetch wrapper for the customer portal API. Every call sends the
// `reseller_session` cookie (same-origin) and unwraps the { error } envelope
// into a thrown Error so callers can try/catch.

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/reseller${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const resellerApi = {
  me: () => request("/auth/me"),
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  register: (email, password, name) => request("/auth/register", { method: "POST", body: { email, password, name } }),
  logout: () => request("/auth/logout", { method: "POST" }),

  models: () => request("/models"),

  listKeys: () => request("/keys"),
  createKey: (payload) => request("/keys", { method: "POST", body: payload }),
  updateKey: (id, payload) => request(`/keys/${id}`, { method: "PATCH", body: payload }),
  deleteKey: (id) => request(`/keys/${id}`, { method: "DELETE" }),

  usage: () => request("/usage"),

  listTopups: () => request("/topups"),
  requestTopup: (payload) => request("/topups", { method: "POST", body: payload }),
};

/** Format integer credit points as currency (1000 cp = 1 unit). */
export function formatCp(cp, { currency = "USD", cpPerUnit = 1000, symbol = "" } = {}) {
  const units = (Number(cp) || 0) / cpPerUnit;
  if (symbol) {
    return `${symbol}${units.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(units);
  } catch {
    return `${units.toFixed(4)} ${currency}`;
  }
}

export function formatNumber(n) {
  return (Number(n) || 0).toLocaleString();
}

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Round a currency-unit amount to integer credit points. */
export function unitsToCp(units, cpPerUnit = 1000) {
  const n = Number(units);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * cpPerUnit);
}
