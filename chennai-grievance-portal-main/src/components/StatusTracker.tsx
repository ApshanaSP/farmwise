import { ComplaintStatus } from "@/types";

interface StatusTrackerProps {
  status: ComplaintStatus;
  rejectedStage: "Department Officer" | "Collector" | null;
  remarks: string | null;
}

const STEPS = [
  { key: "filed", label: "Complaint Filed" },
  { key: "approved", label: "Approved by Department Officer" },
  { key: "in_progress", label: "Reviewed & In Progress by Department Officer" },
  { key: "verified", label: "Verified by Collector" }
];

function getStepState(status: ComplaintStatus, stepKey: string): "done" | "current" | "pending" {
  const order = ["filed", "approved", "in_progress", "verified"];
  const statusToIndex: Record<string, number> = {
    "Complaint Filed": 0,
    "Pending Approval": 0,
    "Approved by Department Officer": 1,
    "In Progress": 2,
    "Completed - Pending Collector Verification": 2,
    "Verified by Collector": 3,
    Rejected: -1
  };
  const currentIndex = statusToIndex[status] ?? 0;
  const stepIndex = order.indexOf(stepKey);

  if (currentIndex === -1) return "pending";
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "current";
  return "pending";
}

export default function StatusTracker({ status, rejectedStage, remarks }: StatusTrackerProps) {
  if (status === "Rejected") {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4">
        <p className="font-semibold text-red-800">
          Rejected {rejectedStage ? `at ${rejectedStage} stage` : ""}
        </p>
        {remarks && <p className="mt-1 text-sm text-red-700">Reason: {remarks}</p>}
      </div>
    );
  }

  return (
    <ol className="space-y-4">
      {STEPS.map((step, idx) => {
        const state = getStepState(status, step.key);
        return (
          <li key={step.key} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                state === "done"
                  ? "bg-green-600 text-white"
                  : state === "current"
                    ? "bg-navy text-white"
                    : "bg-gray-200 text-gray-500"
              }`}
            >
              {state === "done" ? "✓" : idx + 1}
            </span>
            <div>
              <p
                className={`text-sm font-medium ${
                  state === "pending" ? "text-gray-400" : "text-gray-900"
                }`}
              >
                {step.label}
              </p>
              {state === "current" && (
                <p className="text-xs text-navy-700">
                  {step.key === "in_progress" ? "In progress" : "Pending"}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
