import { expect, test } from "@playwright/test";
import type { SubmissionStatus } from "@prisma/client";
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
