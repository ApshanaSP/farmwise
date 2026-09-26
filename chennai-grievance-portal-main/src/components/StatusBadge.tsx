import { ComplaintStatus } from "@/types";

const STATUS_STYLES: Record<ComplaintStatus, string> = {
  "Complaint Filed": "bg-navy-50 text-navy-700 ring-navy-200",
  "Pending Approval": "bg-gold-50 text-gold-700 ring-gold-200",
  "Approved by Department Officer": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "In Progress": "bg-violet-50 text-violet-700 ring-violet-200",
  "Completed - Pending Collector Verification": "bg-teal-50 text-teal-700 ring-teal-200",
  "Verified by Collector": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Rejected: "bg-red-50 text-red-700 ring-red-200"
};

const DOT_STYLES: Record<ComplaintStatus, string> = {
  "Complaint Filed": "bg-navy-500",
  "Pending Approval": "bg-gold-500",
  "Approved by Department Officer": "bg-indigo-500",
  "In Progress": "bg-violet-500",
  "Completed - Pending Collector Verification": "bg-teal-500",
  "Verified by Collector": "bg-emerald-500",
  Rejected: "bg-red-500"
};

export default function StatusBadge({ status }: { status: ComplaintStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 ring-inset ${
        STATUS_STYLES[status] || "bg-canvas-sunken text-ink-muted ring-canvas-border"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT_STYLES[status] || "bg-ink-faint"}`}
      />
      {status}
    </span>
  );
}
