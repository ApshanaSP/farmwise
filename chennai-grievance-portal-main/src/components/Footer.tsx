import Logo from "@/components/Logo";

export default function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="mt-auto border-t border-canvas-border bg-white/80 backdrop-blur">
      <div
        className={`mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left ${
          compact ? "py-2.5" : "py-6"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Logo className={compact ? "h-6 w-6" : "h-8 w-8"} />
          <p className="text-[13px] text-ink-muted">
            <span className="font-display font-bold text-ink">District IQ</span> &middot; Chennai Intelligent District Governance
            Platform
          </p>
        </div>
        <p className="text-[13px] text-ink-subtle">
          Helpline <span className="font-semibold text-ink">1913</span> &middot; 24&times;7 &middot; &copy; {new Date().getFullYear()}{" "}
          District Administration, Chennai
        </p>
      </div>
    </footer>
  );
}
