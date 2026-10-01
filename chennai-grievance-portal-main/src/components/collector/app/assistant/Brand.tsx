"use client";

/**
 * District IQ's mark: a squircle in the console's blues with three rising bars and a spark (the district's data,
 * rising into insight). Used on the launcher, the panel header, the empty state and beside each answer.
 */
import { useId } from "react";

export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  const g = `dq${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg className={`aq-mark ${className}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0B2A78" />
          <stop offset=".55" stopColor="#1560E8" />
          <stop offset="1" stopColor="#3FA9F5" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11.5" fill={`url(#${g})`} />
      <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="none" stroke="#fff" strokeOpacity=".16" />
      <rect x="9.5" y="21" width="4.6" height="9.5" rx="2.3" fill="#fff" fillOpacity=".62" />
      <rect x="17.2" y="15.5" width="4.6" height="15" rx="2.3" fill="#fff" fillOpacity=".82" />
      <rect x="24.9" y="10.5" width="4.6" height="20" rx="2.3" fill="#fff" />
      <path d="M32 5.2l1.05 2.75 2.75 1.05-2.75 1.05L32 12.8l-1.05-2.75-2.75-1.05 2.75-1.05z" fill="#FFD66B" />
    </svg>
  );
}
