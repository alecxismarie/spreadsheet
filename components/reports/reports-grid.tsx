"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportAuditAction, ReportingPeriodType, Role, User } from "@prisma/client";
import { Plus, Save, Send, Trash2 } from "lucide-react";
import { removeImportBatchAction, reviewReportAction, saveReportAction } from "@/app/(app)/reports/actions";
import { currency, isoDate } from "@/lib/domain/format";
import type { AppSession } from "@/lib/auth/session";
import { StatusBadge } from "@/components/app/status-badge";

type Member = {
  id: string;
  userId: string;
  role: Role;
  user: Pick<User, "id" | "name" | "email">;
};
type Report = {
  id: string;
  memberId: string;
  periodId: string;
  reportDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "NEEDS_REVIEW";
  notes: string | null;
  reviewedAt: string | null;
  member: Pick<User, "id" | "name" | "email">;
  period: { id: string; label: string; type: ReportingPeriodType };
  rows: Array<{
    id: string;
    customer: string;
    product: string;
    salesAmount: number;
    unitsSold: number;
    notes: string | null;
    rowOrder: number;
    importBatchId: string | null;
    importFilename: string | null;
  }>;
  auditLogs: Array<{
    id: string;
    action: ReportAuditAction;
    message: string | null;
    createdAt: string;
    actor: { name: string; email: string } | null;
  }>;
};

type EditableRow = {
  id?: string;
  customer: string;
  product: string;
  salesAmount: number;
  unitsSold: number;
  notes?: string;
  rowOrder: number;
};

const emptyRow = (rowOrder: number): EditableRow => ({
  customer: "",
  product: "",
  salesAmount: 0,
  unitsSold: 0,
  notes: "",
  rowOrder
});

export function ReportsGrid({
  reports,
  periods,
  members,
  session,
  canManageAll
}: {
  reports: Report[];
  periods: Array<{ id: string; label: string; type: ReportingPeriodType }>;
  members: Member[];
  session: AppSession;
  canManageAll: boolean;
}) {
  const router = useRouter();
  const [selectedReportId, setSelectedReportId] = useState(reports[0]?.id ?? "new");
  const selectedReport = reports.find((report) => report.id === selectedReportId);
  const ownsSelectedReport = selectedReport?.memberId === session.userId;
  const isNeedsReviewOwner = selectedReport?.status === "NEEDS_REVIEW" && ownsSelectedReport;
  const editable = !selectedReport || selectedReport.status === "DRAFT" || isNeedsReviewOwner;
  const canReviewSelected = Boolean(canManageAll && selectedReport && selectedReport.status === "SUBMITTED");
  const defaultMemberId = canManageAll ? members.find((member) => member.role === "MEMBER")?.userId : session.userId;
  const [memberId, setMemberId] = useState(selectedReport?.memberId ?? defaultMemberId ?? session.userId);
  const [periodId, setPeriodId] = useState(selectedReport?.periodId ?? periods[0]?.id ?? "");
  const [reportDate, setReportDate] = useState(selectedReport ? isoDate(new Date(selectedReport.reportDate)) : isoDate(new Date()));
  const [rows, setRows] = useState<EditableRow[]>(
    selectedReport?.rows.map((row, index) => ({
      id: row.id,
      customer: row.customer,
      product: row.product,
      salesAmount: row.salesAmount,
      unitsSold: row.unitsSold,
      notes: row.notes ?? "",
      rowOrder: index
    })) ?? [emptyRow(0)]
  );
  const [intent, setIntent] = useState<"SAVE_DRAFT" | "SUBMIT">("SAVE_DRAFT");
  const [state, action, pending] = useActionState(saveReportAction, { ok: false, message: "" });
  const [reviewState, reviewAction, reviewPending] = useActionState(reviewReportAction, { ok: false, message: "" });
  const [removeImportState, removeImportAction, removeImportPending] = useActionState(removeImportBatchAction, { ok: false, message: "" });

  useEffect(() => {
    if (state.ok || reviewState.ok || removeImportState.ok) {
      router.refresh();
    }
  }, [removeImportState.ok, reviewState.ok, router, state.ok]);

  function selectReport(id: string) {
    setSelectedReportId(id);
    const report = reports.find((item) => item.id === id);
    if (!report) {
      setMemberId(defaultMemberId ?? session.userId);
      setPeriodId(periods[0]?.id ?? "");
      setReportDate(isoDate(new Date()));
      setRows([emptyRow(0)]);
      return;
    }
    setMemberId(report.memberId);
    setPeriodId(report.periodId);
    setReportDate(report.reportDate.slice(0, 10));
    setRows(
      report.rows.map((row, index) => ({
        id: row.id,
        customer: row.customer,
        product: row.product,
        salesAmount: row.salesAmount,
        unitsSold: row.unitsSold,
        notes: row.notes ?? "",
        rowOrder: index
      }))
    );
  }

  const totals = useMemo(
    () => ({
      sales: rows.reduce((sum, row) => sum + Number(row.salesAmount || 0), 0),
      units: rows.reduce((sum, row) => sum + Number(row.unitsSold || 0), 0)
    }),
    [rows]
  );
  const importBatches = useMemo(() => {
    if (!selectedReport) return [];
    const batchMap = new Map<string, { importBatchId: string; filename: string; rowCount: number }>();
    selectedReport.rows.forEach((row) => {
      if (!row.importBatchId) return;
      const current = batchMap.get(row.importBatchId);
      if (current) {
        current.rowCount += 1;
        return;
      }
      batchMap.set(row.importBatchId, {
        importBatchId: row.importBatchId,
        filename: row.importFilename ?? "uploaded file",
        rowCount: 1
      });
    });
    return Array.from(batchMap.values());
  }, [selectedReport]);
  const canRemoveImportedBatch = Boolean(selectedReport && selectedReport.status === "DRAFT" && editable && importBatches.length > 0);

  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[280px_1fr]">
      <aside className="rounded-lg border border-border bg-white shadow-subtle">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold text-ink">Reports</h2>
          <button
            type="button"
            onClick={() => selectReport("new")}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>
        <div className="divide-y divide-border">
          {reports.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted">No reports match the current filters.</p>
          ) : (
            reports.map((report) => (
              <button
                key={report.id}
                type="button"
                onClick={() => selectReport(report.id)}
                className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${selectedReportId === report.id ? "bg-slate-50" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{report.member.name}</p>
                  <StatusBadge status={report.status} />
                </div>
                <p className="mt-1 text-xs text-muted">{report.period.label}</p>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="space-y-4">
      <form action={action} className="rounded-lg border border-border bg-white shadow-subtle">
        <input type="hidden" name="reportId" value={selectedReport?.id ?? ""} />
        <input type="hidden" name="rows" value={JSON.stringify(rows.map((row, index) => ({ ...row, rowOrder: index })))} />
        <input type="hidden" name="statusIntent" value={intent} />
        {!canManageAll ? <input type="hidden" name="memberId" value={memberId} /> : null}

        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
          <select
            name="memberId"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            disabled={!canManageAll}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:bg-slate-50"
          >
            {members.map((membership) => (
              <option key={membership.userId} value={membership.userId}>
                {membership.user.name}
              </option>
            ))}
          </select>
          <select name="periodId" value={periodId} onChange={(event) => setPeriodId(event.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label} ({period.type})
              </option>
            ))}
          </select>
          <input name="reportDate" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} className="rounded-md border border-border px-3 py-2 text-sm" />
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted">Total</span>
            <strong>{currency(totals.sales)}</strong>
            <span className="text-muted">{totals.units} units</span>
          </div>
        </div>

        {selectedReport ? <ReportNotice report={selectedReport} editable={editable} /> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-12 px-3 py-3">#</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Product</th>
                <th className="px-3 py-3">Sales amount</th>
                <th className="px-3 py-3">Units</th>
                <th className="px-3 py-3">Notes</th>
                <th className="w-12 px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, index) => (
                <tr key={`${row.id ?? "new"}-${index}`}>
                  <td className="px-3 py-2 text-muted">{index + 1}</td>
                  <Cell value={row.customer} disabled={!editable} onChange={(value) => updateRow(index, { customer: value })} />
                  <Cell value={row.product} disabled={!editable} onChange={(value) => updateRow(index, { product: value })} />
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.salesAmount}
                      disabled={!editable}
                      onChange={(event) => updateRow(index, { salesAmount: Number(event.target.value) })}
                      className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 outline-none focus:border-accent focus:bg-white"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.unitsSold}
                      disabled={!editable}
                      onChange={(event) => updateRow(index, { unitsSold: Number(event.target.value) })}
                      className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 outline-none focus:border-accent focus:bg-white"
                    />
                  </td>
                  <Cell value={row.notes ?? ""} disabled={!editable} onChange={(value) => updateRow(index, { notes: value })} />
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={!editable || rows.length === 1}
                      onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                      className="rounded p-1.5 text-muted hover:bg-slate-100 disabled:opacity-40"
                      title="Delete row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4">
          <button
            type="button"
            disabled={!editable}
            onClick={() => setRows((current) => [...current, emptyRow(current.length)])}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add row
          </button>
          <div className="flex items-center gap-3">
            {state.message ? <p className={state.ok ? "text-sm text-success" : "text-sm text-danger"}>{state.message}</p> : null}
            <button
              type="submit"
              disabled={!editable || pending}
              onClick={() => setIntent("SAVE_DRAFT")}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isNeedsReviewOwner ? "Save changes" : "Save draft"}
            </button>
            <button
              type="submit"
              disabled={!editable || pending}
              onClick={() => setIntent("SUBMIT")}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {isNeedsReviewOwner ? "Resubmit" : "Submit"}
            </button>
          </div>
        </div>
      </form>
      {canRemoveImportedBatch && selectedReport ? (
        <section className="rounded-lg border border-border bg-white p-4 shadow-subtle">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-ink">Imported batches</h2>
              <p className="mt-1 text-sm text-muted">
                Remove rows from a previous upload while this report is still a draft.
              </p>
            </div>
            {removeImportState.message ? (
              <p className={removeImportState.ok ? "text-sm text-success" : "text-sm text-danger"}>{removeImportState.message}</p>
            ) : null}
          </div>
          <div className="mt-4 divide-y divide-border rounded-md border border-border">
            {importBatches.map((batch) => (
              <form key={batch.importBatchId} action={removeImportAction} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <input type="hidden" name="reportId" value={selectedReport.id} />
                <input type="hidden" name="importBatchId" value={batch.importBatchId} />
                <div>
                  <p className="text-sm font-medium text-ink">{batch.filename}</p>
                  <p className="text-xs text-muted">
                    {batch.rowCount} imported row{batch.rowCount === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={removeImportPending}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove imported batch
                </button>
              </form>
            ))}
          </div>
        </section>
      ) : null}
      {canReviewSelected && selectedReport ? (
        <form action={reviewAction} className="rounded-lg border border-border bg-white p-4 shadow-subtle">
          <input type="hidden" name="reportId" value={selectedReport.id} />
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="min-w-0 flex-1">
              <span className="text-sm font-medium text-ink">Manager review note</span>
              <input
                name="reviewNote"
                placeholder="Optional note for the member"
                className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                name="status"
                value="APPROVED"
                disabled={reviewPending}
                className="rounded-md bg-success px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="submit"
                name="status"
                value="NEEDS_REVIEW"
                disabled={reviewPending}
                className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Mark needs review
              </button>
            </div>
          </div>
          {reviewState.message ? (
            <p className={reviewState.ok ? "mt-3 text-sm text-success" : "mt-3 text-sm text-danger"}>{reviewState.message}</p>
          ) : null}
        </form>
      ) : null}
      {selectedReport ? <ActivityLog auditLogs={selectedReport.auditLogs} /> : null}
      </div>
    </section>
  );
}

function ReportNotice({ report, editable }: { report: Report; editable: boolean }) {
  if (report.status === "NEEDS_REVIEW" && editable) {
    return (
      <div className="border-b border-border bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">This report needs review.</span>
          <StatusBadge status={report.status} />
        </div>
        <p className="mt-1">Update the requested fields and resubmit when ready.</p>
        {report.notes ? <p className="mt-2 font-medium">Review note: {report.notes}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-slate-50 px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="text-muted">Review status</span>
        <StatusBadge status={report.status} />
      </div>
      {report.notes ? <p className="text-muted">{report.notes}</p> : null}
    </div>
  );
}

function ActivityLog({ auditLogs }: { auditLogs: Report["auditLogs"] }) {
  return (
    <section className="rounded-lg border border-border bg-white shadow-subtle">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold text-ink">Activity</h2>
      </div>
      {auditLogs.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">No activity recorded yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {auditLogs.map((log) => (
            <div key={log.id} className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[180px_1fr]">
              <div>
                <p className="font-medium text-ink">{formatAuditAction(log.action)}</p>
                <p className="text-xs text-muted">{new Date(log.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-slate-700">{log.actor ? `${log.actor.name} (${log.actor.email})` : "Unknown actor"}</p>
                {log.message ? <p className="mt-1 text-muted">{log.message}</p> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatAuditAction(action: ReportAuditAction) {
  const labels: Record<ReportAuditAction, string> = {
    CREATED: "Created",
    UPDATED: "Updated",
    IMPORTED: "Imported",
    IMPORT_REMOVED: "Import removed",
    SUBMITTED: "Submitted",
    RESUBMITTED: "Resubmitted",
    APPROVED: "Approved",
    NEEDS_REVIEW: "Marked needs review"
  };
  return labels[action];
}

function Cell({
  value,
  disabled,
  onChange
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <td className="px-3 py-2">
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 outline-none focus:border-accent focus:bg-white disabled:text-slate-600"
      />
    </td>
  );
}
