"use client";

// Platform-admin console for the commercial reseller platform.
//
// /dashboard/reseller — revenue/margin snapshot, customer management, model
// sell-pricing, and top-up approvals. Rendered inside the admin DashboardLayout
// (sidebar + header); the customer portal at / never shows any of this.
//
// Every API call goes through /api/reseller/admin/*, which requires a platform
// admin (operator JWT or reseller admin session).

import { useCallback, useEffect, useState } from "react";

async function adminRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/reseller/admin${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function cpToUnits(cp) {
  return (Number(cp) || 0) / 1000;
}

function formatCp(cp) {
  return cpToUnits(cp).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(n) {
  return (Number(n) || 0).toLocaleString();
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const STATUS_STYLES = {
  completed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  ok: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  active: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  pending: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  suspended: "bg-red-500/10 text-red-400 border-red-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  rejected: "bg-red-500/10 text-red-400 border-red-500/30",
};

function StatusPill({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        STATUS_STYLES[status] || "border-border bg-surface-2 text-text-muted"
      }`}
    >
      {status}
    </span>
  );
}

function StatCard({ label, value, hint, tone = "" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 card-soft">
      <div className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${tone}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-text-subtle">{hint}</div>}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, step }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      <input
        type={type}
        value={value}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
      />
    </label>
  );
}

const EMPTY_PRICING = {
  model: "",
  displayName: "",
  inputCpPerM: "0",
  outputCpPerM: "0",
  cachedInputCpPerM: "0",
  upstreamInputCpPerM: "0",
  upstreamOutputCpPerM: "0",
};

export default function ResellerAdminPage() {
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [pricing, setPricing] = useState([]);
  const [topups, setTopups] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // Per-customer credit input, keyed by user id.
  const [grantDraft, setGrantDraft] = useState({});
  // New customer form.
  const [newUser, setNewUser] = useState({ email: "", name: "", password: "" });
  const [showNewUser, setShowNewUser] = useState(false);
  // New pricing row form.
  const [newPricing, setNewPricing] = useState(EMPTY_PRICING);

  // Fetch every panel in one round trip. Pure data — callers decide where it lands.
  const fetchAll = useCallback(async () => {
    const [s, u, p, t] = await Promise.all([
      adminRequest("/summary"),
      adminRequest("/users"),
      adminRequest("/pricing"),
      adminRequest("/topups"),
    ]);
    return {
      summary: s,
      users: u.users || [],
      pricing: p.pricing || [],
      topups: t.topups || [],
    };
  }, []);

  // Apply a fetchAll() result to state. Only ever called after an await, so it
  // never runs synchronously inside an effect body.
  const applyAll = useCallback((d) => {
    setError("");
    setSummary(d.summary);
    setUsers(d.users);
    setPricing(d.pricing);
    setTopups(d.topups);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchAll()
      .then((d) => {
        if (alive) applyAll(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [fetchAll, applyAll]);

  const run = async (fn, message) => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      if (message) setSuccess(message);
      applyAll(await fetchAll());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleGrant = (userId) =>
    run(async () => {
      const units = Number(grantDraft[userId]);
      if (!Number.isFinite(units) || units === 0) throw new Error("Enter a non-zero amount");
      const adjustCp = Math.round(units * 1000);
      await adminRequest(`/users/${userId}`, {
        method: "PATCH",
        body: { adjustCp, adjustNote: "Manual credit from admin console" },
      });
      setGrantDraft((d) => ({ ...d, [userId]: "" }));
    }, "Balance updated.");

  const handleToggleStatus = (user) =>
    run(
      async () => {
        await adminRequest(`/users/${user.id}`, {
          method: "PATCH",
          body: { status: user.status === "active" ? "suspended" : "active" },
        });
      },
      `Customer ${user.status === "active" ? "suspended" : "reactivated"}.`
    );

  const handleCreateUser = (e) => {
    e.preventDefault();
    return run(async () => {
      await adminRequest("/users", { method: "POST", body: newUser });
      setNewUser({ email: "", name: "", password: "" });
      setShowNewUser(false);
    }, "Customer created.");
  };

  const handleSavePricing = (row) =>
    run(
      async () => {
        await adminRequest("/pricing", { method: "POST", body: row });
      },
      `Pricing saved for ${row.model}.`
    );

  const handleAddPricing = (e) => {
    e.preventDefault();
    return run(async () => {
      await adminRequest("/pricing", {
        method: "POST",
        body: { ...newPricing, enabled: true },
      });
      setNewPricing(EMPTY_PRICING);
    }, "Model pricing added.");
  };

  const handleDeletePricing = (model) => {
    if (!confirm(`Delete pricing for "${model}"? Calls for this model will fall back to the catch-all row.`)) {
      return;
    }
    return run(async () => {
      await adminRequest(`/pricing/${encodeURIComponent(model)}`, { method: "DELETE" });
    }, "Pricing row deleted.");
  };

  const handleTopup = (id, action) =>
    run(
      async () => {
        if (action === "approve") {
          await adminRequest(`/topups/${id}`, { method: "POST", body: {} });
        } else {
          const reason = window.prompt("Rejection reason (optional):") || "Rejected by admin";
          await adminRequest(`/topups/${id}`, { method: "DELETE", body: { reason } });
        }
      },
      `Top-up ${action === "approve" ? "approved and credited" : "rejected"}.`
    );

  const s = summary?.summary || {};

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Reseller Platform</h1>
          <p className="text-sm text-text-muted">
            Customers, credit-point pricing and top-up approvals for your AI key business.
          </p>
        </div>
        <button
          type="button"
          onClick={() => run(() => fetchAll().then(applyAll))}
          disabled={busy}
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-medium transition hover:bg-surface-3 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
          {success}
        </div>
      )}

      <div className="flex gap-2 border-b border-border">
        {[
          { id: "overview", label: "Overview" },
          { id: "customers", label: `Customers (${users.length})` },
          { id: "pricing", label: `Pricing (${pricing.length})` },
          { id: "topups", label: `Top-ups${topups.length ? ` (${topups.length})` : ""}` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setError("");
              setSuccess("");
            }}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.id
                ? "border-brand-500 text-brand-500"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard
              label="Revenue (sell)"
              value={`$${formatCp(s.revenueCp)}`}
              hint={`${formatNumber(s.requests)} metered requests`}
              tone="text-emerald-500"
            />
            <StatCard
              label="Upstream cost"
              value={`$${formatCp(s.upstreamCp)}`}
              hint="What your providers charged"
            />
            <StatCard
              label="Gross margin"
              value={`$${formatCp(s.marginCp)}`}
              hint="Sell − upstream"
              tone="text-brand-500"
            />
            <StatCard
              label="Credits issued"
              value={`$${formatCp(s.toppedUpCp)}`}
              hint="Top-ups, grants and bonuses"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Customers" value={formatNumber(summary?.customers)} />
            <StatCard
              label="API keys"
              value={formatNumber(summary?.keys)}
              hint={`${formatNumber(summary?.activeKeys)} active`}
            />
            <StatCard
              label="Pending top-ups"
              value={formatNumber(summary?.pendingTopups)}
              hint="Awaiting your approval"
              tone={summary?.pendingTopups > 0 ? "text-amber-500" : ""}
            />
          </div>
          {topups.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-500">
              {topups.length} top-up request{topups.length === 1 ? "" : "s"} waiting for review —{" "}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => setTab("topups")}
              >
                review now
              </button>
              .
            </div>
          )}
        </div>
      )}

      {/* CUSTOMERS */}
      {tab === "customers" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">
              Credit or debit balances in currency units (1000 cp = 1 unit).
            </p>
            <button
              type="button"
              onClick={() => setShowNewUser((v) => !v)}
              className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600"
            >
              {showNewUser ? "Cancel" : "New customer"}
            </button>
          </div>

          {showNewUser && (
            <form
              onSubmit={handleCreateUser}
              className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-surface p-5 md:grid-cols-4"
            >
              <Field
                label="Email"
                value={newUser.email}
                onChange={(v) => setNewUser((u) => ({ ...u, email: v }))}
                placeholder="customer@example.com"
              />
              <Field
                label="Name"
                value={newUser.name}
                onChange={(v) => setNewUser((u) => ({ ...u, name: v }))}
                placeholder="Customer name"
              />
              <Field
                label="Temporary password"
                type="password"
                value={newUser.password}
                onChange={(v) => setNewUser((u) => ({ ...u, password: v }))}
                placeholder="Minimum 6 characters"
              />
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-2xl border border-border bg-surface card-soft">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wider text-text-muted">
                  <th className="p-4">Customer</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Balance</th>
                  <th className="p-4 text-right">Spent</th>
                  <th className="p-4 text-right">RPM</th>
                  <th className="p-4 text-right">Keys</th>
                  <th className="p-4">Credit / debit</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-text-muted">
                      No customers yet.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="transition hover:bg-surface-2">
                      <td className="p-4">
                        <div className="font-medium">{u.name || u.email}</div>
                        <div className="text-xs text-text-muted">{u.email}</div>
                        {u.role === "admin" && (
                          <div className="mt-1 text-[10px] font-semibold uppercase text-brand-500">
                            platform admin
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <StatusPill status={u.status} />
                      </td>
                      <td className="p-4 text-right font-mono text-emerald-500">
                        ${formatCp(u.balanceCp)}
                      </td>
                      <td className="p-4 text-right font-mono">${formatCp(u.totalSpentCp)}</td>
                      <td className="p-4 text-right font-mono">{formatNumber(u.rpmLimit)}</td>
                      <td className="p-4 text-right font-mono">{u.keyCount}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="+10.00"
                            value={grantDraft[u.id] || ""}
                            onChange={(e) =>
                              setGrantDraft((d) => ({ ...d, [u.id]: e.target.value }))
                            }
                            className="w-24 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleGrant(u.id)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                          >
                            Apply
                          </button>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleToggleStatus(u)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                            u.status === "active"
                              ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                          }`}
                        >
                          {u.status === "active" ? "Suspend" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PRICING */}
      {tab === "pricing" && (
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Sell prices in credit points per 1M tokens. Upstream rates are what your provider
            charges — margin is reported per request. The <code className="font-mono">*</code> row
            is the catch-all for unpriced models.
          </p>

          <form
            onSubmit={handleAddPricing}
            className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-surface p-5 md:grid-cols-6"
          >
            <Field
              label="Model key"
              value={newPricing.model}
              onChange={(v) => setNewPricing((p) => ({ ...p, model: v }))}
              placeholder="gpt-4o-mini or *"
            />
            <Field
              label="Display name"
              value={newPricing.displayName}
              onChange={(v) => setNewPricing((p) => ({ ...p, displayName: v }))}
              placeholder="GPT-4o Mini"
            />
            <Field
              label="Input cp / 1M"
              type="number"
              value={newPricing.inputCpPerM}
              onChange={(v) => setNewPricing((p) => ({ ...p, inputCpPerM: v }))}
            />
            <Field
              label="Output cp / 1M"
              type="number"
              value={newPricing.outputCpPerM}
              onChange={(v) => setNewPricing((p) => ({ ...p, outputCpPerM: v }))}
            />
            <Field
              label="Upstream in cp / 1M"
              type="number"
              value={newPricing.upstreamInputCpPerM}
              onChange={(v) => setNewPricing((p) => ({ ...p, upstreamInputCpPerM: v }))}
            />
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy || !newPricing.model.trim()}
                className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
              >
                Add model
              </button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-border bg-surface card-soft">
            <table className="w-full min-w-[1000px] text-left">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wider text-text-muted">
                  <th className="p-4">Model</th>
                  <th className="p-4 text-right">Sell in</th>
                  <th className="p-4 text-right">Sell out</th>
                  <th className="p-4 text-right">Cached</th>
                  <th className="p-4 text-right">Upstream in</th>
                  <th className="p-4 text-right">Upstream out</th>
                  <th className="p-4 text-center">Enabled</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {pricing.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-text-muted">
                      No pricing configured. Add a <code className="font-mono">*</code> catch-all row
                      to start selling.
                    </td>
                  </tr>
                ) : (
                  pricing.map((p) => (
                    <PricingRow
                      key={`${p.id || p.model}:${p.updatedAt || ""}`}
                      row={p}
                      busy={busy}
                      onSave={handleSavePricing}
                      onDelete={handleDeletePricing}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TOP-UPS */}
      {tab === "topups" && (
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Approving credits the customer balance atomically and records who approved it. Approval
            is idempotent — double-clicking can never credit twice.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface card-soft">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wider text-text-muted">
                  <th className="p-4">Requested</th>
                  <th className="p-4">Customer</th>
                  <th className="p-4">Method / reference</th>
                  <th className="p-4">Note</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {topups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-text-muted">
                      No pending top-up requests.
                    </td>
                  </tr>
                ) : (
                  topups.map((t) => (
                    <tr key={t.id} className="transition hover:bg-surface-2">
                      <td className="p-4 text-xs text-text-muted">{formatDate(t.created_at)}</td>
                      <td className="p-4 font-medium">{t.user_email}</td>
                      <td className="p-4 font-mono text-xs text-text-muted">
                        {t.method || "—"}
                        {t.reference ? ` · ${t.reference}` : ""}
                      </td>
                      <td className="p-4 text-xs text-text-muted">{t.note || "—"}</td>
                      <td className="p-4 text-right font-mono font-semibold text-emerald-500">
                        +${formatCp(t.amount_cp)}
                      </td>
                      <td className="p-4 text-center">
                        <StatusPill status={t.status} />
                      </td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleTopup(t.id, "approve")}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleTopup(t.id, "reject")}
                            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// One editable pricing row. Local draft state keeps typing cheap; saving pushes
// the whole row back through the upsert endpoint. The parent keys this component
// by row identity, so a refreshed row remounts with fresh state instead of
// needing an effect to copy props into state.
function PricingRow({ row, busy, onSave, onDelete }) {
  const [draft, setDraft] = useState(row);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const numeric = (k) => (
    <input
      type="number"
      value={draft[k] ?? 0}
      onChange={(e) => set(k, e.target.value)}
      className="w-24 rounded-lg border border-border bg-bg px-2 py-1.5 text-right font-mono text-xs outline-none focus:border-brand-500"
    />
  );

  return (
    <tr className="transition hover:bg-surface-2">
      <td className="p-4">
        <div className="font-mono text-xs font-semibold">{row.model}</div>
        <input
          type="text"
          value={draft.displayName || ""}
          placeholder="Display name"
          onChange={(e) => set("displayName", e.target.value)}
          className="mt-1 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-text-muted outline-none focus:border-brand-500"
        />
      </td>
      <td className="p-4 text-right">{numeric("inputCpPerM")}</td>
      <td className="p-4 text-right">{numeric("outputCpPerM")}</td>
      <td className="p-4 text-right">{numeric("cachedInputCpPerM")}</td>
      <td className="p-4 text-right">{numeric("upstreamInputCpPerM")}</td>
      <td className="p-4 text-right">{numeric("upstreamOutputCpPerM")}</td>
      <td className="p-4 text-center">
        <input
          type="checkbox"
          checked={!!draft.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="h-4 w-4 accent-[var(--color-brand-500)]"
        />
      </td>
      <td className="p-4">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(draft)}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(row.model)}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
