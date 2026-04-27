import { FilterBar } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { currency, percent } from "@/lib/domain/format";
import { parseFilters } from "@/lib/domain/filters";
import { canViewWorkspaceReports } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { getOverview } from "@/lib/services/overview";
import { getPeriods, getWorkspaceMembers } from "@/lib/services/reporting";

export default async function OverviewPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const filters = parseFilters(await searchParams);
  const [overview, members, periods] = await Promise.all([
    getOverview(session, filters),
    getWorkspaceMembers(session.workspaceId),
    getPeriods(session.workspaceId)
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Overview</p>
        <h1 className="text-2xl font-semibold text-ink">Sales reporting command center</h1>
      </div>

      <FilterBar
        members={members}
        periods={periods}
        defaults={filters}
        resetHref="/overview"
        showMemberFilter={canViewWorkspaceReports(session.role)}
      />

      <section className="grid gap-4 md:grid-cols-5">
        <Kpi label="Total sales" value={currency(overview.totalSales)} />
        <Kpi label="Total units" value={overview.totalUnits.toLocaleString()} />
        <Kpi label="Target progress" value={percent(overview.targetProgress)} tone={overview.targetVariance >= 0 ? "good" : "risk"} />
        <Kpi label="Submission health" value={percent(overview.submissionHealth)} />
        <Kpi label="Needs review" value={overview.reportsNeedingReview.toLocaleString()} tone={overview.reportsNeedingReview ? "risk" : "good"} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-lg border border-border bg-white shadow-subtle">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold text-ink">Team performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3">Member</th>
                  <th className="px-5 py-3">Sales</th>
                  <th className="px-5 py-3">Units</th>
                  <th className="px-5 py-3">Target</th>
                  <th className="px-5 py-3">Variance</th>
                  <th className="px-5 py-3">Drafts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {overview.performance.map((member) => (
                  <tr key={member.memberId}>
                    <td className="px-5 py-3 font-medium text-ink">{member.name}</td>
                    <td className="px-5 py-3">{currency(member.totalSales)}</td>
                    <td className="px-5 py-3">{member.totalUnits}</td>
                    <td className="px-5 py-3">{currency(member.target)}</td>
                    <td className={member.variance >= 0 ? "px-5 py-3 text-success" : "px-5 py-3 text-danger"}>
                      {currency(member.variance)}
                    </td>
                    <td className="px-5 py-3">{member.draftReports}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-white p-5 shadow-subtle">
            <h2 className="font-semibold text-ink">Deterministic insights</h2>
            <ul className="mt-4 space-y-3">
              {overview.insights.map((insight) => (
                <li key={insight} className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  {insight}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-white shadow-subtle">
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-semibold text-ink">Recent activity</h2>
            </div>
            <div className="divide-y divide-border">
              {overview.recentActivity.map((report) => (
                <div key={report.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{report.member.name}</p>
                    <p className="text-xs text-muted">{report.period.label}</p>
                  </div>
                  <StatusBadge status={report.status} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "risk" }) {
  return (
    <div className="rounded-lg border border-border bg-white p-5 shadow-subtle">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone === "good" ? "text-success" : tone === "risk" ? "text-danger" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}
