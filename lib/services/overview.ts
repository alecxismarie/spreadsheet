import { prisma } from "@/lib/prisma";
import { summarizePerformance, deriveInsights } from "@/lib/services/insights";
import type { AppSession } from "@/lib/auth/session";
import { getReportsForWorkspace } from "@/lib/services/reporting";
import type { OversightFilters } from "@/lib/domain/filters";

export async function getOverview(session: AppSession, filters: OversightFilters) {
  const reports = await getReportsForWorkspace(session, filters);
  const periodIds = [...new Set(reports.map((report) => report.periodId))];
  const targets = await prisma.salesTarget.findMany({
    where: {
      workspaceId: session.workspaceId,
      ...(periodIds.length ? { periodId: { in: periodIds } } : {})
    }
  });

  const performance = summarizePerformance(reports, targets);
  const totalSales = performance.reduce((sum, member) => sum + member.totalSales, 0);
  const totalUnits = performance.reduce((sum, member) => sum + member.totalUnits, 0);
  const totalTarget = performance.reduce((sum, member) => sum + member.target, 0);
  const submitted = reports.filter((report) => report.status === "SUBMITTED" || report.status === "APPROVED").length;
  const needsReview = reports.filter((report) => report.status === "NEEDS_REVIEW").length;
  const health = reports.length ? submitted / reports.length : 0;

  return {
    totalSales,
    totalUnits,
    totalTarget,
    targetVariance: totalSales - totalTarget,
    targetProgress: totalTarget ? totalSales / totalTarget : 0,
    submissionHealth: health,
    reportsNeedingReview: needsReview,
    performance,
    insights: deriveInsights(performance),
    recentActivity: reports.slice(0, 6)
  };
}
