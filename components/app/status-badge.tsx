import type { SubmissionStatus } from "@prisma/client";

const styles: Record<SubmissionStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SUBMITTED: "bg-blue-50 text-blue-700",
  APPROVED: "bg-green-50 text-green-700",
  NEEDS_REVIEW: "bg-amber-50 text-amber-700"
};

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}
