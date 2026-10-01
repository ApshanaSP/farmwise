/**
 * The officer workflow: Received -> In action -> Sent to Collector -> Verified.
 * "In action" covers a grievance the officer approved and one where work has started (the
 * pipeline's Assigned and In progress, and the `action` step recorded before the two were merged).
 * Shared by the API (which enforces the transitions) and the console (labels, chips, buttons).
 */

export type Stage = "new" | "approved" | "action" | "sent" | "verified" | "closed";
export type Tab = "new" | "action" | "sent" | "verified";
/** `action` is no longer offered but stays readable in officer_steps written before */
export type OfficerStep = "approve" | "action" | "send";

export const TABS: Tab[] = ["new", "action", "sent", "verified"];
export const TAB_STAGES: Record<Tab, Stage[]> = { new: ["new"], action: ["approved", "action"], sent: ["sent"], verified: ["verified"] };
export const TAB_LABEL: Record<Tab, string> = { new: "New", action: "In action", sent: "Sent to Collector", verified: "Verified" };

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New", approved: "In action", action: "In action", sent: "Sent to Collector", verified: "Verified", closed: "Closed"
};
/** shorter labels for the grievances table, where the tab already says "Sent to Collector" */
export const STAGE_SHORT: Record<Stage, string> = { ...STAGE_LABEL, sent: "Sent" };
/** status chip classes from the Collector console's stylesheet (st-await is added by the officer stylesheet) */
export const STAGE_CLASS: Record<Stage, string> = {
  new: "st-open", approved: "st-progress", action: "st-progress", sent: "st-await", verified: "st-resolved", closed: "st-resolved"
};

export const STEP_LABELS = ["Received", "In action", "Sent to Collector", "Verified"] as const;
export const STAGE_INDEX: Record<Stage, number> = { new: 0, approved: 1, action: 1, sent: 2, verified: 3, closed: 3 };

/** The one step an officer can take from each stage. */
export const NEXT_STEP: Partial<Record<Stage, "approve" | "send">> = { new: "approve", approved: "send", action: "send" };

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && v in STAGE_LABEL;
}
export function parseTab(v: unknown): Tab {
  return typeof v === "string" && (TABS as string[]).includes(v) ? (v as Tab) : "new";
}
