"use client";

import { Check } from "lucide-react";
import { checkPasswordRules, passwordStrengthScore } from "@/lib/validators";

export default function PasswordStrengthMeter({ password }: { password: string }) {
  const rules = checkPasswordRules(password);
  const score = passwordStrengthScore(password);

  if (password.length === 0) return null;

  const passedCount = rules.filter((r) => r.passed).length;
  const tone =
    score >= 100
      ? { bar: "bg-emerald-500", text: "text-emerald-600", label: "Strong" }
      : score >= 60
        ? { bar: "bg-gold-400", text: "text-gold-600", label: "Medium" }
        : { bar: "bg-red-500", text: "text-red-600", label: "Weak" };

  return (
    <div className="mt-3" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {rules.map((rule, i) => (
            <span
              key={rule.label}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i < passedCount ? tone.bar : "bg-canvas-sunken"
              }`}
            />
          ))}
        </div>
        <span className={`text-2xs font-bold uppercase tracking-wide ${tone.text}`}>{tone.label}</span>
      </div>

      <ul className="mt-2.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {rules.map((rule) => (
          <li
            key={rule.label}
            className={`flex items-center gap-1.5 text-[11px] transition-colors ${
              rule.passed ? "text-emerald-600" : "text-ink-faint"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                rule.passed ? "bg-emerald-100" : "bg-canvas-sunken"
              }`}
            >
              {rule.passed && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
            </span>
            {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
