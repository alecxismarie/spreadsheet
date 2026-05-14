import "server-only";

import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";
import { dbEmailSchema } from "@/lib/domain/db-constraints";
import {
  clearPasswordResetTokenRateLimit,
  hashClientIp,
  isPasswordResetRequestRateLimited,
  isPasswordResetTokenRateLimited,
  normalizeSignInEmail,
  recordFailedPasswordResetToken,
  recordPasswordResetRequest
} from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/prisma";

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
export const PASSWORD_RESET_GENERIC_MESSAGE = "If an account exists for that email, a reset link has been created/sent.";

const resetRequestSchema = z.object({
  email: dbEmailSchema("Enter a valid email address.")
});

const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1).max(512),
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

export type PasswordResetRequestState = {
  ok: boolean;
  message: string;
  resetLink?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type PasswordResetDetails =
  | {
      state: "valid";
    }
  | {
      state: "invalid" | "expired" | "used";
      message: string;
    };

export type PasswordResetState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

type RequestContext = {
  ip: string;
  userAgent?: string;
};

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function resetLink(token: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const path = `/reset-password/${token}`;
  return baseUrl ? `${baseUrl}${path}` : path;
}

function shouldShowResetLink() {
  return process.env.NODE_ENV !== "production";
}

function blockedTokenMessage(state: "invalid" | "expired" | "used") {
  if (state === "expired") return "This reset link has expired.";
  if (state === "used") return "This reset link has already been used.";
  return "This reset link is invalid.";
}

function requestFail(message: string, fieldErrors?: PasswordResetRequestState["fieldErrors"]): PasswordResetRequestState {
  return { ok: false, message, fieldErrors };
}

function resetFail(message: string, fieldErrors?: PasswordResetState["fieldErrors"]): PasswordResetState {
  return { ok: false, message, fieldErrors };
}

export async function requestPasswordReset(
  input: unknown,
  context: RequestContext,
  now = new Date()
): Promise<PasswordResetRequestState> {
  const parsed = resetRequestSchema.safeParse(input);
  if (!parsed.success) {
    return requestFail("Password reset request failed.", parsed.error.flatten().fieldErrors);
  }

  const email = normalizeSignInEmail(parsed.data.email);
  console.info("Password reset requested.");

  if (await isPasswordResetRequestRateLimited(email, context.ip, now)) {
    return { ok: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
  }
  await recordPasswordResetRequest(email, context.ip, now);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      memberships: {
        where: { active: true },
        select: { id: true },
        take: 1
      }
    }
  });

  if (!user || user.memberships.length === 0) {
    return { ok: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
  }

  const token = randomBytes(RESET_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null
      },
      data: {
        usedAt: now
      }
    });

    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        requestedIpHash: hashClientIp(context.ip),
        userAgent: context.userAgent?.slice(0, 1000) || null
      }
    });
  });

  console.info("Password reset token created.", { userId: user.id });
  return {
    ok: true,
    message: PASSWORD_RESET_GENERIC_MESSAGE,
    resetLink: shouldShowResetLink() ? resetLink(token) : undefined
  };
}

export async function getPasswordResetDetails(token: string | undefined, now = new Date()): Promise<PasswordResetDetails> {
  const normalizedToken = token?.trim();
  if (!normalizedToken) {
    return { state: "invalid", message: blockedTokenMessage("invalid") };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(normalizedToken) },
    select: {
      expiresAt: true,
      usedAt: true
    }
  });

  if (!resetToken) return { state: "invalid", message: blockedTokenMessage("invalid") };
  if (resetToken.usedAt) return { state: "used", message: blockedTokenMessage("used") };
  if (resetToken.expiresAt <= now) return { state: "expired", message: blockedTokenMessage("expired") };
  return { state: "valid" };
}

export async function resetPasswordWithToken(
  input: unknown,
  context: RequestContext,
  now = new Date()
): Promise<PasswordResetState> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return resetFail("Password reset failed.", parsed.error.flatten().fieldErrors);
  }

  const { token, password } = parsed.data;
  if (await isPasswordResetTokenRateLimited(token, context.ip, now)) {
    return resetFail("This reset link is temporarily unavailable. Try again later.");
  }

  const tokenHash = hashResetToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true
        }
      }
    }
  });

  if (!resetToken) {
    await recordFailedPasswordResetToken(token, context.ip, now);
    return resetFail(blockedTokenMessage("invalid"));
  }
  if (resetToken.usedAt) {
    await recordFailedPasswordResetToken(token, context.ip, now);
    return resetFail(blockedTokenMessage("used"));
  }
  if (resetToken.expiresAt <= now) {
    await recordFailedPasswordResetToken(token, context.ip, now);
    return resetFail(blockedTokenMessage("expired"));
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.$transaction(async (tx) => {
      const reservedToken = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          tokenHash,
          usedAt: null,
          expiresAt: { gt: now }
        },
        data: {
          usedAt: now
        }
      });

      if (reservedToken.count !== 1) {
        throw new Error("Password reset token was already used.");
      }

      await tx.user.update({
        where: { id: resetToken.user.id },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 }
        }
      });

      await tx.passwordResetToken.updateMany({
        where: {
          userId: resetToken.user.id,
          usedAt: null
        },
        data: {
          usedAt: now
        }
      });
    });
  } catch {
    await recordFailedPasswordResetToken(token, context.ip, now);
    return resetFail("This reset link is no longer available.");
  }

  await clearPasswordResetTokenRateLimit(token, context.ip);
  console.info("Password reset completed.", { userId: resetToken.user.id });
  return { ok: true, message: "Password reset complete." };
}
