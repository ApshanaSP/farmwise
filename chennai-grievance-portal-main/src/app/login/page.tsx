"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Route,
  ShieldCheck
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AuthHeroPanel from "@/components/AuthHeroPanel";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const successMessage = searchParams.get("registered")
    ? "Account created. Sign in to continue."
    : null;

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
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6">
      <div className="grid w-full animate-fade-up overflow-hidden rounded-3xl border border-canvas-border bg-white shadow-lift lg:grid-cols-[1.1fr_1fr]">
        <AuthHeroPanel
          eyebrow="Greater Chennai Corporation"
          title={
            <>
              Civic issues,
              <br />
              resolved faster.
            </>
          }
          description="One portal for citizens, department officers and the District Collectorate — file a grievance, watch it move, see it closed."
          points={[
            { icon: MapPin, label: "Pinpoint the issue on a live map" },
            { icon: Route, label: "Auto-routed to the right department" },
            { icon: ShieldCheck, label: "Encrypted, access-controlled records" }
          ]}
          stats={[
            { value: "15", label: "Zones" },
            { value: "16", label: "Departments" },
            { value: "24×7", label: "Helpline" }
          ]}
        />

        {/* Form side */}
        <div className="p-7 sm:p-10">
          <div className="mb-8">
            <h1 className="text-[1.75rem] font-extrabold leading-tight text-ink">Welcome back</h1>
            <p className="mt-1.5 text-sm text-ink-muted">Sign in to access citizen services.</p>
          </div>

          {successMessage && (
            <div role="status" className="alert-success mb-5 animate-scale-in">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>{successMessage}</span>
            </div>
          )}
          {error && (
            <div role="alert" className="alert-error mb-5 animate-scale-in">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="group">
              <label htmlFor="email" className="form-label">
                Email address
              </label>
              <div className="relative">
                <span className="input-affix group-focus-within:text-navy-500">
                  <Mail className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="username"
                  className="form-input pl-10"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="group">
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="form-label">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="mb-1.5 text-xs font-semibold text-navy transition hover:text-navy-700 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <span className="input-affix group-focus-within:text-navy-500">
                  <Lock className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  className="form-input pl-10 pr-11"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ink-faint transition hover:text-navy focus-visible:ring-4 focus-visible:ring-navy-600/20"
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={submitting} className="btn-primary group w-full py-3 text-[15px]">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </>
              )}
            </button>
          </form>

          <p className="mt-7 border-t border-canvas-border pt-5 text-center text-sm text-ink-muted">
            New to the portal?{" "}
            <Link href="/register" className="font-semibold text-navy transition hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <div className="dotted-canvas flex min-h-screen flex-col bg-canvas">
      <Header />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <Footer />
    </div>
  );
}
