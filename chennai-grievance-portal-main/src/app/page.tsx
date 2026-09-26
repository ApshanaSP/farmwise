import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/lib/auth";

export default async function RootPage() {
  const session = await getSessionFromCookies();

  if (!session) {
    redirect("/login");
  }

  if (session.role === "citizen") redirect("/citizen");
  if (session.role === "department_officer") redirect("/officer");
  if (session.role === "collector") redirect("/collector");

  redirect("/login");
}
