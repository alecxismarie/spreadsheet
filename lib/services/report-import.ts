import { ReportAuditAction, SubmissionStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/universal";
import { canAccessMember } from "@/lib/auth/permissions";
import { refreshSession, type AppSession } from "@/lib/auth/session";
import { endOfDateFilter, startOfDateFilter } from "@/lib/domain/date-range";
import { prisma } from "@/lib/prisma";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const PREVIEW_ROWS = 20;
const SUPPORTED_EXTENSIONS = [".csv", ".xlsx"];

type ImportMapping = {
  customer?: string;
  product?: string;
  salesAmount?: string;
  unitsSold?: string;
  notes?: string;
};

type ParsedRow = Record<string, string>;
type ParsedImportInput = {
  ok: true;
  memberId: string;
  periodId: string;
  reportDate: string;
  filename: string;
  rows: ParsedRow[];
  mapping: Required<Pick<ImportMapping, "customer" | "product" | "salesAmount" | "unitsSold">> & ImportMapping;
};

export type ImportPreviewState = {
  ok: boolean;
  message: string;
  filename?: string;
  columns?: string[];
  rows?: ParsedRow[];
  previewRows?: ParsedRow[];
  suggestedMapping?: ImportMapping;
  ignoredEmptyRows?: number;
};

export type ImportRowsState = {
  ok: boolean;
  message: string;
  reportId?: string;
  summary?: {
    parsedRows: number;
    validRows: number;
    invalidRows: number;
    ignoredEmptyRows: number;
  };
  rowErrors?: Array<{ rowNumber: number; errors: string[] }>;
};

export type RemoveImportBatchState = {
  ok: boolean;
  message: string;
};

export async function previewImportFile(file: File | null): Promise<ImportPreviewState> {
  if (!file || file.size === 0) {
    return { ok: false, message: "Choose a CSV or Excel file to import." };
  }
  const extension = getExtension(file.name);
  if (extension === ".xls") {
    return { ok: false, message: "Legacy .xls files are no longer supported. Please save/export as .xlsx or .csv and try again." };
  }
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    return { ok: false, message: "Unsupported file type. Upload a CSV or XLSX file." };
  }
  if (!hasExpectedMime(file, extension)) {
    return { ok: false, message: "File type does not match the uploaded extension." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, message: "File is too large. The import limit is 5MB." };
  }

  let parsed: ImportPreviewState & { rows: ParsedRow[]; columns: string[]; ignoredEmptyRows: number };
  try {
    parsed = await parseSpreadsheet(file);
  } catch {
    return { ok: false, message: "The file could not be parsed. Check that it is a valid CSV or XLSX file." };
  }
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    message: `Parsed ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}.`,
    filename: file.name,
    columns: parsed.columns,
    rows: parsed.rows,
    previewRows: parsed.rows.slice(0, PREVIEW_ROWS),
    suggestedMapping: suggestMapping(parsed.columns),
    ignoredEmptyRows: parsed.ignoredEmptyRows
  };
}

export async function importRowsAsDraft(session: AppSession, input: unknown): Promise<ImportRowsState> {
  const currentSession = await refreshSession(session);
  if (!currentSession) {
    return { ok: false, message: "Your session is no longer active. Sign in again." };
  }
  session = currentSession;

  const parsed = parseImportInput(input);
  if (parsed.ok !== true) return parsed;

  const { memberId, periodId, reportDate, filename, rows, mapping } = parsed;
  if (!canAccessMember(session.role, session.userId, memberId)) {
    return { ok: false, message: "You do not have permission to import for this member." };
  }

  const [membership, period] = await Promise.all([
    prisma.membership.findFirst({
      where: { workspaceId: session.workspaceId, userId: memberId, active: true }
    }),
    prisma.reportingPeriod.findFirst({
      where: { id: periodId, workspaceId: session.workspaceId }
    })
  ]);

  if (!membership) {
    return { ok: false, message: "Selected member is not active in this workspace." };
  }
  if (!period) {
    return { ok: false, message: "Reporting period was not found." };
  }

  const validated = validateMappedRows(rows, mapping);
  if (validated.validRows.length > MAX_ROWS) {
    return { ok: false, message: `Import is limited to ${MAX_ROWS} rows.` };
  }
  if (validated.validRows.length === 0) {
    return { ok: false, message: "No valid rows were found to import." };
  }
  if (validated.rowErrors.length > 0) {
    return {
      ok: false,
      message: "Fix invalid rows before importing.",
      summary: {
        parsedRows: rows.length,
        validRows: validated.validRows.length,
        invalidRows: validated.rowErrors.length,
        ignoredEmptyRows: validated.ignoredEmptyRows
      },
      rowErrors: validated.rowErrors
    };
  }

  const from = startOfDateFilter(reportDate);
  const to = endOfDateFilter(reportDate);
  if (!from || !to) {
    return { ok: false, message: "Report date is invalid." };
  }

  const report = await prisma.$transaction(async (tx) => {
    const importBatchId = randomUUID();
    const existingDraft = await tx.salesReport.findFirst({
      where: {
        workspaceId: session.workspaceId,
        memberId,
        periodId,
        status: SubmissionStatus.DRAFT,
        reportDate: { gte: from, lte: to }
      },
      include: { rows: { orderBy: { rowOrder: "desc" } } },
      orderBy: { updatedAt: "desc" }
    });

    const draft =
      existingDraft ??
      (await tx.salesReport.create({
        data: {
          workspaceId: session.workspaceId,
          memberId,
          periodId,
          reportDate: from,
          status: SubmissionStatus.DRAFT
        },
        include: { rows: true }
      }));

    const startingOrder = existingDraft?.rows[0]?.rowOrder != null ? existingDraft.rows[0].rowOrder + 1 : 0;
    await tx.salesReportRow.createMany({
      data: validated.validRows.map((row, index) => ({
        reportId: draft.id,
        customer: row.customer,
        product: row.product,
        salesAmount: row.salesAmount,
        unitsSold: row.unitsSold,
        notes: row.notes || null,
        rowOrder: startingOrder + index,
        importBatchId,
        importFilename: filename
      }))
    });

    await tx.reportAuditLog.create({
      data: {
        workspaceId: session.workspaceId,
        reportId: draft.id,
        actorId: session.userId,
        action: ReportAuditAction.IMPORTED,
        message: `Imported ${validated.validRows.length} row${validated.validRows.length === 1 ? "" : "s"} from ${filename}.`
      }
    });

    return draft;
  });

  revalidatePath("/reports");
  revalidatePath("/overview");
  revalidatePath("/team");

  return {
    ok: true,
    message: `Imported ${validated.validRows.length} row${validated.validRows.length === 1 ? "" : "s"} into a draft report.`,
    reportId: report.id,
    summary: {
      parsedRows: rows.length,
      validRows: validated.validRows.length,
      invalidRows: 0,
      ignoredEmptyRows: validated.ignoredEmptyRows
    }
  };
}

export async function removeImportedBatch(session: AppSession, input: unknown): Promise<RemoveImportBatchState> {
  const currentSession = await refreshSession(session);
  if (!currentSession) {
    return { ok: false, message: "Your session is no longer active. Sign in again." };
  }
  session = currentSession;

  const data = input as Record<string, unknown>;
  const reportId = asString(data.reportId);
  const importBatchId = asString(data.importBatchId);
  if (!reportId || !importBatchId) {
    return { ok: false, message: "Imported batch was not found." };
  }

  const report = await prisma.salesReport.findFirst({
    where: { id: reportId, workspaceId: session.workspaceId },
    include: {
      rows: {
        where: { importBatchId },
        select: { id: true, importFilename: true }
      }
    }
  });
  if (!report || !canAccessMember(session.role, session.userId, report.memberId)) {
    return { ok: false, message: "Report was not found." };
  }
  if (report.status !== SubmissionStatus.DRAFT) {
    return { ok: false, message: "Imported batches can only be removed from draft reports." };
  }
  if (report.rows.length === 0) {
    return { ok: false, message: "Imported batch was not found." };
  }

  const filename = report.rows.find((row) => row.importFilename)?.importFilename ?? "uploaded file";
  const rowCount = report.rows.length;

  await prisma.$transaction(async (tx) => {
    await tx.salesReportRow.deleteMany({
      where: {
        reportId,
        importBatchId
      }
    });

    await tx.reportAuditLog.create({
      data: {
        workspaceId: session.workspaceId,
        reportId,
        actorId: session.userId,
        action: ReportAuditAction.IMPORT_REMOVED,
        message: `Removed ${rowCount} imported row${rowCount === 1 ? "" : "s"} from ${filename}.`
      }
    });
  });

  revalidatePath("/reports");
  revalidatePath("/overview");
  revalidatePath("/team");

  return { ok: true, message: `Removed ${rowCount} imported row${rowCount === 1 ? "" : "s"}.` };
}

async function parseSpreadsheet(file: File): Promise<ImportPreviewState & { rows: ParsedRow[]; columns: string[]; ignoredEmptyRows: number }> {
  const extension = getExtension(file.name);
  const sheetRows = extension === ".csv" ? await parseCsvRows(file) : await parseXlsxRows(file);
  const headerIndex = sheetRows.findIndex((row) => row.some((cell) => normalizeCell(cell)));
  if (headerIndex === -1) {
    return { ok: false, message: "The file is empty.", rows: [], columns: [], ignoredEmptyRows: 0 };
  }

  const columns = buildColumns(sheetRows[headerIndex]);
  if (columns.length === 0) {
    return { ok: false, message: "No column headers were found.", rows: [], columns: [], ignoredEmptyRows: 0 };
  }

  let ignoredEmptyRows = 0;
  const rows: ParsedRow[] = [];
  for (const row of sheetRows.slice(headerIndex + 1)) {
    if (!row.some((cell) => normalizeCell(cell))) {
      ignoredEmptyRows += 1;
      continue;
    }
    const record: ParsedRow = {};
    columns.forEach((column, index) => {
      record[column] = normalizeCell(row[index]);
    });
    rows.push(record);
  }

  if (rows.length > MAX_ROWS) {
    return { ok: false, message: `Import is limited to ${MAX_ROWS} rows.`, rows: [], columns, ignoredEmptyRows };
  }

  return { ok: true, message: "File parsed.", rows, columns, ignoredEmptyRows };
}

async function parseCsvRows(file: File) {
  const text = await file.text();
  const result = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: "greedy"
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors[0]?.message ?? "CSV could not be parsed.");
  }
  return result.data;
}

async function parseXlsxRows(file: File) {
  const buffer = await file.arrayBuffer();
  return readSheet(buffer, 1, {
    trim: true
  });
}

function parseImportInput(input: unknown):
  | ParsedImportInput
  | (ImportRowsState & { ok: false }) {
  const data = input as Record<string, unknown>;
  const rows = Array.isArray(data.rows) ? (data.rows as ParsedRow[]) : [];
  const mapping = data.mapping as ImportMapping | undefined;
  const normalizedMapping = {
    customer: asString(mapping?.customer),
    product: asString(mapping?.product),
    salesAmount: asString(mapping?.salesAmount),
    unitsSold: asString(mapping?.unitsSold),
    notes: asString(mapping?.notes)
  };
  const missingMapping = ["customer", "product", "salesAmount", "unitsSold"].filter(
    (field) => !normalizedMapping[field as keyof typeof normalizedMapping]
  );

  if (!data.memberId || typeof data.memberId !== "string") return { ok: false, message: "Member is required." };
  if (!data.periodId || typeof data.periodId !== "string") return { ok: false, message: "Reporting period is required." };
  if (!data.reportDate || typeof data.reportDate !== "string") return { ok: false, message: "Report date is required." };
  if (!data.filename || typeof data.filename !== "string") return { ok: false, message: "Import filename is missing." };
  if (rows.length === 0) return { ok: false, message: "No parsed rows were provided." };
  if (missingMapping.length > 0) return { ok: false, message: `Missing required column mapping: ${missingMapping.join(", ")}.` };
  const columns = new Set(rows.flatMap((row) => Object.keys(row)));
  const invalidMapping = Object.values(normalizedMapping).filter((column) => column && !columns.has(column));
  if (invalidMapping.length > 0) return { ok: false, message: "One or more mapped columns were not found in the parsed file." };

  return {
    ok: true,
    memberId: data.memberId,
    periodId: data.periodId,
    reportDate: data.reportDate,
    filename: data.filename,
    rows,
    mapping: normalizedMapping as Required<Pick<ImportMapping, "customer" | "product" | "salesAmount" | "unitsSold">> & ImportMapping
  };
}

function validateMappedRows(rows: ParsedRow[], mapping: Required<Pick<ImportMapping, "customer" | "product" | "salesAmount" | "unitsSold">> & ImportMapping) {
  const validRows: Array<{ customer: string; product: string; salesAmount: number; unitsSold: number; notes?: string }> = [];
  const rowErrors: Array<{ rowNumber: number; errors: string[] }> = [];
  let ignoredEmptyRows = 0;

  rows.forEach((row, index) => {
    const customer = sanitize(row[mapping.customer]);
    const product = sanitize(row[mapping.product]);
    const salesAmountRaw = sanitize(row[mapping.salesAmount]);
    const unitsSoldRaw = sanitize(row[mapping.unitsSold]);
    const notes = mapping.notes ? sanitize(row[mapping.notes]) : "";
    if (!customer && !product && !salesAmountRaw && !unitsSoldRaw && !notes) {
      ignoredEmptyRows += 1;
      return;
    }

    const errors: string[] = [];
    const salesAmount = parseMoney(salesAmountRaw);
    const unitsSold = parseInteger(unitsSoldRaw);
    if (!customer) errors.push("Missing customer");
    if (!product) errors.push("Missing product");
    if (salesAmount == null) errors.push("Invalid sales amount");
    else if (salesAmount < 0) errors.push("Negative sales amount");
    if (unitsSold == null) errors.push("Invalid units sold");
    else if (unitsSold < 0) errors.push("Negative units sold");

    if (errors.length > 0) {
      rowErrors.push({ rowNumber: index + 2, errors });
      return;
    }

    validRows.push({ customer, product, salesAmount: salesAmount!, unitsSold: unitsSold!, notes });
  });

  return { validRows, rowErrors, ignoredEmptyRows };
}

function getExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

function hasExpectedMime(file: File, extension: string) {
  if (!file.type) return true;
  if (extension === ".csv") {
    return ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"].includes(file.type);
  }
  if (extension === ".xlsx") {
    return file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return false;
}

function buildColumns(headerRow: unknown[]) {
  const seen = new Map<string, number>();
  return headerRow
    .map((cell) => sanitize(normalizeCell(cell)))
    .filter(Boolean)
    .map((column) => {
      const count = seen.get(column) ?? 0;
      seen.set(column, count + 1);
      return count === 0 ? column : `${column} ${count + 1}`;
    });
}

function suggestMapping(columns: string[]): ImportMapping {
  return {
    customer: findColumn(columns, ["customer", "client", "buyer", "account"]),
    product: findColumn(columns, ["product", "item", "service", "sku"]),
    salesAmount: findColumn(columns, ["sales", "amount", "revenue", "total", "price"]),
    unitsSold: findColumn(columns, ["units", "quantity", "qty", "count"]),
    notes: findColumn(columns, ["notes", "remarks", "comment"])
  };
}

function findColumn(columns: string[], aliases: string[]) {
  return columns.find((column) => aliases.some((alias) => normalizeName(column).includes(alias)));
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCell(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function sanitize(value: unknown) {
  return normalizeCell(value).replace(/\s+/g, " ").slice(0, 1000);
}

function parseMoney(value: string) {
  if (!value) return null;
  const normalized = value.replace(/[$,\s]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseInteger(value: string) {
  if (!value) return null;
  const normalized = value.replace(/[,\s]/g, "");
  if (!/^-?\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}
