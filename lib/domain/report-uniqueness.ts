export const DUPLICATE_REPORT_MESSAGE = "A report already exists for this member, period, and date.";

export function isReportUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  return candidate.code === "P2002" && isReportUniqueTarget(candidate.meta?.target);
}

function isReportUniqueTarget(target: unknown) {
  if (Array.isArray(target)) {
    return ["workspaceId", "memberId", "periodId", "reportDate"].every((field) => target.includes(field));
  }
  return typeof target === "string" && target.includes("workspaceId_memberId_periodId_reportDate");
}
