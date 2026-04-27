import { FilterBar } from "@/components/app/filter-bar";
import { ImportPanel } from "@/components/reports/import-panel";
import { ReportsGrid } from "@/components/reports/reports-grid";
import { canViewWorkspaceReports } from "@/lib/auth/permissions";
import { parseFilters } from "@/lib/domain/filters";
import { requireSession } from "@/lib/auth/session";
import { getPeriods, getReportsForWorkspace, getWorkspaceMembers } from "@/lib/services/reporting";
import { prisma } from "@/lib/prisma";

export default async function ReportsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const filters = parseFilters(await searchParams);
  const [reports, periods, members] = await Promise.all([
    getReportsForWorkspace(session, filters),
    getPeriods(session.workspaceId),
    getWorkspaceMembers(session.workspaceId)
  ]);
  const auditActorIds = [...new Set(reports.flatMap((report) => report.auditLogs.map((log) => log.actorId)))];
  const auditActors = auditActorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: auditActorIds } },
        select: { id: true, name: true, email: true }
      })
    : [];
  const auditActorById = new Map(auditActors.map((actor) => [actor.id, actor]));
  const reportDtos = reports.map((report) => ({
    id: report.id,
    memberId: report.memberId,
    periodId: report.periodId,
    reportDate: report.reportDate.toISOString(),
    status: report.status,
    notes: report.notes,
    reviewedAt: report.reviewedAt?.toISOString() ?? null,
    member: {
      id: report.member.id,
      name: report.member.name,
      email: report.member.email
    },
    period: {
      id: report.period.id,
      label: report.period.label,
      type: report.period.type
    },
    rows: report.rows.map((row) => ({
      id: row.id,
      customer: row.customer,
      product: row.product,
      salesAmount: Number(row.salesAmount),
      unitsSold: row.unitsSold,
      notes: row.notes,
      rowOrder: row.rowOrder,
      importBatchId: row.importBatchId,
      importFilename: row.importFilename
    })),
    auditLogs: report.auditLogs.map((log) => {
      const actor = auditActorById.get(log.actorId);
      return {
        id: log.id,
        action: log.action,
        message: log.message,
        createdAt: log.createdAt.toISOString(),
        actor: actor ? { name: actor.name, email: actor.email } : null
      };
    })
  }));
  const periodDtos = periods.map((period) => ({
    id: period.id,
    label: period.label,
    type: period.type
  }));
  const memberDtos = members.map((membership) => ({
    id: membership.id,
    userId: membership.userId,
    role: membership.role,
    user: {
      id: membership.user.id,
      name: membership.user.name,
      email: membership.user.email
    }
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Reports</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Spreadsheet reporting workspace</h1>
      </div>

      <FilterBar
        members={members}
        periods={periods}
        defaults={filters}
        resetHref="/reports"
        showMemberFilter={canViewWorkspaceReports(session.role)}
      />

      <ImportPanel
        members={memberDtos}
        periods={periodDtos}
        session={session}
        canManageAll={canViewWorkspaceReports(session.role)}
      />

      <ReportsGrid
        reports={reportDtos}
        periods={periodDtos}
        members={memberDtos}
        session={session}
        canManageAll={canViewWorkspaceReports(session.role)}
      />
    </div>
  );
}
