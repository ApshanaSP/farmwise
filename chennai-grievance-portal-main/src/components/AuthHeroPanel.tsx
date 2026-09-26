import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import Logo from "@/components/Logo";

interface AuthHeroPanelProps {
  eyebrow: string;
  title: ReactNode;
  description: string;
  points: { icon: LucideIcon; label: string }[];
  stats?: { value: string; label: string }[];
}

export default function AuthHeroPanel({ eyebrow, title, description, points, stats }: AuthHeroPanelProps) {
  return (
    <div className="mesh-navy grain relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex">
      {/* Ambient light blobs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 animate-drift rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-gold-500/15 blur-3xl"
      />

      <div className="relative z-10">
        <Logo className="h-12 w-12" tone="white" />
        <p className="eyebrow mt-9 text-gold-300">{eyebrow}</p>
        <h2 className="mt-3 text-balance text-[2rem] font-extrabold leading-[1.12]">{title}</h2>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-navy-100">{description}</p>
      </div>

      <ul className="relative z-10 mt-10 space-y-3">
        {points.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-3 text-sm text-navy-100">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 shadow-inset ring-1 ring-inset ring-white/15"
            >
              <Icon className="h-4 w-4 text-gold-300" />
            </span>
            {label}
          </li>
        ))}
      </ul>

      {stats && (
        <div className="relative z-10 mt-10 grid grid-cols-3 gap-3 border-t border-white/15 pt-6">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="font-display text-xl font-bold tabular-nums text-white">{s.value}</p>
              <p className="mt-0.5 text-2xs uppercase tracking-wide text-navy-200">{s.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
