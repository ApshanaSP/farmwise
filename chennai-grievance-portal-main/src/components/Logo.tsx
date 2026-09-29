interface LogoProps {
  className?: string;
  tone?: "navy" | "white";
}

/** District IQ mark: a location pin built from a data node, ringed by an orbit. */
export default function Logo({ className = "h-10 w-10", tone = "navy" }: LogoProps) {
  const id = tone === "navy" ? "diq-n" : "diq-w";
  const onNavy = tone === "navy";
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="District IQ">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={onNavy ? "#0B3D91" : "#FFFFFF"} />
          <stop offset="1" stopColor={onNavy ? "#1F6BEA" : "#E6EEFC"} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id})`} />
      <ellipse cx="24" cy="25" rx="16.5" ry="7" fill="none" stroke={onNavy ? "#EBBE60" : "#C8891B"} strokeWidth="1.8"
        transform="rotate(-22 24 25)" opacity=".95" />
      <path d="M24 9.5c-5.2 0-9.3 4-9.3 9.1 0 6.6 9.3 17.4 9.3 17.4s9.3-10.8 9.3-17.4c0-5.1-4.1-9.1-9.3-9.1Z"
        fill={onNavy ? "#FFFFFF" : "#0B3D91"} />
      <circle cx="24" cy="18.6" r="3.6" fill={onNavy ? "#1F6BEA" : "#FFFFFF"} />
      <circle cx="24" cy="18.6" r="1.4" fill={onNavy ? "#FFFFFF" : "#0B3D91"} />
    </svg>
  );
}
