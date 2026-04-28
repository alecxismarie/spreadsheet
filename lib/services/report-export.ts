import type { Prisma } from "@prisma/client";
import { canViewWorkspaceReports } from "@/lib/auth/permissions";
import type { AppSession } from "@/lib/auth/session";
import { getReportsForWorkspace } from "@/lib/services/reporting";
import type { OversightFilters } from "@/lib/domain/filters";

type ExportReport = Prisma.PromiseReturnType<typeof getReportsForWorkspace>[number];

const DANGEROUS_SPREADSHEET_CELL = /^[=+\-@\t\r\n]/;

/**
 * Prevent spreadsheet formula injection when exported CSV is opened in Excel,
 * Google Sheets, or similar tools. User-controlled text that begins with a
 * formula trigger is prefixed with a single quote so it is treated as text.
 */
export function sanitizeSpreadsheetText(value: string) {
  return DANGEROUS_SPREADSHEET_CELL.test(value) ? `'${value}` : value;
}

function csvText(value: string | null | undefined) {
  const sanitized = sanitizeSpreadsheetText(value ?? "");
  return `"${sanitized.replace(/"/g, '""')}"`;
}

function csvDate(value: Date | null | undefined) {
  return csvText(value ? value.toISOString() : "");
}

function csvNumber(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

function toCsvLine(values: Array<string | number>) {
  return values.join(",");
}

export async function buildSalesReportsCsv(session: AppSession, filters: OversightFilters) {
  const reports = await getReportsForWorkspace(session, filters);
  const includeMemberEmail = canViewWorkspaceReports(session.role);
  const headers = [
    "Report date",
    "Period",
    "Status",
    "Member name",
    ...(includeMemberEmail ? ["Member email"] : []),
    "Customer",
    "Product",
    "Sales amount",
    "Units sold",
    "Notes",
    "Submitted at",
    "Reviewed at",
    "Review note"
  ];

  const lines = [toCsvLine(headers.map(csvText))];

  for (const report of reports) {
    for (const row of report.rows) {
      lines.push(toExportRow(report, row, includeMemberEmail));
    }
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function toExportRow(report: ExportReport, row: ExportReport["rows"][number], includeMemberEmail: boolean) {
  return toCsvLine([
    csvDate(report.reportDate),
    csvText(report.period.label),
    csvText(report.status),
    csvText(report.member.name),
    ...(includeMemberEmail ? [csvText(report.member.email)] : []),
    csvText(row.customer),
    csvText(row.product),
    csvNumber(Number(row.salesAmount)),
    csvNumber(row.unitsSold),
    csvText(row.notes),
    csvDate(report.submittedAt),
    csvDate(report.reviewedAt),
    csvText(report.notes)
  ]);
}

export function salesReportsExportFilename(today = new Date()) {
  return `sales-reports-${today.toISOString().slice(0, 10)}.csv`;
}
