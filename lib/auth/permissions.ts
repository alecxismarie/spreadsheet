import { Role } from "@prisma/client";

export function canManageWorkspace(role: Role) {
  return role === "OWNER";
}

export function canViewWorkspaceReports(role: Role) {
  return role === "OWNER" || role === "MANAGER";
}

export function canReviewReports(role: Role) {
  return role === "OWNER" || role === "MANAGER";
}

export function canAccessMember(role: Role, sessionUserId: string, memberId: string) {
  return canViewWorkspaceReports(role) || sessionUserId === memberId;
}
