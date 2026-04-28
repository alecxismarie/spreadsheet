import Link from "next/link";
import { Role } from "@prisma/client";
import { FilterBar } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { currency } from "@/lib/domain/format";
import { parseFilters } from "@/lib/domain/filters";
import { canViewWorkspaceReports } from "@/lib/auth/permissions";
import { requireCurrentSession } from "@/lib/auth/session";
import { getAccessibleWorkspaceMembers, getPeriods, getReportsForWorkspace } from "@/lib/services/reporting";

export default async function TeamPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCurrentSession();
  const filters = parseFilters(await searchParams);
  const canManageAll = canViewWorkspaceReports(session.role);
  const [memberships, periods, reports] = await Promise.all([
    getAccessibleWorkspaceMembers(session),
    getPeriods(session.workspaceId),
    getReportsForWorkspace(session, filters)
  ]);
  const visibleMemberships = memberships;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Team</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Member reporting activity</h1>
      </div>

      <FilterBar
        members={memberships}
        periods={periods}
        defaults={filters}
        resetHref="/team"
        showMemberFilter={canManageAll}
      />

      <section className="rounded-lg border border-border bg-white shadow-subtle">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3">Member</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Reports in filter</th>
                <th className="px-5 py-3">Submitted</th>
                <th className="px-5 py-3">Draft</th>
                <th className="px-5 py-3">Needs review</th>
                <th className="px-5 py-3">Official sales in filter</th>
                <th className="px-5 py-3">Pending sales in filter</th>
                <th className="px-5 py-3">Recent report</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleMemberships.map((membership) => {
                const memberReports = reports.filter((report) => report.memberId === membership.userId);
                const officialReports = memberReports.filter((report) => report.status === "SUBMITTED" || report.status === "APPROVED");
                const pendingReports = memberReports.filter((report) => report.status === "DRAFT" || report.status === "NEEDS_REVIEW");
                const officialSales = officialReports.reduce(
                  (sum, report) => sum + report.rows.reduce((rowSum, row) => rowSum + Number(row.salesAmount), 0),
                  0
                );
                const pendingSales = pendingReports.reduce(
                  (sum, report) => sum + report.rows.reduce((rowSum, row) => rowSum + Number(row.salesAmount), 0),
                  0
                );
                const submitted = memberReports.filter((report) => report.status === "SUBMITTED" || report.status === "APPROVED").length;
                const drafts = memberReports.filter((report) => report.status === "DRAFT").length;
                const needsReview = memberReports.filter((report) => report.status === "NEEDS_REVIEW").length;
                const latest = memberReports[0];

                return (
                  <tr key={membership.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink">{membership.user.name}</p>
                      <p className="text-xs text-muted">{membership.user.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      <RolePill role={membership.role} />
                    </td>
                    <td className="px-5 py-3">{memberReports.length}</td>
                    <td className="px-5 py-3">{submitted}</td>
                    <td className="px-5 py-3">{drafts}</td>
                    <td className="px-5 py-3">{needsReview}</td>
                    <td className="px-5 py-3">{currency(officialSales)}</td>
                    <td className="px-5 py-3">{currency(pendingSales)}</td>
                    <td className="px-5 py-3">{latest ? <StatusBadge status={latest.status} /> : <span className="text-muted">No reports</span>}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/reports?memberId=${membership.userId}`} className="font-semibold text-accent hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RolePill({ role }: { role: Role }) {
  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{role}</span>;
}
