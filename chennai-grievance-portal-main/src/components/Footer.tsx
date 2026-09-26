import Logo from "@/components/Logo";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-canvas-border bg-white">
      <div className="mx-auto max-w-6xl px-4 py-9 sm:px-6">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-3">
            <Logo className="h-9 w-9" />
            <div>
              <p className="font-display text-sm font-bold text-ink">District Collectorate, Chennai</p>
              <p className="text-xs text-ink-subtle">Public Grievance Redressal Portal</p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-1 sm:items-end">
            <p className="text-xs text-ink-subtle">
              Helpline <span className="font-semibold text-ink">1913</span> &middot; Available 24&times;7
            </p>
            <p className="text-2xs text-ink-faint">
              &copy; {new Date().getFullYear()} Greater Chennai Corporation. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
