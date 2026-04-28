"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, clearSession } from "@/lib/auth/session";
import {
  clearSignInRateLimit,
  INVALID_SIGN_IN_MESSAGE,
  isSignInRateLimited,
  normalizeSignInEmail,
  pruneExpiredSignInRateLimits,
  RATE_LIMITED_SIGN_IN_MESSAGE,
  recordFailedSignIn,
  resolveClientIp
} from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/prisma";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export type SignInState = {
  error?: string;
};

export async function signInAction(_state: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const email = normalizeSignInEmail(parsed.data.email);
  const headerStore = await headers();
  const ip = resolveClientIp(headerStore);

  if (await isSignInRateLimited(email, ip)) {
    return { error: RATE_LIMITED_SIGN_IN_MESSAGE };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { where: { active: true }, orderBy: { createdAt: "asc" } } }
  });

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    await recordFailedSignIn(email, ip);
    return { error: INVALID_SIGN_IN_MESSAGE };
  }

  const membership = user.memberships[0];
  if (!membership) {
    await recordFailedSignIn(email, ip);
    return { error: INVALID_SIGN_IN_MESSAGE };
  }

  await clearSignInRateLimit(email, ip);
  await pruneExpiredSignInRateLimits();
  await createSession(user.id, membership.workspaceId, membership.role, user.sessionVersion);
  redirect("/overview");
}

export async function signOutAction() {
  await clearSession();
  redirect("/signin");
}
