import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

const AUTH_COOKIE_NAME = "dcd_session";

// Routes that require a logged-in session, and which roles may access them.
const PROTECTED_PREFIXES: { prefix: string; roles: string[] }[] = [
  { prefix: "/citizen", roles: ["citizen"] },
  { prefix: "/officer", roles: ["department_officer"] },
  { prefix: "/collector", roles: ["collector"] },
  { prefix: "/profile", roles: ["citizen", "department_officer", "collector"] }
];

const PUBLIC_ONLY_PREFIXES = ["/login", "/register", "/forgot-password"];

function roleHome(role: string): string {
  if (role === "citizen") return "/citizen";
  if (role === "department_officer") return "/officer";
  if (role === "collector") return "/collector";
  return "/login";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;

  const matchedProtected = PROTECTED_PREFIXES.find((p) => pathname.startsWith(p.prefix));

  if (matchedProtected) {
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }
    if (!matchedProtected.roles.includes(session.role)) {
      const url = request.nextUrl.clone();
      url.pathname = roleHome(session.role);
      return NextResponse.redirect(url);
    }
  }

  if (session && PUBLIC_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = roleHome(session.role);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/citizen/:path*",
    "/officer/:path*",
    "/collector/:path*",
    "/profile/:path*",
    "/login",
    "/register",
    "/forgot-password"
  ]
};
