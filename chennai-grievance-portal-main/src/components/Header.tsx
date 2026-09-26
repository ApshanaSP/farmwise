"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Logo from "@/components/Logo";

export interface HeaderNavItem {
  href: string;
  label: string;
}

interface HeaderProps {
  userName?: string | null;
  homeHref?: string;
  /**
   * Primary destinations for the signed-in role. The citizen landing page no
   * longer repeats "File a complaint" / "Track status" in its body, so these
   * links are how those pages are reached.
   */
  nav?: HeaderNavItem[];
}

export default function Header({ userName, homeHref = "/", nav = [] }: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-all duration-300 ${
        scrolled
          ? "border-canvas-border bg-white/85 shadow-soft backdrop-blur-xl"
          : "border-transparent bg-white/60 backdrop-blur-md"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={homeHref} className="group flex items-center gap-3">
          <Logo className="h-10 w-10 transition-transform duration-300 ease-spring group-hover:scale-105" />
          <span className="leading-tight">
            <span className="block font-display text-sm font-bold text-ink sm:text-[15px]">
              District Collectorate &ndash; Chennai
            </span>
            <span className="block text-2xs tracking-wide text-ink-subtle">
              Public Grievance Redressal Portal
            </span>
          </span>
        </Link>

        {nav.length > 0 && (
          <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
            {nav.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-navy-50 text-navy"
                      : "text-ink-muted hover:bg-navy-50/60 hover:text-navy"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        )}

        {userName !== undefined && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-2 rounded-xl border border-canvas-border bg-white py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-ink shadow-xs transition hover:border-navy-200 hover:shadow-soft focus-visible:ring-4 focus-visible:ring-navy-600/20"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-navy text-xs font-bold text-white"
              >
                {(userName || "U").charAt(0).toUpperCase()}
              </span>
              <span className="hidden max-w-[160px] truncate sm:inline">{userName || "My Account"}</span>
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 text-ink-subtle transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-2 w-56 origin-top-right animate-scale-in overflow-hidden rounded-2xl border border-canvas-border bg-white p-1.5 shadow-lift"
              >
                {nav.length > 0 && (
                  <div className="sm:hidden">
                    {nav.map(({ href, label }) => (
                      <Link
                        key={href}
                        href={href}
                        role="menuitem"
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-navy-50 hover:text-navy"
                        onClick={() => setMenuOpen(false)}
                      >
                        {label}
                      </Link>
                    ))}
                    <div className="my-1.5 border-t border-canvas-border" />
                  </div>
                )}
                <Link
                  href="/profile"
                  role="menuitem"
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-navy-50 hover:text-navy"
                  onClick={() => setMenuOpen(false)}
                >
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  My Profile
                </Link>
                <button
                  role="menuitem"
                  type="button"
                  disabled={loggingOut}
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {loggingOut ? "Logging out..." : "Logout"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
