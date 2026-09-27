import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/lib/auth";
import CollectorApp from "@/components/collector/app/CollectorApp";
import { deptList, overview } from "@/lib/collector/intel";
import { mapShapes } from "@/lib/collector/geo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Collector Console · Chennai District" };

// Loaded by the browser, as in the design: next/font would fetch at build time, which some
// networks (TLS inspection) block. The CSS falls back to system fonts if this cannot load.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap";

export default async function CollectorPage() {
  const session = await getSessionFromCookies();
  if (!session || session.role !== "collector") redirect("/login");

  try {
    const [initial, shapes, depts] = await Promise.all([overview("daily", null), mapShapes(), deptList()]);
    return (
      <>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
        <CollectorApp initial={initial} shapes={shapes} allDepts={depts} user={session.email} />
      </>
    );
  } catch (err: any) {
    console.error("collector console failed to load", err);
    const missing = err?.code === "ER_BAD_DB_ERROR" || err?.code === "ER_NO_SUCH_TABLE";
    return (
      <main style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 20 }}>Collector console unavailable</h1>
        <p>
          {missing
            ? "The district intelligence store is not in MySQL yet. In district_intel, run: python run_pipeline.py mysql"
            : "The district intelligence store could not be read. Check that MySQL is running."}
        </p>
      </main>
    );
  }
}
