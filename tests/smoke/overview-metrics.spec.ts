import { expect, test } from "@playwright/test";
import type { SubmissionStatus } from "@prisma/client";
import { parseDateRangeFilters } from "@/lib/domain/date-range";
import {
  targetColumnLabel,
  targetPeriodDateFilter,
  targetProgressLabel,
  targetsApplyToStatus,
  usesFullPeriodTargetsForDateRange
} from "@/lib/domain/dashboard-targets";
import { deriveInsights, summarizePerformance } from "@/lib/services/insights";

type ReportInput = Parameters<typeof summarizePerformance>[0][number];
type TargetInput = Parameters<typeof summarizePerformance>[1][number];

const member = {
  id: "dashboard-metric-member",
  name: "Dashboard Metric Member"
};

function report(status: SubmissionStatus, salesAmount: number, unitsSold: number): ReportInput {
  return {
    memberId: member.id,
    status,
    member,
    rows: [{ salesAmount, unitsSold }]
  } as unknown as ReportInput;
}

function target(amount: number): TargetInput {
  return {
    memberId: member.id,
    amount,
    member
  } as unknown as TargetInput;
}

test("overview performance treats only approved reports as official", () => {
  const [performance] = summarizePerformance(
    [
      report("APPROVED", 1000, 10),
      report("SUBMITTED", 2000, 20),
      report("DRAFT", 3000, 30),
      report("NEEDS_REVIEW", 4000, 40)
    ],
    [target(5000)]
  );

  expect(performance.totalSales).toBe(1000);
  expect(performance.totalUnits).toBe(10);
  expect(performance.variance).toBe(-4000);
  expect(performance.pendingSales).toBe(2000);
  expect(performance.pendingUnits).toBe(20);
  expect(performance.submittedReports).toBe(1);
  expect(performance.draftReports).toBe(1);
  expect(performance.needsReviewReports).toBe(1);
});

test("overview performance keeps non-approved status-filtered views out of official metrics", () => {
  const [submitted] = summarizePerformance([report("SUBMITTED", 2000, 20)], []);
  expect(submitted.totalSales).toBe(0);
  expect(submitted.totalUnits).toBe(0);
  expect(submitted.pendingSales).toBe(2000);
  expect(submitted.pendingUnits).toBe(20);

  const [needsReview] = summarizePerformance([report("NEEDS_REVIEW", 4000, 40)], []);
  expect(needsReview.totalSales).toBe(0);
  expect(needsReview.totalUnits).toBe(0);
  expect(needsReview.pendingSales).toBe(0);
  expect(needsReview.pendingUnits).toBe(0);
  expect(needsReview.needsReviewReports).toBe(1);
});

test("overview insights separate official leaders from review queues", () => {
  const performance = summarizePerformance(
    [
      report("APPROVED", 1000, 10),
      report("SUBMITTED", 2000, 20),
      report("DRAFT", 3000, 30),
      report("NEEDS_REVIEW", 4000, 40)
    ],
    [target(5000)]
  );

  expect(deriveInsights(performance)).toEqual(
    expect.arrayContaining([
      "Dashboard Metric Member leads official sales in the selected period.",
      "1 report is pending manager review.",
      "1 report remains in draft.",
      "1 report needs member revision."
    ])
  );
});

test("dashboard target progress only applies to official status scopes", () => {
  expect(targetsApplyToStatus()).toBe(true);
  expect(targetsApplyToStatus("APPROVED")).toBe(true);
  expect(targetsApplyToStatus("SUBMITTED")).toBe(false);
  expect(targetsApplyToStatus("DRAFT")).toBe(false);
  expect(targetsApplyToStatus("NEEDS_REVIEW")).toBe(false);
});

test("dashboard target date filters overlap selected reporting periods", () => {
  const dateRange = parseDateRangeFilters("2026-05-10", "2026-05-14");
  const filter = targetPeriodDateFilter(dateRange);

  expect(filter).toEqual({
    endDate: { gte: new Date(2026, 4, 10) },
    startDate: { lte: new Date(2026, 4, 14, 23, 59, 59, 999) }
  });
  expect(targetPeriodDateFilter(parseDateRangeFilters())).toBeUndefined();
});

test("dashboard partial date ranges explicitly use full-period target labels", () => {
  expect(usesFullPeriodTargetsForDateRange()).toBe(false);
  expect(usesFullPeriodTargetsForDateRange("2026-05-01")).toBe(true);
  expect(usesFullPeriodTargetsForDateRange(undefined, "2026-05-14")).toBe(true);
  expect(targetProgressLabel(false)).toBe("Target progress");
  expect(targetProgressLabel(true)).toBe("Target progress (full period)");
  expect(targetColumnLabel(false)).toBe("Target");
  expect(targetColumnLabel(true)).toBe("Target (full period)");
});

test("dashboard date filters reject invalid and inverted ranges", () => {
  expect(parseDateRangeFilters("2026-02-30", "2026-03-01")).toEqual({
    ok: false,
    message: "Date filters must use valid YYYY-MM-DD dates."
  });
  expect(parseDateRangeFilters("2026-05-14", "2026-05-01")).toEqual({
    ok: false,
    message: "Start date cannot be after end date."
  });
});
