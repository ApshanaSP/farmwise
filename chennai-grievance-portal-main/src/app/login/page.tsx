"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, FormEvent } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import AuthShell from "@/components/AuthShell";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const successMessage = searchParams.get("registered") ? "Account created. Sign in to continue." : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid email or password.");
        setSubmitting(false);
        return;
      }
      router.push(data.redirectTo || "/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[420px]">
      <h1 className="font-display text-[2rem] font-extrabold leading-tight tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1.5 text-[15px] text-ink-muted">
        Sign in with your District IQ account. You&apos;ll land on the dashboard for your role.
      </p>

      <div className="mt-6 space-y-3">
        {successMessage && (
          <div role="status" className="alert-success animate-scale-in">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{successMessage}</span>
          </div>
        )}
        {error && (
          <div role="alert" className="alert-error animate-scale-in">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-2 space-y-4">
        <div className="group">
          <label htmlFor="email" className="auth-label">Email address</label>
          <div className="relative">
            <span className="input-affix group-focus-within:text-navy-500">
              <Mail className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <input id="email" type="email" required autoComplete="username" className="auth-input pl-11"
              placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>

        <div className="group">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="auth-label">Password</label>
            <Link href="/forgot-password" className="text-[13px] font-semibold text-navy-500 transition hover:text-navy-700 hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <span className="input-affix group-focus-within:text-navy-500">
              <Lock className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <input id="password" type={showPassword ? "text" : "password"} required autoComplete="current-password"
              className="auth-input pl-11 pr-12" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-ink-faint transition hover:text-navy">
              {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={submitting} className="auth-submit group">
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <ArrowRight className="h-5 w-5 transition-transform duration-200 ease-spring group-hover:translate-x-0.5" aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <p className="mt-5 flex items-center gap-2 rounded-xl bg-canvas-sunken/70 px-3.5 py-2.5 text-[13px] text-ink-muted">
        <ShieldCheck className="h-4 w-4 flex-none text-emerald-600" aria-hidden="true" />
        One sign-in for citizens, department officers and the Collector&apos;s office.
      </p>

      <p className="mt-5 text-center text-[15px] text-ink-muted">
        New to District IQ?{" "}
        <Link href="/register" className="font-semibold text-navy-500 transition hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthShell headline={<>Intelligence for every desk of the district.</>}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
