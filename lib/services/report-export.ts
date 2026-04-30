import type { Prisma } from "@prisma/client";
import { canViewWorkspaceReports } from "@/lib/auth/permissions";
import type { AppSession } from "@/lib/auth/session";
import { getReportsForWorkspace } from "@/lib/services/reporting";
import type { OversightFilters } from "@/lib/domain/filters";
import { prisma } from "@/lib/prisma";

type ExportReport = Prisma.PromiseReturnType<typeof getReportsForWorkspace>[number];

const DANGEROUS_SPREADSHEET_CELL = /^[=+\-@\t\r\n]/;
const EXPORT_FORMAT_CSV = "CSV";

type ExportSummary = {
  reportCount: number;
  rowCount: number;
  totalSalesAmount: number;
  totalUnitsSold: number;
};

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

function csvMoney(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

function toCsvLine(values: Array<string | number>) {
  return values.join(",");
}

export async function buildSalesReportsCsv(session: AppSession, filters: OversightFilters) {
  const reports = await getReportsForWorkspace(session, filters);
  const includeMemberEmail = canViewWorkspaceReports(session.role);
  const summary = summarizeExport(reports);
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

  lines.push("", ...toSummaryLines(summary));

  return {
    csv: `\uFEFF${lines.join("\r\n")}\r\n`,
    summary
  };
}

export async function recordSalesReportsExport(
  session: AppSession,
  filters: OversightFilters,
  summary: Pick<ExportSummary, "reportCount" | "rowCount">
) {
  const auditFilters = canViewWorkspaceReports(session.role)
    ? filters
    : { ...filters, memberId: session.userId };

  await prisma.workspaceExportAuditLog.create({
    data: {
      workspaceId: session.workspaceId,
      actorId: session.userId,
      format: EXPORT_FORMAT_CSV,
      filtersJson: JSON.stringify(auditFilters),
      reportCount: summary.reportCount,
      rowCount: summary.rowCount
    }
  });
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

function summarizeExport(reports: ExportReport[]): ExportSummary {
  return reports.reduce(
    (summary, report) => {
      summary.reportCount += 1;
      for (const row of report.rows) {
        summary.rowCount += 1;
        summary.totalSalesAmount += Number(row.salesAmount);
        summary.totalUnitsSold += row.unitsSold;
      }
      return summary;
    },
    {
      reportCount: 0,
      rowCount: 0,
      totalSalesAmount: 0,
      totalUnitsSold: 0
    }
  );
}

function toSummaryLines(summary: ExportSummary) {
  return [
    toCsvLine([csvText("Summary")]),
    toCsvLine([csvText("Total reports"), csvNumber(summary.reportCount)]),
    toCsvLine([csvText("Total rows"), csvNumber(summary.rowCount)]),
    toCsvLine([csvText("Total sales amount"), csvMoney(summary.totalSalesAmount)]),
    toCsvLine([csvText("Total units sold"), csvNumber(summary.totalUnitsSold)])
  ];
}

export function salesReportsExportFilename(today = new Date()) {
  return `sales-reports-${today.toISOString().slice(0, 10)}.csv`;
}
