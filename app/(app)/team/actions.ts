"use server";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  changeMemberRole,
  deactivateMember,
  inviteTeamMember,
  reactivateMember,
  type TeamActionState
} from "@/lib/services/team";

export async function inviteTeamMemberAction(
  _state: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const session = await requireCurrentSession();
  return inviteTeamMember(session, {
    email: formData.get("email"),
    role: formData.get("role")
  });
}

export async function changeMemberRoleAction(
  _state: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const session = await requireCurrentSession();
  return changeMemberRole(session, {
    membershipId: formData.get("membershipId"),
    role: formData.get("role")
  });
}

export async function deactivateMemberAction(
  _state: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const session = await requireCurrentSession();
  return deactivateMember(session, {
    membershipId: formData.get("membershipId")
  });
}

export async function reactivateMemberAction(
  _state: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const session = await requireCurrentSession();
  return reactivateMember(session, {
    membershipId: formData.get("membershipId")
  });
}
