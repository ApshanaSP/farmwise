import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/lib/auth";
import { officerDeptCode } from "@/lib/officer/guard";
import { deptProfile, officerOverview } from "@/lib/officer/data";
import { OFFICER } from "@/lib/officer/departments";
import type { Period } from "@/lib/collector/intel";
import OfficerApp from "@/components/officer/OfficerApp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Officer Console · District IQ" };

// Same fonts as the Collector console, loaded by the browser (see app/collector/page.tsx).
const FONTS =
  "https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap";

function Unavailable({ title, text, back = "/login" }: { title: string; text: string; back?: string }) {
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20 }}>{title}</h1>
      <p>{text}</p>
      <p><a href={back}>{back === "/collector" ? "Back to the Collector console" : "Back to sign in"}</a></p>
    </main>
  );
}

/**
 * The Department Officer console. An officer sees their own department (from the database, never
 * the URL) and cannot move to another. Only department officers sign in here; the Collector uses
 * the Collector console.
 */
export default async function OfficerPage() {
  const session = await getSessionFromCookies();
  if (!session || session.role !== "department_officer") redirect("/login");

  try {
    const code = await officerDeptCode(session.userId);
    const dept = code ? await deptProfile(code) : null;
    if (!dept) {
      return <Unavailable title="Your department is not set"
        text="This officer account is not linked to a department that has work in the district intelligence store. Ask the administrator to set your department." />;
    }
    const initial = await officerOverview(dept, { period: OFFICER.defaultPeriod as Period, zone: null, taluk: null });
    return (
      <>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
        <OfficerApp initial={initial} user={session.email} />
      </>
    );
  } catch (err: any) {
    console.error("officer console failed to load", err);
    const missing = err?.code === "ER_BAD_DB_ERROR" || err?.code === "ER_NO_SUCH_TABLE";
    return (
      <Unavailable title="Officer console unavailable"
        text={missing
          ? "The district intelligence store or the officer tables are not in MySQL yet. Load the store (in district_intel: python run_pipeline.py mysql), then run: npm run setup:officer"
          : "The district intelligence store could not be read. Check that MySQL is running."} />
    );
  }
}
