"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, clearSession } from "@/lib/auth/session";
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

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { memberships: { where: { active: true }, orderBy: { createdAt: "asc" } } }
  });

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return { error: "Invalid email or password." };
  }

  const membership = user.memberships[0];
  if (!membership) {
    return { error: "No active workspace membership found." };
  }

  await createSession(user.id, membership.workspaceId, membership.role);
  redirect("/overview");
}

export async function signOutAction() {
  await clearSession();
  redirect("/signin");
}
