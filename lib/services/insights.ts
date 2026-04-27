import type { Prisma } from "@prisma/client";

type ReportWithRows = Prisma.SalesReportGetPayload<{
  include: { member: true; rows: true; period: true };
}>;

type Target = {
  memberId: string;
  amount: Prisma.Decimal;
};

export type MemberPerformance = {
  memberId: string;
  name: string;
  role?: string;
  totalSales: number;
  totalUnits: number;
  target: number;
  variance: number;
  submittedReports: number;
  draftReports: number;
  needsReviewReports: number;
};

export function summarizePerformance(reports: ReportWithRows[], targets: Target[]) {
  const byMember = new Map<string, MemberPerformance>();

  for (const report of reports) {
    const existing =
      byMember.get(report.memberId) ??
      ({
        memberId: report.memberId,
        name: report.member.name,
        totalSales: 0,
        totalUnits: 0,
        target: targets
          .filter((target) => target.memberId === report.memberId)
          .reduce((sum, target) => sum + Number(target.amount), 0),
        variance: 0,
        submittedReports: 0,
        draftReports: 0,
        needsReviewReports: 0
      } satisfies MemberPerformance);

    const sales = report.rows.reduce((sum, row) => sum + Number(row.salesAmount), 0);
    const units = report.rows.reduce((sum, row) => sum + row.unitsSold, 0);
    existing.totalSales += sales;
    existing.totalUnits += units;
    existing.submittedReports += report.status === "SUBMITTED" || report.status === "APPROVED" ? 1 : 0;
    existing.draftReports += report.status === "DRAFT" ? 1 : 0;
    existing.needsReviewReports += report.status === "NEEDS_REVIEW" ? 1 : 0;
    existing.variance = existing.totalSales - existing.target;
    byMember.set(report.memberId, existing);
  }

  return [...byMember.values()].sort((a, b) => b.totalSales - a.totalSales);
}

export function deriveInsights(performance: MemberPerformance[]) {
  const insights: string[] = [];
  const top = performance[0];
  const draftCount = performance.reduce((sum, member) => sum + member.draftReports, 0);
  const belowTarget = performance.filter((member) => member.target > 0 && member.variance < 0);
  const needsReview = performance.reduce((sum, member) => sum + member.needsReviewReports, 0);

  if (top) {
    insights.push(`${top.name} leads total sales in the selected period.`);
  }
  if (draftCount > 0) {
    insights.push(`${draftCount} report${draftCount === 1 ? "" : "s"} remain in draft.`);
  }
  if (belowTarget.length > 0) {
    insights.push(`${belowTarget.length} member${belowTarget.length === 1 ? "" : "s"} are below target.`);
  }
  if (needsReview > 0) {
    insights.push(`${needsReview} report${needsReview === 1 ? "" : "s"} need manager review.`);
  }
  if (insights.length === 0) {
    insights.push("No attention items detected for the selected period.");
  }

  return insights;
}
