"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, getSession, refreshSession } from "@/lib/auth/session";
import { resolveClientIp } from "@/lib/auth/rate-limit";
import { createWorkspaceSignup, type WorkspaceSignupState } from "@/lib/services/workspace-signup";

export async function workspaceSignupAction(
  _state: WorkspaceSignupState,
  formData: FormData
): Promise<WorkspaceSignupState> {
  const existingSession = await getSession();
  if (existingSession && (await refreshSession(existingSession))) {
    redirect("/overview");
  }

  const headerStore = await headers();
  const result = await createWorkspaceSignup(
    {
      workspaceName: formData.get("workspaceName"),
      ownerName: formData.get("ownerName"),
      email: formData.get("email"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword")
    },
    {
      ip: resolveClientIp(headerStore)
    }
  );

  if (!result.ok) {
    return result;
  }

  await createSession(result.session.userId, result.session.workspaceId, result.session.role, result.session.sessionVersion);
  redirect("/team");
}
