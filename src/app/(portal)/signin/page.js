"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resellerApi } from "@/app/(portal)/_lib/api";
import { useSession } from "@/app/(portal)/_lib/SessionProvider";
import PrismMark from "@/shared/components/PrismMark";
import { BRAND, KEY_PREFIX_LABEL } from "@/shared/constants/brand";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, config, loading, refresh } = useSession();

  const [mode, setMode] = useState(params.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const allowSignup = config?.allowSignup !== false;
  const showSignup = mode === "signup" && allowSignup;

  // Already signed in? Go straight to the portal.
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (showSignup) {
        await resellerApi.register(email.trim(), password, name.trim());
      } else {
        await resellerApi.login(email.trim(), password);
      }
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen prism-shell text-white relative overflow-hidden flex items-center justify-center p-4">
      <div className="prism-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="prism-orb w-[500px] h-[500px] bg-brand-600/25 top-[-100px] left-[-100px]" />
      <div className="prism-orb w-[400px] h-[400px] bg-accent-cyan/20 bottom-[-100px] right-[-100px]" />

      <div className="relative z-10 mx-auto grid max-w-6xl w-full items-center gap-12 py-10 lg:grid-cols-2 lg:py-16 px-4">
        {/* Brand / value proposition */}
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <PrismMark size={42} className="shadow-lg shadow-brand-500/30" />
            <div>
              <div className="text-lg font-semibold leading-tight">{BRAND.nameLead}<span className="text-accent-cyan">{BRAND.nameTail}</span> Portal</div>
              <div className="text-xs text-text-muted">{BRAND.tagline}</div>
            </div>
          </div>

          <h1 className="text-4xl font-bold leading-tight tracking-tight lg:text-5xl text-prism-gradient">
            One gateway for <span className="text-accent-cyan">every AI model</span>. Pay per token
            in credit points.
          </h1>

          <p className="max-w-md leading-relaxed text-text-muted">
            Get an{" "}
            <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[13px] text-accent-cyan">{KEY_PREFIX_LABEL}...</code>{" "}
            key, point it at any OpenAI-compatible SDK and route to Claude, GPT, Gemini and more —
            billed per request against your credit balance.
          </p>

          <div className="grid max-w-lg grid-cols-2 gap-3">
            {[
              {
                icon: "bolt",
                title: "OpenAI-compatible",
                desc: "Drop-in base URL for /v1 chat, embeddings, images & audio",
              },
              {
                icon: "paid",
                title: "Transparent billing",
                desc: "Pay per million tokens with integer credit points",
              },
              {
                icon: "speed",
                title: "Rate-limit aware",
                desc: "Per-key RPM limits, revocable in one click",
              },
              {
                icon: "receipt_long",
                title: "Full ledger",
                desc: "Every call metered and itemised with its exact cost",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="prism-card p-4"
              >
                <span className="material-symbols-outlined text-xl text-accent-cyan">{f.icon}</span>
                <div className="mt-2 text-sm font-medium text-text-main">{f.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-text-muted">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Auth card */}
        <div className="w-full max-w-md justify-self-center">
          <div className="prism-panel rounded-3xl p-8 shadow-2xl relative overflow-hidden">
            <div className="prism-sheen absolute inset-0 pointer-events-none" />
            <div className="relative z-10">
              {allowSignup && (
                <div className="mb-6 flex gap-1 rounded-xl bg-black/30 p-1 border border-prism-hairline">
                  {["signin", "signup"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMode(m);
                        setError("");
                      }}
                      className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                        mode === m
                          ? "bg-accent-cyan/15 text-accent-cyan font-semibold border border-accent-cyan/30"
                          : "text-text-muted hover:text-text-main"
                      }`}
                    >
                      {m === "signin" ? "Sign In" : "Create Account"}
                    </button>
                  ))}
                </div>
              )}

              <h2 className="mb-4 text-xl font-bold text-text-main">
                {showSignup ? "Create your account" : "Sign in to your portal"}
              </h2>

              {error && (
                <div className="mb-4 rounded-xl border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {showSignup && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-muted">
                      Name (optional)
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Adi Pratama"
                      className="w-full rounded-xl prism-input px-4 py-2.5 text-sm"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-muted">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl prism-input px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-muted">Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl prism-input px-4 py-2.5 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full prism-btn-primary py-3 text-sm font-semibold text-white rounded-xl transition disabled:opacity-50 shadow-lg shadow-brand-500/30"
                >
                  {busy ? "Please wait…" : showSignup ? "Create Account" : "Sign In"}
                </button>
              </form>

              <p className="mt-6 text-center text-[11px] leading-relaxed text-text-subtle">
                By continuing you agree that API usage is metered and debited from your credit
                balance.
              </p>
            </div>
          </div>

          <div className="mt-4 text-center text-xs text-text-muted">
            Platform operator?{" "}
            <a href="/admin/login" className="font-medium text-accent-cyan hover:underline">
              Admin console sign-in
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center prism-shell text-text-muted">
          Loading…
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
