import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getSessionFromCookies } from "@/lib/auth";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default async function CollectorPlaceholderPage() {
  const session = await getSessionFromCookies();
  if (!session || session.role !== "collector") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header userName={session.email} homeHref="/collector" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
        <div className="card flex w-full flex-col items-center py-12">
          <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-50 text-navy">
            <Building2 className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold text-ink">Collector Dashboard</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
            This dashboard is coming soon. District-wide complaint verification and oversight
            tools will appear here.
          </p>
          <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-gold-50 px-3 py-1 text-2xs font-bold uppercase tracking-wide text-gold-700 ring-1 ring-inset ring-gold-200">
            Coming soon
          </span>
        </div>
      </main>
      <Footer />
    </div>
  );
}
