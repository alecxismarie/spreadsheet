import Link from "next/link";
import type { Route } from "next";
import type { Membership, ReportingPeriod, ReportingPeriodType, SubmissionStatus, User } from "@prisma/client";

type Member = Membership & { user: User };

export function FilterBar({
  members,
  periods = [],
  defaults = {},
  showMemberFilter = true,
  resetHref
}: {
  members: Member[];
  periods?: ReportingPeriod[];
  defaults?: Record<string, string | undefined>;
  showMemberFilter?: boolean;
  resetHref: Route;
}) {
  return (
    <form className="rounded-lg border border-border bg-white p-4 shadow-subtle">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">Filters</p>
        <Link href={resetHref} className="text-sm font-semibold text-accent hover:underline">
          Reset
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-6">
      {showMemberFilter ? (
        <select name="memberId" defaultValue={defaults.memberId ?? ""} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All members</option>
          {members.map((membership) => (
            <option key={membership.userId} value={membership.userId}>
              {membership.user.name}
            </option>
          ))}
        </select>
      ) : null}
      <select name="periodId" defaultValue={defaults.periodId ?? ""} className="rounded-md border border-border px-3 py-2 text-sm">
        <option value="">Any reporting period</option>
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.label}
          </option>
        ))}
      </select>
      <select name="periodType" defaultValue={defaults.periodType ?? ""} className="rounded-md border border-border px-3 py-2 text-sm">
        <option value="">All periods</option>
        {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] satisfies ReportingPeriodType[]).map((period) => (
          <option key={period} value={period}>
            {period}
          </option>
        ))}
      </select>
      <select name="status" defaultValue={defaults.status ?? ""} className="rounded-md border border-border px-3 py-2 text-sm">
        <option value="">All statuses</option>
        {(["DRAFT", "SUBMITTED", "APPROVED", "NEEDS_REVIEW"] satisfies SubmissionStatus[]).map((status) => (
          <option key={status} value={status}>
            {status.replace("_", " ")}
          </option>
        ))}
      </select>
      <input name="from" type="date" defaultValue={defaults.from ?? ""} className="rounded-md border border-border px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <input name="to" type="date" defaultValue={defaults.to ?? ""} className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm" />
        <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Apply</button>
      </div>
      </div>
      <p className="mt-3 text-xs text-muted">Date ranges include the full selected end date.</p>
    </form>
  );
}
