import "server-only";

import bcrypt from "bcryptjs";
import { ReportingPeriodType, Role } from "@prisma/client";
import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";
import {
  isSignupRateLimited,
  normalizeSignInEmail,
  RATE_LIMITED_SIGNUP_MESSAGE,
  recordSignupAttempt
} from "@/lib/auth/rate-limit";
import { dbEmailSchema } from "@/lib/domain/db-constraints";
import {
  ownerNameSchema,
  slugifyWorkspaceName,
  workspaceNameSchema,
  workspaceSlugForAttempt
} from "@/lib/domain/workspace";
import { prisma } from "@/lib/prisma";

const MAX_SLUG_ATTEMPTS = 20;

const workspaceSignupSchema = z
  .object({
    workspaceName: workspaceNameSchema,
    ownerName: ownerNameSchema,
    email: dbEmailSchema(),
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

export type WorkspaceSignupState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

type SignupSession = {
  userId: string;
  workspaceId: string;
  role: Role;
  sessionVersion: number;
};

export type WorkspaceSignupResult =
  | (WorkspaceSignupState & { ok: false })
  | {
      ok: true;
      message: string;
      session: SignupSession;
    };

type RequestContext = {
  ip: string;
};

function fail(message: string, fieldErrors?: WorkspaceSignupState["fieldErrors"]): WorkspaceSignupResult {
  return { ok: false, message, fieldErrors };
}

function currentMonthPeriod(now: Date) {
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  return {
    type: ReportingPeriodType.MONTHLY,
    label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(startDate),
    startDate,
    endDate
  };
}

function isUniqueConstraintError(error: unknown, field: string) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === "string" && target.includes(field);
}

export async function createWorkspaceSignup(
  input: unknown,
  context: RequestContext,
  now = new Date()
): Promise<WorkspaceSignupResult> {
  const parsed = workspaceSignupSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Workspace signup validation failed.", parsed.error.flatten().fieldErrors);
  }

  const data = parsed.data;
  const email = normalizeSignInEmail(data.email);

  if (await isSignupRateLimited(email, context.ip, now)) {
    return fail(RATE_LIMITED_SIGNUP_MESSAGE);
  }
  await recordSignupAttempt(email, context.ip, now);

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true }
  });
  if (existingUser) {
    return fail("An account already exists for this email. Sign in or use password reset.");
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const baseSlug = slugifyWorkspaceName(data.workspaceName);
  const period = currentMonthPeriod(now);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = workspaceSlugForAttempt(baseSlug, attempt);

    try {
      const session = await prisma.$transaction(async (tx): Promise<SignupSession> => {
        const workspace = await tx.workspace.create({
          data: {
            name: data.workspaceName,
            slug,
            active: true
          },
          select: {
            id: true
          }
        });

        const user = await tx.user.create({
          data: {
            name: data.ownerName,
            email,
            passwordHash
          },
          select: {
            id: true,
            sessionVersion: true
          }
        });

        await tx.membership.create({
          data: {
            userId: user.id,
            workspaceId: workspace.id,
            role: Role.OWNER,
            active: true
          }
        });

        await tx.reportingPeriod.create({
          data: {
            workspaceId: workspace.id,
            ...period
          }
        });

        return {
          userId: user.id,
          workspaceId: workspace.id,
          role: Role.OWNER,
          sessionVersion: user.sessionVersion
        };
      });

      return {
        ok: true,
        message: "Workspace created.",
        session
      };
    } catch (error) {
      if (isUniqueConstraintError(error, "slug")) {
        continue;
      }
      if (isUniqueConstraintError(error, "email")) {
        return fail("An account already exists for this email. Sign in or use password reset.");
      }
      return fail("Workspace could not be created. Try again later.");
    }
  }

  return fail("Workspace slug could not be generated. Try a more specific workspace name.");
}
