"use server";

import { SubmissionStatus } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import {
  importRowsAsDraft,
  previewImportFile,
  removeImportedBatch,
  type ImportPreviewState,
  type ImportRowsState,
  type RemoveImportBatchState
} from "@/lib/services/report-import";
import { saveReport, updateReportStatus, type ReportSaveResult } from "@/lib/services/reporting";

export async function saveReportAction(
  _state: ReportSaveResult,
  formData: FormData
): Promise<ReportSaveResult> {
  const session = await requireSession();
  const rowsRaw = formData.get("rows");
  let rows: unknown[] = [];
  try {
    rows = typeof rowsRaw === "string" ? JSON.parse(rowsRaw) : [];
  } catch {
    return { ok: false, message: "Report rows could not be read." };
  }

  return saveReport(session, {
    reportId: formData.get("reportId") || undefined,
    memberId: formData.get("memberId"),
    periodId: formData.get("periodId"),
    reportDate: formData.get("reportDate"),
    statusIntent: formData.get("statusIntent"),
    rows
  });
}

export type ReviewReportState = {
  ok: boolean;
  message: string;
};

export async function reviewReportAction(
  _state: ReviewReportState,
  formData: FormData
): Promise<ReviewReportState> {
  const session = await requireSession();
  const reportId = String(formData.get("reportId"));
  const status = String(formData.get("status")) as SubmissionStatus;
  const reviewNote = String(formData.get("reviewNote") ?? "");
  return updateReportStatus(session, reportId, status, reviewNote);
}

export async function previewImportAction(
  _state: ImportPreviewState,
  formData: FormData
): Promise<ImportPreviewState> {
  await requireSession();
  const file = formData.get("file");
  return previewImportFile(file instanceof File ? file : null);
}

export async function importRowsAction(
  _state: ImportRowsState,
  formData: FormData
): Promise<ImportRowsState> {
  const session = await requireSession();
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { ok: false, message: "Parsed rows could not be read." };
  }

  return importRowsAsDraft(session, {
    memberId: formData.get("memberId"),
    periodId: formData.get("periodId"),
    reportDate: formData.get("reportDate"),
    filename: formData.get("filename"),
    rows,
    mapping: {
      customer: formData.get("customer"),
      product: formData.get("product"),
      salesAmount: formData.get("salesAmount"),
      unitsSold: formData.get("unitsSold"),
      notes: formData.get("notes") || undefined
    }
  });
}

export async function removeImportBatchAction(
  _state: RemoveImportBatchState,
  formData: FormData
): Promise<RemoveImportBatchState> {
  const session = await requireSession();
  return removeImportedBatch(session, {
    reportId: formData.get("reportId"),
    importBatchId: formData.get("importBatchId")
  });
}
