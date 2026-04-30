import type { Prisma } from "@prisma/client";

type ReportWithRows = Prisma.SalesReportGetPayload<{
  include: { member: { select: { id: true; name: true } }; rows: true; period: true };
}>;

type Target = Prisma.SalesTargetGetPayload<{
  include: { member: { select: { id: true; name: true } } };
}>;

export type MemberPerformance = {
  memberId: string;
  name: string;
  role?: string;
  totalSales: number;
  totalUnits: number;
  pendingSales: number;
  pendingUnits: number;
  target: number;
  variance: number;
  submittedReports: number;
  draftReports: number;
  needsReviewReports: number;
};

export function summarizePerformance(reports: ReportWithRows[], targets: Target[]) {
  const byMember = new Map<string, MemberPerformance>();

  for (const target of targets) {
    const existing =
      byMember.get(target.memberId) ??
      ({
        memberId: target.memberId,
        name: target.member.name,
        totalSales: 0,
        totalUnits: 0,
        pendingSales: 0,
        pendingUnits: 0,
        target: 0,
        variance: 0,
        submittedReports: 0,
        draftReports: 0,
        needsReviewReports: 0
      } satisfies MemberPerformance);

    existing.target += Number(target.amount);
    existing.variance = existing.totalSales - existing.target;
    byMember.set(target.memberId, existing);
  }

  for (const report of reports) {
    const existing =
      byMember.get(report.memberId) ??
      ({
        memberId: report.memberId,
        name: report.member.name,
        totalSales: 0,
        totalUnits: 0,
        pendingSales: 0,
        pendingUnits: 0,
        target: 0,
        variance: 0,
        submittedReports: 0,
        draftReports: 0,
        needsReviewReports: 0
      } satisfies MemberPerformance);

    const sales = report.rows.reduce((sum, row) => sum + Number(row.salesAmount), 0);
    const units = report.rows.reduce((sum, row) => sum + row.unitsSold, 0);

    if (report.status === "APPROVED") {
      existing.totalSales += sales;
      existing.totalUnits += units;
    } else if (report.status === "SUBMITTED") {
      existing.pendingSales += sales;
      existing.pendingUnits += units;
      existing.submittedReports += 1;
    }

    existing.draftReports += report.status === "DRAFT" ? 1 : 0;
    existing.needsReviewReports += report.status === "NEEDS_REVIEW" ? 1 : 0;
    existing.variance = existing.totalSales - existing.target;
    byMember.set(report.memberId, existing);
  }

  return [...byMember.values()].sort((a, b) => b.totalSales - a.totalSales || b.target - a.target);
}

export function deriveInsights(performance: MemberPerformance[]) {
  const insights: string[] = [];
  const top = performance.find((member) => member.totalSales > 0);
  const pendingReview = performance.reduce((sum, member) => sum + member.submittedReports, 0);
  const draftCount = performance.reduce((sum, member) => sum + member.draftReports, 0);
  const belowTarget = performance.filter((member) => member.target > 0 && member.variance < 0);
  const needsReview = performance.reduce((sum, member) => sum + member.needsReviewReports, 0);

  if (top) {
    insights.push(`${top.name} leads official sales in the selected period.`);
  }
  if (pendingReview > 0) {
    insights.push(`${pendingReview} report${pendingReview === 1 ? "" : "s"} ${pendingReview === 1 ? "is" : "are"} pending manager review.`);
  }
  if (draftCount > 0) {
    insights.push(`${draftCount} report${draftCount === 1 ? "" : "s"} ${draftCount === 1 ? "remains" : "remain"} in draft.`);
  }
  if (belowTarget.length > 0) {
    insights.push(`${belowTarget.length} member${belowTarget.length === 1 ? "" : "s"} are below target.`);
  }
  if (needsReview > 0) {
    insights.push(`${needsReview} report${needsReview === 1 ? "" : "s"} ${needsReview === 1 ? "needs" : "need"} member revision.`);
  }
  if (insights.length === 0) {
    insights.push("No attention items detected for the selected period.");
  }

  return insights;
}
