"use server";

import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { acceptWorkspaceInvitation, type InviteAcceptanceState } from "@/lib/services/team";

export async function acceptInviteAction(
  _state: InviteAcceptanceState,
  formData: FormData
): Promise<InviteAcceptanceState> {
  const result = await acceptWorkspaceInvitation({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword")
  });

  if (!result.ok) {
    return result;
  }

  await createSession(result.session.userId, result.session.workspaceId, result.session.role, result.session.sessionVersion);
  redirect("/overview");
}
