/**
 * What the assistant's pop-up needs from the console it opens over: the Collector's console
 * (CollectorApp's `Console` fits as it is), or a department officer's console, which passes
 * an adapter with its own filters and a fixed department.
 */
import type { Period } from "@/lib/collector/intel";
import type { MapGeo } from "@/lib/collector/geo";
import type { Lang } from "@/lib/assistant/lang";

export interface AssistantHost {
  period: Period;
  periodLabel: string;
  zone: number | null;
  zoneName: string | null;
  dept: string | null;
  deptName: string | null;
  cat: string | null;
  taluk: string | null;
  talukName(code: string | null): string | null;
  geo: MapGeo | null;
  setZone(z: number | null): void;
  setDept(code: string | null): void;
  setTaluk(t: string | null): void;
  setCat(c: string | null): void;
  setPeriod(p: Period): void;
  openInc(id: string): void;
  openStories(focus?: string | null): void;
  setPage(p: "overview" | "briefing"): void;
  /** a department officer's console: who is greeted, and questions that suit a department */
  officer?: {
    who: Record<Lang, string>;
    examples: Record<Lang, string[]>;
    labels: Record<Lang, [string, string, string, string]>;
  };
}
