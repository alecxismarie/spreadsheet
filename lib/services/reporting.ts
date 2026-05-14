import { Prisma, ReportAuditAction, ReportingPeriodType, SubmissionStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccessMember, canReviewReports, canViewWorkspaceReports } from "@/lib/auth/permissions";
import { refreshSession, type AppSession } from "@/lib/auth/session";
import { canonicalReportDate, parseDateRangeFilters } from "@/lib/domain/date-range";
import {
  DB_STRING_LIMITS,
  dbVarcharSchema,
  decimal12_2Schema,
  nonNegativeIntSchema
} from "@/lib/domain/db-constraints";
import { DUPLICATE_REPORT_MESSAGE, isReportUniqueConstraintError } from "@/lib/domain/report-uniqueness";
import { prisma } from "@/lib/prisma";

const membershipListSelect = {
  id: true,
  userId: true,
  workspaceId: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true
    }
  }
} satisfies Prisma.MembershipSelect;

export const rowInputSchema = z.object({
  id: z.string().optional(),
  customer: dbVarcharSchema("Customer", DB_STRING_LIMITS.reportCustomer),
  product: dbVarcharSchema("Product", DB_STRING_LIMITS.reportProduct),
  salesAmount: decimal12_2Schema("Sales amount"),
  unitsSold: nonNegativeIntSchema("Units sold"),
  notes: z.string().trim().optional(),
  rowOrder: nonNegativeIntSchema("Row order")
});

export const reportInputSchema = z.object({
  reportId: z.string().optional(),
  memberId: z.string().min(1),
  periodId: z.string().min(1),
  reportDate: z.unknown().transform((value, ctx) => {
    const date = canonicalReportDate(value);
    if (!date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Report date must be a valid YYYY-MM-DD date." });
      return z.NEVER;
    }
    return date;
  }),
  statusIntent: z.enum(["SAVE_DRAFT", "SUBMIT"]),
  rows: z.array(rowInputSchema).min(1, "Add at least one row")
});


export type ReportSaveResult = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export async function getPeriods(workspaceId: string) {
  return prisma.reportingPeriod.findMany({
    where: { workspaceId },
    orderBy: [{ startDate: "desc" }, { type: "asc" }]
  });
}

export async function getWorkspaceMembers(workspaceId: string) {
  return prisma.membership.findMany({
    where: { workspaceId, active: true },
    select: membershipListSelect,
    orderBy: [{ role: "asc" }, { user: { name: "asc" } }]
  });
}

export async function getAccessibleWorkspaceMembers(session: AppSession) {
  const currentSession = await refreshSession(session);
  if (!currentSession) return [];

  return prisma.membership.findMany({
    where: {
      workspaceId: currentSession.workspaceId,
      active: true,
      ...(canViewWorkspaceReports(currentSession.role) ? {} : { userId: currentSession.userId })
    },
    select: membershipListSelect,
    orderBy: [{ role: "asc" }, { user: { name: "asc" } }]
  });
}

export async function getReportsForWorkspace(
  session: AppSession,
  filters: {
    memberId?: string;
    periodId?: string;
    periodType?: string;
    status?: SubmissionStatus;
    from?: string;
    to?: string;
  }
) {
  const currentSession = await refreshSession(session);
  if (!currentSession) return [];
  session = currentSession;

  const memberId = canViewWorkspaceReports(session.role) ? filters.memberId : session.userId;
  const dateRange = parseDateRangeFilters(filters.from, filters.to);
  if (!dateRange.ok) return [];
  const { from, to } = dateRange;
  const where: Prisma.SalesReportWhereInput = {
    workspaceId: session.workspaceId,
    ...(memberId ? { memberId } : {}),
    ...(filters.periodId ? { periodId: filters.periodId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.periodType ? { period: { type: filters.periodType as ReportingPeriodType } } : {}),
    ...(from || to
      ? {
          reportDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {})
          }
        }
      : {})
  };

  return prisma.salesReport.findMany({
    where,
    include: {
      member: { select: { id: true, name: true, email: true } },
      period: true,
      rows: { orderBy: { rowOrder: "asc" } },
      auditLogs: { orderBy: { createdAt: "desc" } },
      reviewComments: { orderBy: { createdAt: "desc" } }
    },
    orderBy: [{ reportDate: "desc" }, { updatedAt: "desc" }]
  });
}

export async function saveReport(session: AppSession, input: unknown): Promise<ReportSaveResult> {
  const currentSession = await refreshSession(session);
  if (!currentSession) {
    return { ok: false, message: "Your session is no longer active. Sign in again." };
  }
  session = currentSession;

  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Report validation failed.",
      fieldErrors: parsed.error.flatten().fieldErrors
    };
  }

  const data = parsed.data;
  if (!canAccessMember(session.role, session.userId, data.memberId)) {
    return { ok: false, message: "You do not have permission to edit this member's report." };
  }

  const membership = await prisma.membership.findFirst({
    where: {
      workspaceId: session.workspaceId,
      userId: data.memberId,
      active: true
    }
  });
  if (!membership) {
    return { ok: false, message: "Selected member is not active in this workspace." };
  }

  const period = await prisma.reportingPeriod.findFirst({
    where: { id: data.periodId, workspaceId: session.workspaceId }
  });
  if (!period) {
    return { ok: false, message: "Reporting period was not found." };
  }

  let existing = data.reportId
    ? await prisma.salesReport.findFirst({
        where: { id: data.reportId, workspaceId: session.workspaceId },
        include: { rows: true }
      })
    : null;

  if (data.reportId) {
    if (!existing || !canAccessMember(session.role, session.userId, existing.memberId)) {
      return { ok: false, message: "Report was not found." };
    }

    const ownsNeedsReviewReport = existing.status === "NEEDS_REVIEW" && existing.memberId === session.userId;
    if (existing.status !== "DRAFT" && !ownsNeedsReviewReport) {
      return { ok: false, message: "Only draft reports or your own needs-review reports can be edited." };
    }
  }

  const conflictingReport = await prisma.salesReport.findFirst({
    where: {
      workspaceId: session.workspaceId,
      memberId: data.memberId,
      periodId: data.periodId,
      reportDate: data.reportDate,
      ...(existing ? { NOT: { id: existing.id } } : {})
    },
    include: { rows: true }
  });

  if (conflictingReport) {
    if (!data.reportId && conflictingReport.status === SubmissionStatus.DRAFT) {
      existing = conflictingReport;
    } else {
      return { ok: false, message: DUPLICATE_REPORT_MESSAGE };
    }
  }

  const isResubmission = existing?.status === "NEEDS_REVIEW" && data.statusIntent === "SUBMIT";
  const nextStatus =
    data.statusIntent === "SUBMIT"
      ? SubmissionStatus.SUBMITTED
      : existing?.status === "NEEDS_REVIEW"
        ? SubmissionStatus.NEEDS_REVIEW
        : SubmissionStatus.DRAFT;

  try {
    await prisma.$transaction(async (tx) => {
      const existingRowById = new Map((existing?.rows ?? []).map((row) => [row.id, row]));
      const auditAction = isResubmission
        ? ReportAuditAction.RESUBMITTED
        : existing && nextStatus === "SUBMITTED" && existing.status !== "SUBMITTED"
        ? ReportAuditAction.SUBMITTED
        : existing
          ? ReportAuditAction.UPDATED
          : ReportAuditAction.CREATED;
      const report = existing
        ? await tx.salesReport.update({
            where: { id: existing.id },
            data: {
              memberId: data.memberId,
              periodId: data.periodId,
              reportDate: data.reportDate,
              status: nextStatus,
              submittedAt: nextStatus === "SUBMITTED" ? new Date() : existing.submittedAt,
              reviewedAt: isResubmission ? null : existing.reviewedAt,
              reviewerId: isResubmission ? null : existing.reviewerId
            }
          })
        : await tx.salesReport.create({
            data: {
              workspaceId: session.workspaceId,
              memberId: data.memberId,
              periodId: data.periodId,
              reportDate: data.reportDate,
              status: nextStatus,
              submittedAt: nextStatus === "SUBMITTED" ? new Date() : null
            }
          });

      await tx.salesReportRow.deleteMany({ where: { reportId: report.id } });
      await tx.salesReportRow.createMany({
        data: data.rows.map((row) => {
          const existingRow = row.id ? existingRowById.get(row.id) : null;
          return {
            reportId: report.id,
            customer: row.customer,
            product: row.product,
            salesAmount: row.salesAmount,
            unitsSold: row.unitsSold,
            notes: row.notes || null,
            rowOrder: row.rowOrder,
            importBatchId: existingRow?.importBatchId ?? null,
            importFilename: existingRow?.importFilename ?? null
          };
        })
      });

      await tx.reportAuditLog.createMany({
        data: [
          {
            workspaceId: session.workspaceId,
            reportId: report.id,
            actorId: session.userId,
            action: auditAction,
            message:
              auditAction === ReportAuditAction.RESUBMITTED
                ? "Report revised and resubmitted for manager review."
                : auditAction === ReportAuditAction.SUBMITTED
                ? "Report submitted for manager review."
                : auditAction === ReportAuditAction.CREATED
                  ? "Report draft created."
                  : nextStatus === "NEEDS_REVIEW"
                    ? "Needs-review report updated."
                    : "Report draft updated."
          },
          ...(!existing && nextStatus === "SUBMITTED"
            ? [
                {
                  workspaceId: session.workspaceId,
                  reportId: report.id,
                  actorId: session.userId,
                  action: ReportAuditAction.SUBMITTED,
                  message: "Report submitted for manager review."
                }
              ]
            : [])
        ]
      });
    });
  } catch (error) {
    if (isReportUniqueConstraintError(error)) {
      return { ok: false, message: DUPLICATE_REPORT_MESSAGE };
    }
    return { ok: false, message: "Report could not be saved." };
  }

  revalidatePath("/reports");
  revalidatePath("/overview");
  revalidatePath("/team");
  return {
    ok: true,
    message: isResubmission ? "Report resubmitted." : nextStatus === "SUBMITTED" ? "Report submitted." : "Changes saved."
  };
}

export async function updateReportStatus(
  session: AppSession,
  reportId: string,
  status: SubmissionStatus,
  message?: string
) {
  const currentSession = await refreshSession(session);
  if (!currentSession) {
    return { ok: false, message: "Your session is no longer active. Sign in again." };
  }
  session = currentSession;

  if (!canReviewReports(session.role)) {
    return { ok: false, message: "You do not have permission to review reports." };
  }

  const report = await prisma.salesReport.findFirst({
    where: { id: reportId, workspaceId: session.workspaceId }
  });
  if (!report) {
    return { ok: false, message: "Report was not found." };
  }
  if (report.memberId === session.userId) {
    return { ok: false, message: "You cannot review your own report." };
  }

  if (status !== "APPROVED" && status !== "NEEDS_REVIEW") {
    return { ok: false, message: "Reports can only be approved or marked as needs review from this workflow." };
  }

  if (report.status !== "SUBMITTED") {
    return { ok: false, message: "Only submitted reports can be reviewed." };
  }

  const reviewMessage = message?.trim();

  await prisma.$transaction(async (tx) => {
    await tx.salesReport.update({
      where: { id: reportId },
      data: {
        status,
        reviewedAt: new Date(),
        reviewerId: session.userId
      }
    });

    if (status === "NEEDS_REVIEW") {
      await tx.reportReviewComment.create({
        data: {
          workspaceId: session.workspaceId,
          reportId,
          authorId: session.userId,
          statusContext: SubmissionStatus.NEEDS_REVIEW,
          body: reviewMessage || "Report marked as needs review."
        }
      });
    }

    await tx.reportAuditLog.create({
      data: {
        workspaceId: session.workspaceId,
        reportId,
        actorId: session.userId,
        action: status === "APPROVED" ? ReportAuditAction.APPROVED : ReportAuditAction.NEEDS_REVIEW,
        message: reviewMessage || (status === "APPROVED" ? "Report approved." : "Report marked as needs review.")
      }
    });
  });

  revalidatePath("/reports");
  revalidatePath("/overview");
  revalidatePath("/team");
  return { ok: true, message: "Report status updated." };
}
