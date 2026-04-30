"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportingPeriodType, Role, User } from "@prisma/client";
import { FileUp } from "lucide-react";
import {
  importRowsAction,
  previewImportAction
} from "@/app/(app)/reports/actions";
import type { ImportPreviewState, ImportRowsState } from "@/lib/services/report-import";
import type { AppSession } from "@/lib/auth/session";
import { isoDate } from "@/lib/domain/format";

type Member = {
  id: string;
  userId: string;
  role: Role;
  user: Pick<User, "id" | "name" | "email">;
};

type Period = {
  id: string;
  label: string;
  type: ReportingPeriodType;
};

const emptyPreviewState: ImportPreviewState = { ok: false, message: "" };
const emptyImportState: ImportRowsState = { ok: false, message: "" };

export function ImportPanel({
  members,
  periods,
  session,
  canManageAll
}: {
  members: Member[];
  periods: Period[];
  session: AppSession;
  canManageAll: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [panelKey, setPanelKey] = useState(0);

  return (
    <section className="rounded-lg border border-border bg-white shadow-subtle">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-semibold text-ink">Spreadsheet import</h2>
          <p className="mt-1 text-sm text-muted">Upload CSV or XLSX rows, map columns, then import into a draft report.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          data-testid="import-toggle"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <FileUp className="h-4 w-4" />
          Import CSV/Excel
        </button>
      </div>

      {open ? (
        <ImportPanelBody
          key={panelKey}
          members={members}
          periods={periods}
          session={session}
          canManageAll={canManageAll}
          onClear={() => setPanelKey((current) => current + 1)}
        />
      ) : null}
    </section>
  );
}

function ImportPanelBody({
  members,
  periods,
  session,
  canManageAll,
  onClear
}: {
  members: Member[];
  periods: Period[];
  session: AppSession;
  canManageAll: boolean;
  onClear: () => void;
}) {
  const router = useRouter();
  const [previewState, previewAction, previewPending] = useActionState(previewImportAction, emptyPreviewState);
  const [importState, importAction, importPending] = useActionState(importRowsAction, emptyImportState);
  const [memberId, setMemberId] = useState(canManageAll ? members.find((member) => member.role === "MEMBER")?.userId ?? session.userId : session.userId);
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [reportDate, setReportDate] = useState(isoDate(new Date()));
  const [mapping, setMapping] = useState({
    customer: "",
    product: "",
    salesAmount: "",
    unitsSold: "",
    notes: ""
  });

  useEffect(() => {
    if (importState.ok) {
      router.refresh();
    }
  }, [importState.ok, router]);

  const resolvedMapping = {
    customer: mapping.customer || previewState.suggestedMapping?.customer || "",
    product: mapping.product || previewState.suggestedMapping?.product || "",
    salesAmount: mapping.salesAmount || previewState.suggestedMapping?.salesAmount || "",
    unitsSold: mapping.unitsSold || previewState.suggestedMapping?.unitsSold || "",
    notes: mapping.notes || previewState.suggestedMapping?.notes || ""
  };
  const requiredMappingsComplete = Boolean(
    resolvedMapping.customer && resolvedMapping.product && resolvedMapping.salesAmount && resolvedMapping.unitsSold
  );
  const rowsJson = useMemo(() => JSON.stringify(previewState.rows ?? []), [previewState.rows]);

  return (
        <div className="space-y-5 p-4">
          <form action={previewAction} className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              name="file"
              type="file"
              accept=".csv,.xlsx"
              data-testid="import-file"
              className="rounded-md border border-border px-3 py-2 text-sm"
            />
            <button
              disabled={previewPending}
              data-testid="import-preview"
              className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {previewPending ? "Parsing..." : "Preview file"}
            </button>
          </form>

          {previewState.message ? (
            <p className={previewState.ok ? "text-sm text-success" : "text-sm text-danger"}>{previewState.message}</p>
          ) : null}

          {previewState.ok && previewState.columns && previewState.previewRows ? (
            <form action={importAction} className="space-y-5">
              <input type="hidden" name="filename" value={previewState.filename ?? "uploaded file"} />
              <input type="hidden" name="rows" value={rowsJson} />

              <div className="grid gap-3 md:grid-cols-3">
                <select
                  name="memberId"
                  value={memberId}
                  disabled={!canManageAll}
                  onChange={(event) => setMemberId(event.target.value)}
                  data-testid="import-member-select"
                  className="rounded-md border border-border px-3 py-2 text-sm disabled:bg-slate-50"
                >
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.user.name}
                    </option>
                  ))}
                </select>
                {!canManageAll ? <input type="hidden" name="memberId" value={memberId} /> : null}
                <select
                  name="periodId"
                  value={periodId}
                  onChange={(event) => setPeriodId(event.target.value)}
                  data-testid="import-period-select"
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.label} ({period.type})
                    </option>
                  ))}
                </select>
                <input
                  name="reportDate"
                  type="date"
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                  data-testid="import-date-input"
                  className="rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-5">
                <MappingSelect label="Customer" name="customer" required value={resolvedMapping.customer} columns={previewState.columns} testId="import-map-customer" onChange={(value) => setMapping((current) => ({ ...current, customer: value }))} />
                <MappingSelect label="Product" name="product" required value={resolvedMapping.product} columns={previewState.columns} testId="import-map-product" onChange={(value) => setMapping((current) => ({ ...current, product: value }))} />
                <MappingSelect label="Sales amount" name="salesAmount" required value={resolvedMapping.salesAmount} columns={previewState.columns} testId="import-map-sales" onChange={(value) => setMapping((current) => ({ ...current, salesAmount: value }))} />
                <MappingSelect label="Units sold" name="unitsSold" required value={resolvedMapping.unitsSold} columns={previewState.columns} testId="import-map-units" onChange={(value) => setMapping((current) => ({ ...current, unitsSold: value }))} />
                <MappingSelect label="Notes" name="notes" value={resolvedMapping.notes} columns={previewState.columns} testId="import-map-notes" onChange={(value) => setMapping((current) => ({ ...current, notes: value }))} />
              </div>

              <div className="rounded-md bg-slate-50 p-3 text-sm text-muted">
                Parsed {previewState.rows?.length ?? 0} rows. Showing first {previewState.previewRows.length}. Ignored empty rows: {previewState.ignoredEmptyRows ?? 0}.
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      {previewState.columns.map((column) => (
                        <th key={column} className="px-3 py-2">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewState.previewRows.map((row, index) => (
                      <tr key={index}>
                        {previewState.columns!.map((column) => (
                          <td key={column} className="max-w-[220px] truncate px-3 py-2">{row[column]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {importState.summary ? (
                <div className="rounded-md bg-slate-50 p-3 text-sm text-muted">
                  Valid rows: {importState.summary.validRows}. Imported rows: {importState.summary.importedRows}. Skipped duplicates: {importState.summary.skippedDuplicates}. Invalid rows: {importState.summary.invalidRows}. Ignored empty rows: {importState.summary.ignoredEmptyRows}.
                </div>
              ) : null}
              {importState.rowErrors?.length ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Rows requiring fixes</p>
                  <ul className="mt-2 space-y-1">
                    {importState.rowErrors.slice(0, 10).map((error) => (
                      <li key={error.rowNumber}>Row {error.rowNumber}: {error.errors.join(", ")}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {importState.message ? (
                <p className={importState.ok ? "text-sm text-success" : "text-sm text-danger"}>{importState.message}</p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  disabled={!requiredMappingsComplete || importPending}
                  data-testid="import-submit"
                  className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {importPending ? "Importing..." : "Import as draft"}
                </button>
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Clear uploaded file
                </button>
              </div>
            </form>
          ) : null}
        </div>
  );
}

function MappingSelect({
  label,
  name,
  value,
  columns,
  required = false,
  testId,
  onChange
}: {
  label: string;
  name: string;
  value: string;
  columns: string[];
  required?: boolean;
  testId?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}{required ? " *" : ""}</span>
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm"
      >
        <option value="">Do not import</option>
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </select>
    </label>
  );
}
