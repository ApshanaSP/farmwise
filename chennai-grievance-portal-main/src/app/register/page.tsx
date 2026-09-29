"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, FormEvent } from "react";
import { AlertCircle, ArrowRight, Building2, Check, Eye, EyeOff, Loader2, User, Wrench } from "lucide-react";
import AuthShell from "@/components/AuthShell";
import { checkPasswordRules, passwordStrengthScore } from "@/lib/validators";

interface Department {
  id: number;
  name: string;
}

type Role = "" | "collector" | "department_officer" | "citizen";

const ROLE_OPTIONS = [
  { value: "citizen", label: "Citizen", icon: User },
  { value: "department_officer", label: "Dept. officer", icon: Wrench },
  { value: "collector", label: "Collector", icon: Building2 }
] as const;

export default function RegisterPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<Role>("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments || []))
      .catch(() => setDepartments([]));
  }, []);

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!role) return setError("Please choose who you are.");
    if (role === "department_officer" && !departmentId) return setError("Please select your department.");
    if (!firstName.trim()) return setError("Please enter your first name.");
    if (password !== confirmPassword) return setError("Passwords do not match.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          confirmPassword,
          firstName,
          lastName,
          role,
          departmentId: role === "department_officer" ? Number(departmentId) : null
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setSubmitting(false);
        return;
      }
      router.push("/login?registered=1");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell headline={<>One account. The right dashboard for your role.</>}>
      <div className="mx-auto w-full max-w-[480px]">
        <h1 className="font-display text-[1.75rem] font-extrabold leading-tight tracking-tight text-ink">Create your account</h1>
        <p className="mt-1 text-[15px] text-ink-muted">Takes under a minute. Choose who you are to begin.</p>

        {error && (
          <div role="alert" className="alert-error mt-3 animate-scale-in py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-3.5">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="I am a">
            {ROLE_OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = role === value;
              return (
                <button key={value} type="button" role="radio" aria-checked={active} onClick={() => setRole(value)}
                  className={`relative flex h-12 items-center justify-center gap-2 rounded-xl border px-2 text-[14px] font-semibold transition-all duration-200 ease-spring ${
                    active
                      ? "border-navy-500 bg-navy-50 text-navy-600 shadow-glow"
                      : "border-canvas-border bg-canvas/60 text-ink-muted hover:border-navy-200 hover:text-navy-600"
                  }`}>
                  <Icon className="h-[18px] w-[18px] flex-none" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                  {active && (
                    <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-navy-500 text-white ring-2 ring-white">
                      <Check className="h-3 w-3" strokeWidth={3.5} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className="auth-label">First name</label>
              <input id="firstName" type="text" required autoComplete="given-name" className="auth-input" placeholder="Arjun"
                value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="lastName" className="auth-label">Last name <span className="font-normal text-ink-faint">(optional)</span></label>
              <input id="lastName" type="text" autoComplete="family-name" className="auth-input" placeholder="Kumar"
                value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div className={role === "department_officer" ? "grid grid-cols-2 gap-3" : ""}>
            <div>
              <label htmlFor="email" className="auth-label">Email address</label>
              <input id="email" type="email" required autoComplete="email" className="auth-input" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {role === "department_officer" && (
              <div className="animate-fade-in">
                <label htmlFor="department" className="auth-label">Department</label>
                <select id="department" required className="auth-input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">Select</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="password" className="auth-label">Password</label>
              <div className="relative">
                <input id="password" type={showPassword ? "text" : "password"} required autoComplete="new-password"
                  className="auth-input pr-11" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-faint transition hover:text-navy">
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="auth-label">Confirm password</label>
              <div className="relative">
                <input id="confirmPassword" type={showPassword ? "text" : "password"} required autoComplete="new-password"
                  className={`auth-input pr-11 ${confirmPassword && !passwordsMatch ? "border-red-300" : ""}`}
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                {passwordsMatch && (
                  <span aria-hidden="true" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-emerald-600">
                    <Check className="h-[18px] w-[18px]" strokeWidth={3} />
                  </span>
                )}
              </div>
            </div>
          </div>

          <StrengthLine password={password} />

          <button type="submit" disabled={submitting} className="auth-submit group">
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                Creating account...
              </>
            ) : (
              <>
                Create account
                <ArrowRight className="h-5 w-5 transition-transform duration-200 ease-spring group-hover:translate-x-0.5" aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <p className="mt-4 text-center text-[15px] text-ink-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-navy-500 transition hover:underline">Sign in</Link>
        </p>
      </div>
    </AuthShell>
  );
}

/** Password rules as a single row of ticks, so the form keeps its height as you type. */
function StrengthLine({ password }: { password: string }) {
  const rules = checkPasswordRules(password);
  const score = passwordStrengthScore(password);
  const passed = rules.filter((r) => r.passed).length;
  const tone = !password ? "bg-canvas-sunken" : score >= 100 ? "bg-emerald-500" : score >= 60 ? "bg-gold-400" : "bg-red-500";
  const short: Record<string, string> = {
    "At least 8 characters": "8+ chars", "One uppercase letter": "A–Z", "One lowercase letter": "a–z",
    "One number": "0–9", "One special character": "symbol", "No spaces": "no spaces"
  };
  return (
    <div aria-live="polite">
      <div className="flex gap-1">
        {rules.map((r, i) => (
          <span key={r.label} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i < passed ? tone : "bg-canvas-sunken"}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
        {rules.map((r) => (
          <span key={r.label} title={r.label} className={`inline-flex items-center gap-1 ${r.passed ? "text-emerald-600" : "text-ink-subtle"}`}>
            <Check className={`h-3.5 w-3.5 ${r.passed ? "" : "opacity-30"}`} strokeWidth={3} aria-hidden="true" />
            {short[r.label] ?? r.label}
          </span>
        ))}
      </div>
    </div>
  );
}
