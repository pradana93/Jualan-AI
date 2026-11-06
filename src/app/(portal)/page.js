"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "./_lib/SessionProvider";
import { resellerApi, formatCp, formatNumber, formatDate, unitsToCp } from "./_lib/api";
import PrismMark from "@/shared/components/PrismMark";
import { BRAND, KEY_PREFIX_LABEL } from "@/shared/constants/brand";

// The engine origin customers point their SDKs at. On the split deployment the
// portal is on Vercel and the engine is behind the tunnel, so the browser
// origin is NOT the gateway. NEXT_PUBLIC_ENGINE_URL is inlined at build time.
const ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:20129";

// Fetch the data the current tab needs. Returns plain data; callers decide
// where the results land (effect state or event-handler refresh).
async function fetchPortalData(tab) {
  const out = {};
  if (tab === "keys" || tab === "overview") {
    out.keys = (await resellerApi.listKeys()).keys || [];
  }
  if (tab === "models" || tab === "overview") {
    out.models = (await resellerApi.models()).models || [];
  }
  if (tab === "usage" || tab === "overview") {
    out.usage = await resellerApi.usage();
  }
  if (tab === "topup" || tab === "overview") {
    out.topups = (await resellerApi.listTopups()).topups || [];
  }
  return out;
}

const PortalNavTabs = ({ currentTab, setTab, hasPendingTopups }) => {
  const tabs = useMemo(() => [
    { id: "overview", label: "Command Center", icon: "grid_view" },
    { id: "keys", label: "API Keys", icon: "vpn_key" },
    { id: "models", label: "Models & Pricing", icon: "psychology" },
    { id: "usage", label: "Usage & Ledger", icon: "receipt_long" },
    { id: "topup", label: "Request Top-up", icon: "payments", badge: hasPendingTopups ? "!" : "" },
  ], [hasPendingTopups]);

  return (
    <div className="border-b border-prism-hairline bg-prism-panel-soft px-6 flex gap-2 overflow-x-auto custom-scrollbar">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 transition relative ${
            currentTab === t.id
              ? "border-accent-cyan text-accent-cyan bg-accent-cyan/10"
              : "border-transparent text-text-muted hover:text-text-main"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
          {t.label}
          {t.badge && (
            <span className="absolute -top-1 -right-1 bg-accent-magenta text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none">
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export default function ResellerDashboard() {
  const { user, config, loading, setUser } = useSession();
  const router = useRouter();

  const [tab, setTab] = useState("overview"); // overview, keys, models, usage, topup
  const [keys, setKeys] = useState([]);
  const [models, setModels] = useState([]);
  const [usage, setUsage] = useState({ usage: [], summary: {}, transactions: [] });
  const [myTopups, setMyTopups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const gatewayUrl = ENGINE_URL;

  // New key form
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKeyRaw, setCreatedKeyRaw] = useState("");

  // Top-up request form
  const [topupAmount, setTopupAmount] = useState("10.00"); // Displayed in currency units
  const [topupMethod, setTopupMethod] = useState("bank_transfer");
  const [topupRef, setTopupRef] = useState("");
  const [topupNote, setTopupNote] = useState("");

  const applyData = (d = {}) => {
    if (d.keys) setKeys(d.keys);
    if (d.models) setModels(d.models);
    if (d.usage) setUsage(d.usage);
    if (d.topups) setMyTopups(d.topups);
  };

  const reload = async () => {
    try {
      applyData(await fetchPortalData(tab));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push("/signin");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    fetchPortalData(tab)
      .then((d) => {
        if (alive) applyData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [tab, user]);

  const combinedUsageAndTransactions = useMemo(() => {
    if (!usage.usage && !usage.transactions) return [];
    return [...(usage.usage || []).map(item => ({ ...item, type: 'usage', sortKey: item.createdAt })),
            ...(usage.transactions || []).map(item => ({ ...item, type: 'transaction', sortKey: item.createdAt }))]
      .sort((a, b) => new Date(b.sortKey) - new Date(a.sortKey));
  }, [usage.usage, usage.transactions]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 prism-shell">
        <PrismMark size={56} className="shadow-prism" />
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent-cyan"></div>
          <span className="text-sm text-text-muted">Loading {BRAND.nameLead}Gate portal…</span>
        </div>
      </div>
    );
  }

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await resellerApi.createKey({ name: newKeyName.trim() });
      setCreatedKeyRaw(res.key.raw);
      setNewKeyName("");
      await reload();
      setSuccess("API key created successfully. Save the key now — it cannot be shown again!");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm("Revoke this API key? Applications using it will immediately fail.")) return;
    try {
      await resellerApi.deleteKey(id);
      await reload();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRequestTopup = async (e) => {
    e.preventDefault();
    const amountCp = unitsToCp(parseFloat(topupAmount), config.cpPerUnit);
    if (amountCp <= 0) { setError("Enter a valid amount"); return; }

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await resellerApi.requestTopup({
        amountCp,
        method: topupMethod,
        reference: topupRef.trim() || undefined,
        note: topupNote.trim() || undefined,
      });
      setSuccess("Top-up request submitted! Your balance will be credited after approval.");
      setTopupAmount("10.00");
      setTopupRef("");
      setTopupNote("");
      const t = await resellerApi.listTopups();
      setMyTopups(t.topups || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await resellerApi.logout();
      setUser(null);
      router.push("/signin");
    } catch (e) {
      setError(e.message);
    }
  };

  const currencySymbol = config?.currencySymbol || "$";
  const cpPerUnit = config?.cpPerUnit || 1000;
  const minTopupUnits = (config?.minTopupCp || 0) / cpPerUnit;
  const hasPendingTopups = myTopups.some(t => t.status === "pending");

  return (
    <div className="min-h-screen flex flex-col prism-shell text-white">
      {/* Top Navbar */}
      <header className="border-b border-prism-hairline bg-prism-panel px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <PrismMark size={32} className="shadow-lg shadow-brand-500/20" />
          <div>
            <h1 className="font-semibold text-lg leading-none">{BRAND.nameLead}<span className="text-accent-cyan">{BRAND.nameTail}</span> Portal</h1>
            <p className="text-xs text-text-muted mt-1">{BRAND.tagline}</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-prism-panel-soft px-3 py-1.5 rounded-full border border-prism-hairline">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-medium text-text-main">Balance:</span>
            <span className="font-bold text-emerald-400">{formatCp(user.balanceCp, { symbol: currencySymbol, cpPerUnit })}</span>
          </div>

          <div className="flex items-center gap-3 border-l border-prism-hairline pl-6">
            <div className="text-right">
              <div className="text-sm font-medium">{user.name || user.email}</div>
              <div className="text-xs text-text-muted uppercase tracking-wider">{user.role}</div>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs bg-prism-panel-soft hover:bg-white/10 text-text-main px-3 py-1.5 rounded-lg border border-prism-hairline transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Navigation tabs */}
      <PortalNavTabs currentTab={tab} setTab={setTab} hasPendingTopups={hasPendingTopups} />

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 text-text-main">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-200 font-bold">×</button>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-sm flex items-center justify-between">
            <span>{success}</span>
            <button onClick={() => setSuccess("")} className="text-emerald-400 hover:text-emerald-200 font-bold">×</button>
          </div>
        )}

        {/* OVERVIEW TAB */}
        {tab === "overview" && (
          <div className="space-y-6">
            {/* Hero Section */}
            <div className="relative isolate overflow-hidden rounded-3xl p-8 bg-gradient-to-br from-brand-700 to-brand-900 text-white shadow-lg shadow-brand-900/50">
                <div className="prism-grid absolute inset-0 opacity-20" />
                <div className="relative z-10">
                    <h1 className="text-4xl font-bold mb-2">Welcome, {user.name || "User"}!</h1>
                    <p className="text-lg opacity-90">{BRAND.tagline} Your gateway to limitless AI.</p>
                    <div className="mt-6 flex gap-4">
                        <button
                            onClick={() => setTab("keys")}
                            className="bg-accent-cyan hover:bg-accent-cyan/90 text-brand-950 font-semibold px-6 py-3 rounded-xl shadow-lg shadow-accent-cyan/30 transition-all active:scale-[0.98] animate-pulse-glow"
                        >
                            Mint New API Key
                        </button>
                        <button
                            onClick={() => setTab("topup")}
                            className="bg-white/15 hover:bg-white/25 border border-white/20 text-white font-medium px-6 py-3 rounded-xl shadow-lg shadow-black/20 transition-all active:scale-[0.98]"
                        >
                            Request Top-up
                        </button>
                    </div>
                </div>
            </div>


            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="prism-card p-5">
                <div className="text-text-muted text-xs font-medium uppercase tracking-wider">Credit Balance</div>
                <div className="text-2xl font-bold mt-2 text-accent-cyan">{formatCp(user.balanceCp, { symbol: currencySymbol, cpPerUnit })}</div>
                <div className="text-xs text-text-subtle mt-1">{formatNumber(user.balanceCp)} credit points</div>
              </div>
              <div className="prism-card p-5">
                <div className="text-text-muted text-xs font-medium uppercase tracking-wider">Total Spent</div>
                <div className="text-2xl font-bold mt-2 text-text-main">{formatCp(user.totalSpentCp, { symbol: currencySymbol, cpPerUnit })}</div>
                <div className="text-xs text-text-subtle mt-1">{formatNumber(user.totalSpentCp)} credit points</div>
              </div>
              <div className="prism-card p-5">
                <div className="text-text-muted text-xs font-medium uppercase tracking-wider">Active API Keys</div>
                <div className="text-2xl font-bold mt-2 text-accent-violet">{keys.filter(k => k.status === 'active').length}</div>
                <div className="text-xs text-text-subtle mt-1">{keys.length} total keys provisioned</div>
              </div>
              <div className="prism-card p-5">
                <div className="text-text-muted text-xs font-medium uppercase tracking-wider">RPM Rate Limit</div>
                <div className="text-2xl font-bold mt-2 text-text-main">{user.rpmLimit || config.defaultRpmLimit} rpm</div>
                <div className="text-xs text-text-subtle mt-1">Per-minute request ceiling</div>
              </div>
            </div>

            {/* Quick integration banner */}
            <div className="prism-panel rounded-3xl p-6 relative overflow-hidden">
                <div className="prism-sheen absolute inset-0 pointer-events-none z-0" />
                <div className="relative z-10">
                    <h2 className="text-lg font-semibold text-text-main text-prism-gradient">🚀 Quick Integration</h2>
                    <p className="text-sm text-text-muted mt-1">
                        Use your PrismGate API key (<code className="px-1 py-0.5 rounded bg-white/10 font-mono text-accent-cyan">{KEY_PREFIX_LABEL}...</code>) with any OpenAI-compatible client, SDK, or tool by pointing the base URL to your gateway.
                    </p>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-black/20 border border-white/10 rounded-xl p-4 font-mono text-xs text-white">
                            <div className="text-text-muted mb-1"># OpenAI Base URL</div>
                            <div>OPENAI_BASE_URL={gatewayUrl}/v1</div>
                            <div>OPENAI_API_KEY={KEY_PREFIX_LABEL}...</div>
                        </div>
                        <div className="bg-black/20 border border-white/10 rounded-xl p-4 font-mono text-xs text-white">
                            <div className="text-text-muted mb-1"># AI SDK / Node.js</div>
                            <div>const openai = new OpenAI(&#123;</div>
                            <div>&nbsp;&nbsp;baseURL: &apos;{gatewayUrl}/v1&apos;,</div>
                            <div>&nbsp;&nbsp;apiKey: &apos;{KEY_PREFIX_LABEL}...&apos;</div>
                            <div>&#125;);</div>
                        </div>
                    </div>
                </div>
            </div>
          </div>
        )}

        {/* KEYS TAB */}
        {tab === "keys" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">API Keys</h2>
                <p className="text-sm text-text-muted">Manage your <code className="px-1 py-0.5 rounded bg-prism-panel-soft font-mono text-text-main">{KEY_PREFIX_LABEL}...</code> secret keys for upstream routing.</p>
              </div>
            </div>

            {/* Create key card */}
            <div className="prism-card p-6">
              <h3 className="font-medium mb-3">Mint New API Key</h3>
              <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="Key label (e.g. Production App, CLI, Cursor)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="flex-1 prism-input rounded-xl px-4 py-2.5 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy || !newKeyName.trim()}
                  className="prism-btn-primary disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition shadow-lg shadow-brand-500/20"
                >
                  Mint Key
                </button>
              </form>

              {createdKeyRaw && (
                <div className="mt-4 p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-xl">
                  <div className="text-xs text-emerald-400 font-medium uppercase tracking-wider mb-1">New Secret Key (Copy Now)</div>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      readOnly
                      value={createdKeyRaw}
                      className="flex-1 bg-black/20 border border-emerald-900 rounded-lg px-3 py-2 font-mono text-xs text-emerald-300"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(createdKeyRaw);
                        setSuccess("Key copied to clipboard!");
                      }}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2 rounded-lg font-medium transition"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-2">For security, this key is hashed with SHA-256 and will never be shown again.</p>
                </div>
              )}
            </div>

            {/* Keys table */}
            <div className="prism-card overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-prism-hairline text-text-muted text-xs uppercase tracking-wider bg-prism-panel-soft">
                    <th className="p-4">Name</th>
                    <th className="p-4">Key Mask</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Requests</th>
                    <th className="p-4 text-right">Spend</th>
                    <th className="p-4">Last Used</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-prism-hairline text-sm">
                  {keys.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-text-muted">No API keys created yet. Mint one above!</td>
                    </tr>
                  ) : (
                    keys.map((k) => (
                      <tr key={k.id} className="hover:bg-prism-panel-soft transition">
                        <td className="p-4 font-medium text-text-main">{k.name}</td>
                        <td className="p-4 font-mono text-xs text-text-muted">{k.keyMasked}</td>
                        <td className="p-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            k.status === "active" ? "bg-emerald-950/30 text-emerald-400 border border-emerald-800/60" : "bg-white/10 text-text-muted border border-prism-hairline"
                          }`}>
                            {k.status}
                          </span>
                        </td>
                        <td className="p-4 text-right font-mono">{formatNumber(k.requests)}</td>
                        <td className="p-4 text-right font-mono text-accent-cyan">{formatCp(k.spendCp, { symbol: currencySymbol, cpPerUnit })}</td>
                        <td className="p-4 text-text-muted text-xs">{formatDate(k.lastUsedAt)}</td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleDeleteKey(k.id)}
                            className="text-danger hover:text-red-300 text-xs font-medium px-3 py-1 rounded-lg bg-red-950/20 border border-red-800/40 transition"
                          >
                            Revoke
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

        {/* MODELS TAB */}
        {tab === "models" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Models & Reseller Pricing</h2>
              <p className="text-sm text-text-muted">Current sell pricing in credit points per 1M tokens.</p>
            </div>

            <div className="prism-card overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-prism-hairline text-text-muted text-xs uppercase tracking-wider bg-prism-panel-soft">
                    <th className="p-4">Model ID</th>
                    <th className="p-4">Display Name</th>
                    <th className="p-4 text-right">Input / 1M</th>
                    <th className="p-4 text-right">Output / 1M</th>
                    <th className="p-4 text-right">Cached / 1M</th>
                    <th className="p-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-prism-hairline text-sm">
                  {models.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-text-muted">No pricing models configured.</td>
                    </tr>
                  ) : (
                    models.map((m) => (
                      <tr key={m.id || m.model} className="hover:bg-prism-panel-soft transition">
                        <td className="p-4 font-mono font-medium text-text-main">{m.model}</td>
                        <td className="p-4 text-text-main">{m.name || m.displayName || m.model}</td>
                        <td className="p-4 text-right font-mono text-accent-cyan">{formatNumber(m.inputCpPerM)} cp</td>
                        <td className="p-4 text-right font-mono text-accent-magenta">{formatNumber(m.outputCpPerM)} cp</td>
                        <td className="p-4 text-right font-mono text-accent-violet">{formatNumber(m.cachedInputCpPerM)} cp</td>
                        <td className="p-4 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950/30 text-emerald-400">
                            Enabled
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* USAGE TAB */}
        {tab === "usage" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Usage Ledger & Metering History</h2>
              <p className="text-sm text-text-muted">Detailed record of every billed API request and account transaction.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="prism-card p-5">
                <div className="text-text-muted text-xs font-medium uppercase tracking-wider">Total Requests</div>
                <div className="text-2xl font-bold mt-2 text-text-main">{formatNumber(usage.summary?.requests || 0)}</div>
              </div>
              <div className="prism-card p-5">
                <div className="text-text-muted text-xs font-medium uppercase tracking-wider">Prompt Tokens</div>
                <div className="text-2xl font-bold mt-2 text-accent-violet">{formatNumber(usage.summary?.promptTokens || 0)}</div>
              </div>
              <div className="prism-card p-5">
                <div className="text-text-muted text-xs font-medium uppercase tracking-wider">Completion Tokens</div>
                <div className="text-2xl font-bold mt-2 text-accent-cyan">{formatNumber(usage.summary?.completionTokens || 0)}</div>
              </div>
            </div>

            {/* Combined Usage and Transactions Table */}
            <div className="prism-card overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-prism-hairline text-text-muted text-xs uppercase tracking-wider bg-prism-panel-soft">
                    <th className="p-4">Time</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Description</th>
                    <th className="p-4 text-right">Amount / Cost</th>
                    <th className="p-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-prism-hairline text-sm">
                  {combinedUsageAndTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-text-muted">No usage or transactions recorded yet.</td>
                    </tr>
                  ) : (
                    combinedUsageAndTransactions.map((item) => (
                        <tr key={item.id} className="hover:bg-prism-panel-soft transition">
                          <td className="p-4 text-text-muted text-xs">{formatDate(item.createdAt)}</td>
                          <td className="p-4 font-medium text-text-main capitalize">{item.type === 'usage' ? 'API Call' : item.type.replace('_', ' ')}</td>
                          <td className="p-4 text-text-main">
                            {item.type === 'usage' ?
                              `${item.model} (${item.provider} - ${item.promptTokens} in / ${item.completionTokens} out)` :
                              item.note || item.reference
                            }
                          </td>
                          <td className="p-4 text-right font-mono ">
                            {item.type === 'usage' ?
                              <span className="text-danger">-{formatCp(item.costCp, { symbol: currencySymbol, cpPerUnit })}</span> :
                              <span className="text-emerald-400">+{formatCp(item.amountCp, { symbol: currencySymbol, cpPerUnit })}</span>
                            }
                          </td>
                          <td className="p-4 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              item.status === "ok" || item.status === "completed" ? "bg-emerald-950/30 text-emerald-400" :
                              item.status === "pending" ? "bg-amber-950/30 text-amber-400" : "bg-red-950/30 text-danger"
                            }`}>
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TOPUP TAB */}
        {tab === "topup" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Request Credit Top-up</h2>
              <p className="text-sm text-text-muted">Submit a request to top up your account balance. Admin approval is required.</p>
            </div>
            <div className="prism-card p-6 max-w-2xl">
              <form onSubmit={handleRequestTopup} className="space-y-4">
                <div>
                  <label htmlFor="topupAmount" className="block text-sm font-medium text-text-main mb-1.5">Amount ({currencySymbol} in units)</label>
                  <input
                    type="number"
                    id="topupAmount"
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                    placeholder="10.00"
                    step="0.01"
                    min={minTopupUnits > 0 ? minTopupUnits.toFixed(2) : "0.01"}
                    required
                    className="w-full prism-input rounded-xl px-4 py-2.5 text-sm"
                  />
                  {minTopupUnits > 0 && (
                    <p className="text-xs text-text-muted mt-1.5">Minimum top-up amount: {formatCp(config?.minTopupCp || 0, { symbol: currencySymbol, cpPerUnit })}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="topupMethod" className="block text-sm font-medium text-text-main mb-1.5">Payment Method</label>
                  <select
                    id="topupMethod"
                    value={topupMethod}
                    onChange={(e) => setTopupMethod(e.target.value)}
                    className="w-full prism-input rounded-xl px-4 py-2.5 text-sm"
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="qris">QRIS / E-wallet</option>
                    <option value="paypal">PayPal</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="topupRef" className="block text-sm font-medium text-text-main mb-1.5">Reference / Transaction ID (optional)</label>
                  <input
                    type="text"
                    id="topupRef"
                    value={topupRef}
                    onChange={(e) => setTopupRef(e.target.value)}
                    placeholder="Payment Ref #12345"
                    className="w-full prism-input rounded-xl px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="topupNote" className="block text-sm font-medium text-text-main mb-1.5">Notes (optional)</label>
                  <textarea
                    id="topupNote"
                    value={topupNote}
                    onChange={(e) => setTopupNote(e.target.value)}
                    placeholder="Any additional details for the admin..."
                    rows="3"
                    className="w-full prism-input rounded-xl px-4 py-2.5 text-sm"
                  ></textarea>
                </div>
                <button
                  type="submit"
                  disabled={busy || parseFloat(topupAmount) <= 0}
                  className="w-full prism-btn-primary disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition shadow-lg shadow-brand-500/20"
                >
                  {busy ? "Submitting..." : "Request Top-up"}
                </button>
              </form>
            </div>

            {/* My top-up requests */}
            <div className="prism-card overflow-hidden">
              <div className="px-5 py-3 border-b border-prism-hairline text-xs uppercase tracking-wider text-text-muted bg-prism-panel-soft">
                My top-up requests
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-prism-hairline text-text-muted text-xs uppercase tracking-wider">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Method / Ref</th>
                    <th className="px-5 py-3">Note</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-prism-hairline text-sm">
                  {myTopups.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-text-muted">No top-up requests yet.</td>
                    </tr>
                  ) : (
                    myTopups.map((t) => (
                      <tr key={t.id} className="hover:bg-prism-panel-soft transition">
                        <td className="px-5 py-3 text-text-muted text-xs">{formatDate(t.createdAt)}</td>
                        <td className="px-5 py-3 text-xs font-mono text-text-muted">{t.method || "—"}{t.reference ? ` · ${t.reference}` : ""}</td>
                        <td className="px-5 py-3 text-text-muted text-xs">{t.note || t.adminNote || "—"}</td>
                        <td className="px-5 py-3 text-right font-mono font-medium text-emerald-400">+{formatCp(t.amountCp, { symbol: currencySymbol, cpPerUnit })}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            t.status === "completed" ? "bg-emerald-950/30 text-emerald-400" :
                            t.status === "pending" ? "bg-amber-950/30 text-amber-400 border border-amber-800/60" :
                            "bg-red-950/30 text-danger"
                          }`}>
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
