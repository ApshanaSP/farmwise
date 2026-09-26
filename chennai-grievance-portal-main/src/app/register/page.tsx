"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  Clock3,
  Eye,
  EyeOff,
  LayoutDashboard,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  Wrench
} from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AuthHeroPanel from "@/components/AuthHeroPanel";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";

interface Department {
  id: number;
  name: string;
}

type Role = "" | "collector" | "department_officer" | "citizen";

const ROLE_OPTIONS = [
  { value: "citizen", label: "Citizen", hint: "File & track complaints", icon: User },
  { value: "department_officer", label: "Dept. Officer", hint: "Resolve assigned tasks", icon: Wrench },
  { value: "collector", label: "Collector", hint: "Oversee & verify", icon: Building2 }
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

    if (!role) {
      setError("Please select a role.");
      return;
    }
    if (role === "department_officer" && !departmentId) {
      setError("Please select a department.");
      return;
    }
    if (!firstName.trim()) {
      setError("Please enter your first name.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

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
    <div className="dotted-canvas flex min-h-screen flex-col bg-canvas">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6">
        <div className="grid w-full animate-fade-up overflow-hidden rounded-3xl border border-canvas-border bg-white shadow-lift lg:grid-cols-[1.1fr_1fr]">
          <AuthHeroPanel
            eyebrow="Greater Chennai Corporation"
            title={
              <>
                One account,
                <br />
                your whole role.
              </>
            }
            description="Register once to file grievances, track resolutions, or manage department tasks — the dashboard adapts to who you are."
            points={[
              { icon: Clock3, label: "Free registration, under a minute" },
              { icon: LayoutDashboard, label: "Role-based dashboard on sign-in" },
              { icon: ShieldCheck, label: "Your data stays encrypted at rest" }
            ]}
          />

          {/* Form side */}
          <div className="p-7 sm:p-10">
            <div className="mb-7">
              <h1 className="text-[1.75rem] font-extrabold leading-tight text-ink">Create your account</h1>
              <p className="mt-1.5 text-sm text-ink-muted">It only takes a minute to get started.</p>
            </div>

            {error && (
              <div role="alert" className="alert-error mb-5 animate-scale-in">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <span className="form-label">I am a</span>
                <div className="grid grid-cols-3 gap-2.5">
                  {ROLE_OPTIONS.map(({ value, label, hint, icon: Icon }) => {
                    const active = role === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setRole(value)}
                        aria-pressed={active}
                        className={`group relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-all duration-200 ease-spring ${
                          active
                            ? "-translate-y-0.5 border-navy bg-navy-50 shadow-glow"
                            : "border-canvas-border hover:-translate-y-0.5 hover:border-navy-200 hover:bg-navy-50/50 hover:shadow-xs"
                        }`}
                      >
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-navy text-white"
                          >
                            <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                          </span>
                        )}
                        <Icon
                          className={`h-5 w-5 transition-colors ${active ? "text-navy" : "text-ink-subtle group-hover:text-navy-500"}`}
                          aria-hidden="true"
                        />
                        <span className={`text-xs font-bold ${active ? "text-navy" : "text-ink"}`}>{label}</span>
                        <span className="hidden text-[10px] leading-tight text-ink-subtle sm:block">{hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {role === "department_officer" && (
                <div className="animate-fade-up">
                  <label htmlFor="department" className="form-label">
                    Department
                  </label>
                  <select
                    id="department"
                    required
                    className="form-input"
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                  >
                    <option value="">Select a department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="group">
                  <label htmlFor="firstName" className="form-label">
                    First name
                  </label>
                  <div className="relative">
                    <span className="input-affix group-focus-within:text-navy-500">
                      <User className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <input
                      id="firstName"
                      type="text"
                      required
                      autoComplete="given-name"
                      className="form-input pl-10"
                      placeholder="Arjun"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="group">
                  <label htmlFor="lastName" className="form-label">
                    Last name <span className="normal-case text-ink-faint">(optional)</span>
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    autoComplete="family-name"
                    className="form-input"
                    placeholder="Kumar"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

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
                    autoComplete="email"
                    className="form-input pl-10"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="group">
                <label htmlFor="password" className="form-label">
                  Password
                </label>
                <div className="relative">
                  <span className="input-affix group-focus-within:text-navy-500">
                    <Lock className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    className="form-input pl-10 pr-11"
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
                <PasswordStrengthMeter password={password} />
              </div>

              <div className="group">
                <label htmlFor="confirmPassword" className="form-label">
                  Confirm password
                </label>
                <div className="relative">
                  <span className="input-affix group-focus-within:text-navy-500">
                    <Lock className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    className="form-input pl-10 pr-11"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  {passwordsMatch && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 right-0 flex w-11 animate-scale-in items-center justify-center text-emerald-600"
                    >
                      <Check className="h-[18px] w-[18px]" strokeWidth={3} />
                    </span>
                  )}
                </div>
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="form-error">
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Passwords do not match.
                  </p>
                )}
              </div>

              <button type="submit" disabled={submitting} className="btn-primary group w-full py-3 text-[15px]">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Creating account...
                  </>
                ) : (
                  <>
                    Create account
                    <ArrowRight
                      className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>
            </form>

            <p className="mt-7 border-t border-canvas-border pt-5 text-center text-sm text-ink-muted">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-navy transition hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
