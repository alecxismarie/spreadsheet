import type { Prisma, SubmissionStatus } from "@prisma/client";
import type { DateRangeResult } from "@/lib/domain/date-range";

export function targetsApplyToStatus(status?: SubmissionStatus) {
  return !status || status === "APPROVED";
}

export function targetPeriodDateFilter(dateRange: DateRangeResult): Prisma.ReportingPeriodWhereInput | undefined {
  if (!dateRange.ok) return undefined;
  const { from, to } = dateRange;
  if (!from && !to) return undefined;
  return {
    ...(from ? { endDate: { gte: from } } : {}),
    ...(to ? { startDate: { lte: to } } : {})
  };
}

export function usesFullPeriodTargetsForDateRange(from?: string, to?: string) {
  return Boolean(from || to);
}

export function targetProgressLabel(usesFullPeriodTargets: boolean) {
  return usesFullPeriodTargets ? "Target progress (full period)" : "Target progress";
}

export function targetColumnLabel(usesFullPeriodTargets: boolean) {
  return usesFullPeriodTargets ? "Target (full period)" : "Target";
}
