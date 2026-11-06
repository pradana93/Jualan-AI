"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import PrismMark from "@/shared/components/PrismMark";
import { BRAND } from "@/shared/constants/brand";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  // Check if already logged in as admin
  useEffect(() => {
    async function checkAdminStatus() {
      try {
        const res = await fetch("/api/reseller/admin/summary", { cache: "no-store" });
        if (res.ok) {
          router.replace("/dashboard/reseller");
        }
      } catch (err) {
        console.error("Error checking admin status:", err);
      }
    }
    checkAdminStatus();
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (res.ok) {
        router.replace("/dashboard/reseller");
      } else {
        const data = await res.json();
        setError(data.error || "Invalid credentials");
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen prism-shell text-white relative overflow-hidden flex items-center justify-center p-4">
      <div className="prism-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="prism-orb w-[420px] h-[420px] bg-accent-magenta/15 top-[-100px] right-[-100px]" />
      <div className="prism-orb w-[480px] h-[480px] bg-brand-600/20 bottom-[-120px] left-[-120px]" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-5">
            <div className="prism-sheen relative rounded-2xl p-1.5 shadow-lg shadow-brand-500/40">
              <PrismMark size={48} />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2 tracking-tight">
            {BRAND.nameLead}<span className="text-prism-gradient">{BRAND.nameTail}</span> Admin
          </h1>
          <p className="text-sm text-text-muted max-w-xs mx-auto">
            Platform operator console — restricted to authorised administrators.
          </p>
        </div>

        <div className="prism-panel rounded-3xl p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-muted">Employee Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                autoFocus
                className="w-full rounded-xl prism-input px-4 py-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-muted">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl prism-input px-4 py-3 text-sm"
              />
              {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
              {retryAfter > 0 && (
                <p className="text-xs text-amber-400">
                  Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={retryAfter > 0 || loading}
              className="w-full prism-btn-primary py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50 shadow-lg shadow-brand-500/30"
            >
              {loading ? "Authenticating…" : retryAfter > 0 ? `Wait ${retryAfter}s` : "Access Admin Console"}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center text-xs text-text-muted">
          Not a platform operator?{" "}
          <a href="/signin" className="font-medium text-accent-cyan hover:underline">
            Go to Customer Portal
          </a>
        </div>
      </div>
    </div>
  );
}
