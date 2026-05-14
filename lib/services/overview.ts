import { prisma } from "@/lib/prisma";
import { summarizePerformance, deriveInsights } from "@/lib/services/insights";
import { refreshSession, type AppSession } from "@/lib/auth/session";
import { getReportsForWorkspace } from "@/lib/services/reporting";
import type { OversightFilters } from "@/lib/domain/filters";
import { canViewWorkspaceReports } from "@/lib/auth/permissions";
import { parseDateRangeFilters } from "@/lib/domain/date-range";
import { targetPeriodDateFilter, targetsApplyToStatus } from "@/lib/domain/dashboard-targets";

const emptyOverview = (insight: string) => ({
  totalSales: 0,
  totalUnits: 0,
  pendingSales: 0,
  pendingUnits: 0,
  totalTarget: 0,
  targetVariance: 0,
  targetProgress: 0,
  submissionHealth: 0,
  reportsNeedingReview: 0,
  draftReports: 0,
  performance: [],
  insights: [insight],
  recentActivity: []
});

export async function getOverview(session: AppSession, filters: OversightFilters) {
  const currentSession = await refreshSession(session);
  if (!currentSession) {
    return emptyOverview("No active workspace membership found.");
  }
  session = currentSession;

  const dateRange = parseDateRangeFilters(filters.from, filters.to);
  if (!dateRange.ok) {
    return emptyOverview(dateRange.message);
  }

  const reports = await getReportsForWorkspace(session, filters);
  const targetMemberId = canViewWorkspaceReports(session.role) ? filters.memberId : session.userId;
  const periodDateFilter = targetPeriodDateFilter(dateRange);
  const targets = targetsApplyToStatus(filters.status)
    ? await prisma.salesTarget.findMany({
        where: {
          workspaceId: session.workspaceId,
          ...(targetMemberId ? { memberId: targetMemberId } : {}),
          ...(filters.periodId ? { periodId: filters.periodId } : {}),
          ...(filters.periodType || periodDateFilter
            ? { period: { ...(filters.periodType ? { type: filters.periodType } : {}), ...(periodDateFilter ?? {}) } }
            : {})
        },
        include: { member: { select: { id: true, name: true } } }
      })
    : [];

  const performance = summarizePerformance(reports, targets);
  const totalSales = performance.reduce((sum, member) => sum + member.totalSales, 0);
  const totalUnits = performance.reduce((sum, member) => sum + member.totalUnits, 0);
  const pendingSales = performance.reduce((sum, member) => sum + member.pendingSales, 0);
  const pendingUnits = performance.reduce((sum, member) => sum + member.pendingUnits, 0);
  const totalTarget = performance.reduce((sum, member) => sum + member.target, 0);
  const submittedOrApproved = reports.filter((report) => report.status === "SUBMITTED" || report.status === "APPROVED").length;
  const needsReview = reports.filter((report) => report.status === "NEEDS_REVIEW").length;
  const draftReports = reports.filter((report) => report.status === "DRAFT").length;
  const health = reports.length ? submittedOrApproved / reports.length : 0;

  return {
    totalSales,
    totalUnits,
    pendingSales,
    pendingUnits,
    totalTarget,
    targetVariance: totalSales - totalTarget,
    targetProgress: totalTarget ? totalSales / totalTarget : 0,
    submissionHealth: health,
    reportsNeedingReview: needsReview,
    draftReports,
    performance,
    insights: deriveInsights(performance),
    recentActivity: reports.slice(0, 6)
  };
}
