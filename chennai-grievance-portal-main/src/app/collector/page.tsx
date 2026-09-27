import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/lib/auth";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CollectorDashboard from "@/components/collector/CollectorDashboard";
import { getOverview, parsePeriod } from "@/lib/collector/queries";

export const dynamic = "force-dynamic";

export default async function CollectorPage({ searchParams }: { searchParams: { p?: string | string[] } }) {
  const session = await getSessionFromCookies();
  if (!session || session.role !== "collector") {
    redirect("/login");
  }

  let data;
  let loadError: string | null = null;
  try {
    data = await getOverview(parsePeriod(searchParams.p));
  } catch (err: any) {
    console.error("collector dashboard failed to load", err);
    loadError =
      err?.code === "ER_BAD_DB_ERROR" || err?.code === "ER_NO_SUCH_TABLE"
        ? "The district intelligence store is not in MySQL yet. Run `python run_pipeline.py mysql` in district_intel."
        : "The district intelligence store could not be read.";
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header userName={session.email} homeHref="/collector" />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6">
        {data ? <CollectorDashboard data={data} /> : <div className="alert-error">{loadError}</div>}
      </main>
      <Footer />
    </div>
  );
}
