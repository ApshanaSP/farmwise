"use client";

import Link from "next/link";
import { useState, FormEvent } from "react";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";

type Step = 1 | 2 | 3 | 4;

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setSubmitting(false);
        return;
      }
      setInfo(data.message);
      if (data.devOtp) setDevOtp(data.devOtp);
      if (data.cooldownRemaining) setCooldown(data.cooldownRemaining);
      setStep(2);
      setSubmitting(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid OTP.");
        setSubmitting(false);
        return;
      }
      setStep(3);
      setSubmitting(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, newPassword, confirmPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setSubmitting(false);
        return;
      }
      setStep(4);
      setSubmitting(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="dotted-canvas flex min-h-screen flex-col bg-canvas">
      <Header />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <div className="card animate-fade-up">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy">
              {step === 4 ? <CheckCircle2 className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
            </span>
            <div>
              <h1 className="text-xl font-bold text-ink">Forgot Password</h1>
              <p className="mt-0.5 text-sm text-ink-muted">
                {step === 1 && "Enter your registered email to receive an OTP."}
                {step === 2 && "Enter the 6-digit OTP sent to your email."}
                {step === 3 && "Choose a new password."}
                {step === 4 && "All done."}
              </p>
            </div>
          </div>

          {step < 4 && (
            <ol className="mb-6 flex gap-1.5" aria-label="Progress">
              {[1, 2, 3].map((n) => (
                <li
                  key={n}
                  className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                    step >= n ? "bg-navy" : "bg-canvas-sunken"
                  }`}
                />
              ))}
            </ol>
          )}

          {error && (
            <div role="alert" className="alert-error mb-5 animate-scale-in">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {info && step === 2 && (
            <div role="status" className="alert-success mb-5 animate-scale-in">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <div>
                {info}
                {devOtp && (
                  <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-sm font-bold text-navy">
                    [Dev mode] OTP: {devOtp}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 1 && (
            <form onSubmit={requestOtp} noValidate>
              <div className="mb-6">
                <label htmlFor="email" className="form-label">
                  Registered Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  className="form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button type="submit" disabled={submitting} className="btn-primary w-full">
                {submitting ? "Sending OTP..." : "Send OTP"}
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={verifyOtp} noValidate>
              <div className="mb-2">
                <label htmlFor="otp" className="form-label">
                  6-digit OTP
                </label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  className="form-input tracking-widest"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <button
                type="button"
                onClick={(e) => requestOtp(e as unknown as FormEvent)}
                disabled={submitting || cooldown > 0}
                className="mb-6 text-sm font-medium text-navy hover:underline disabled:text-gray-400 disabled:no-underline"
              >
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}
              </button>
              <button type="submit" disabled={submitting} className="btn-primary w-full">
                {submitting ? "Verifying..." : "Verify OTP"}
              </button>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={resetPassword} noValidate>
              <div className="mb-4">
                <label htmlFor="newPassword" className="form-label">
                  New Password
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  className="form-input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <PasswordStrengthMeter password={newPassword} />
              </div>
              <div className="mb-6">
                <label htmlFor="confirmPassword" className="form-label">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  className="form-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <button type="submit" disabled={submitting} className="btn-primary w-full">
                {submitting ? "Resetting..." : "Reset Password"}
              </button>
            </form>
          )}

          {step === 4 && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/50">
                <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="mb-6 text-sm text-ink-muted">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <Link href="/login" className="btn-primary inline-flex w-full">
                Go to Login
              </Link>
            </div>
          )}

          {step < 4 && (
            <p className="mt-6 text-center text-sm text-gray-600">
              Remembered your password?{" "}
              <Link href="/login" className="font-semibold text-navy hover:underline">
                Back to Login
              </Link>
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
