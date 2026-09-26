interface LogoProps {
  className?: string;
  tone?: "navy" | "white";
}

export default function Logo({ className = "h-10 w-10", tone = "navy" }: LogoProps) {
  const bg = tone === "navy" ? "#0B3D91" : "#FFFFFF";
  const fg = tone === "navy" ? "#FFFFFF" : "#0B3D91";
  const accent = tone === "navy" ? "#EBBE60" : "#C8891B";

  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Greater Chennai Corporation">
      <rect width="48" height="48" rx="13" fill={bg} />
      {/* Government building: dome, columns, steps */}
      <path d="M24 10.5c2.6 0 4.7 2 4.7 4.5h-9.4c0-2.5 2.1-4.5 4.7-4.5Z" fill={accent} />
      <rect x="13" y="16.4" width="22" height="2.5" rx="1.25" fill={fg} />
      <rect x="16.2" y="20.4" width="2.8" height="11" rx="1.4" fill={fg} />
      <rect x="22.6" y="20.4" width="2.8" height="11" rx="1.4" fill={fg} />
      <rect x="29" y="20.4" width="2.8" height="11" rx="1.4" fill={fg} />
      <rect x="11.5" y="33.2" width="25" height="2.6" rx="1.3" fill={fg} />
      <rect x="9.5" y="37" width="29" height="2.6" rx="1.3" fill={accent} />
    </svg>
  );
}
