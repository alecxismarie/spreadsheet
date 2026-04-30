import { createHash, randomBytes } from "crypto";
import { InvitationStatus, Prisma, Role, TeamAuditAction } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageWorkspace, canViewWorkspaceReports } from "@/lib/auth/permissions";
import { refreshSession, type AppSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const memberSelect = {
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

const inviteSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true
} satisfies Prisma.WorkspaceInvitationSelect;

const teamAuditSelect = {
  id: true,
  actorId: true,
  action: true,
  targetUserId: true,
  targetEmail: true,
  message: true,
  createdAt: true
} satisfies Prisma.TeamAuditLogSelect;

const roleSchema = z.nativeEnum(Role);
const emailSchema = z.string().trim().email().toLowerCase();

const inviteSchema = z.object({
  email: emailSchema,
  role: roleSchema
});

const roleChangeSchema = z.object({
  membershipId: z.string().min(1),
  role: roleSchema
});

const membershipSchema = z.object({
  membershipId: z.string().min(1)
});

export type TeamActionState = {
  ok: boolean;
  message: string;
  inviteLink?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type TeamManagementData = {
  memberships: Prisma.MembershipGetPayload<{ select: typeof memberSelect }>[];
  pendingInvitations: Prisma.WorkspaceInvitationGetPayload<{ select: typeof inviteSelect }>[];
  auditLogs: Prisma.TeamAuditLogGetPayload<{ select: typeof teamAuditSelect }>[];
};

class TeamServiceError extends Error {}

function fail(message: string, fieldErrors?: TeamActionState["fieldErrors"]): TeamActionState {
  return { ok: false, message, fieldErrors };
}

async function getCurrentManageSession(session: AppSession) {
  const currentSession = await refreshSession(session);
  if (!currentSession) throw new TeamServiceError("Your session is no longer active. Sign in again.");
  if (!canManageWorkspace(currentSession.role)) {
    throw new TeamServiceError("You do not have permission to manage team members.");
  }
  return currentSession;
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildInviteLink(token: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return `${baseUrl ?? ""}/invite/${token}`;
}

function roleLabel(role: Role) {
  return role.toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

async function ensureCanRemoveActiveOwner(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string
) {
  const remainingOwnerCount = await tx.membership.count({
    where: {
      workspaceId,
      active: true,
      role: Role.OWNER,
      NOT: { id: membershipId }
    }
  });

  if (remainingOwnerCount < 1) {
    throw new TeamServiceError("Cannot remove the last active owner from the workspace.");
  }
}

async function incrementUserSessionVersion(tx: Prisma.TransactionClient, userId: string) {
  await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } }
  });
}

export async function getTeamManagementData(session: AppSession): Promise<TeamManagementData> {
  const currentSession = await refreshSession(session);
  if (!currentSession) {
    return { memberships: [], pendingInvitations: [], auditLogs: [] };
  }

  const canManage = canManageWorkspace(currentSession.role);
  const canSeeWorkspaceReports = canViewWorkspaceReports(currentSession.role);
  const memberships = await prisma.membership.findMany({
    where: {
      workspaceId: currentSession.workspaceId,
      ...(canManage
        ? {}
        : {
            active: true,
            ...(canSeeWorkspaceReports ? {} : { userId: currentSession.userId })
          })
    },
    select: memberSelect,
    orderBy: [{ active: "desc" }, { role: "asc" }, { user: { name: "asc" } }]
  });

  if (!canManage) {
    return { memberships, pendingInvitations: [], auditLogs: [] };
  }

  const [pendingInvitations, auditLogs] = await Promise.all([
    prisma.workspaceInvitation.findMany({
      where: { workspaceId: currentSession.workspaceId, status: InvitationStatus.PENDING },
      select: inviteSelect,
      orderBy: { createdAt: "desc" }
    }),
    prisma.teamAuditLog.findMany({
      where: { workspaceId: currentSession.workspaceId },
      select: teamAuditSelect,
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]);

  return { memberships, pendingInvitations, auditLogs };
}

export async function inviteTeamMember(session: AppSession, input: unknown): Promise<TeamActionState> {
  let currentSession: AppSession;
  try {
    currentSession = await getCurrentManageSession(session);
  } catch (error) {
    return fail(error instanceof TeamServiceError ? error.message : "Team invite failed.");
  }

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Invite validation failed.", parsed.error.flatten().fieldErrors);
  }

  const { email, role } = parsed.data;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  try {
    await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email },
        include: {
          memberships: {
            where: { workspaceId: currentSession.workspaceId },
            select: { active: true }
          }
        }
      });
      const existingMembership = existingUser?.memberships[0];
      if (existingMembership?.active) {
        throw new TeamServiceError("That user is already an active member of this workspace.");
      }
      if (existingMembership && !existingMembership.active) {
        throw new TeamServiceError("That user already has a deactivated membership. Reactivate them instead.");
      }

      await tx.workspaceInvitation.updateMany({
        where: { workspaceId: currentSession.workspaceId, email, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.REVOKED }
      });

      await tx.workspaceInvitation.create({
        data: {
          workspaceId: currentSession.workspaceId,
          email,
          role,
          tokenHash,
          invitedById: currentSession.userId,
          expiresAt
        }
      });

      await tx.teamAuditLog.create({
        data: {
          workspaceId: currentSession.workspaceId,
          actorId: currentSession.userId,
          action: TeamAuditAction.INVITE_CREATED,
          targetEmail: email,
          message: `Invite created for ${email} as ${roleLabel(role)}.`
        }
      });
    });
  } catch (error) {
    return fail(error instanceof TeamServiceError ? error.message : "Team invite failed.");
  }

  revalidatePath("/team");
  return { ok: true, message: `Invite created for ${email}.`, inviteLink: buildInviteLink(token) };
}

export async function changeMemberRole(session: AppSession, input: unknown): Promise<TeamActionState> {
  let currentSession: AppSession;
  try {
    currentSession = await getCurrentManageSession(session);
  } catch (error) {
    return fail(error instanceof TeamServiceError ? error.message : "Role change failed.");
  }

  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Role change validation failed.", parsed.error.flatten().fieldErrors);
  }

  const { membershipId, role } = parsed.data;
  try {
    await prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, workspaceId: currentSession.workspaceId },
        include: { user: { select: { email: true, name: true } } }
      });
      if (!membership) throw new TeamServiceError("Member was not found.");
      if (membership.role === role) throw new TeamServiceError("That member already has this role.");
      if (membership.active && membership.role === Role.OWNER && role !== Role.OWNER) {
        await ensureCanRemoveActiveOwner(tx, currentSession.workspaceId, membership.id);
      }

      await tx.membership.update({
        where: { id: membership.id },
        data: { role }
      });
      await incrementUserSessionVersion(tx, membership.userId);
      await tx.teamAuditLog.create({
        data: {
          workspaceId: currentSession.workspaceId,
          actorId: currentSession.userId,
          action: TeamAuditAction.ROLE_CHANGED,
          targetUserId: membership.userId,
          targetEmail: membership.user.email,
          message: `${membership.user.name} changed from ${roleLabel(membership.role)} to ${roleLabel(role)}.`
        }
      });
    });
  } catch (error) {
    return fail(error instanceof TeamServiceError ? error.message : "Role change failed.");
  }

  revalidatePath("/team");
  return { ok: true, message: "Member role updated." };
}

export async function deactivateMember(session: AppSession, input: unknown): Promise<TeamActionState> {
  let currentSession: AppSession;
  try {
    currentSession = await getCurrentManageSession(session);
  } catch (error) {
    return fail(error instanceof TeamServiceError ? error.message : "Member deactivation failed.");
  }

  const parsed = membershipSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Member deactivation validation failed.", parsed.error.flatten().fieldErrors);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: parsed.data.membershipId, workspaceId: currentSession.workspaceId },
        include: { user: { select: { email: true, name: true } } }
      });
      if (!membership) throw new TeamServiceError("Member was not found.");
      if (!membership.active) throw new TeamServiceError("Member is already deactivated.");
      if (membership.role === Role.OWNER) {
        await ensureCanRemoveActiveOwner(tx, currentSession.workspaceId, membership.id);
      }

      await tx.membership.update({
        where: { id: membership.id },
        data: { active: false }
      });
      await incrementUserSessionVersion(tx, membership.userId);
      await tx.teamAuditLog.create({
        data: {
          workspaceId: currentSession.workspaceId,
          actorId: currentSession.userId,
          action: TeamAuditAction.MEMBER_DEACTIVATED,
          targetUserId: membership.userId,
          targetEmail: membership.user.email,
          message: `${membership.user.name} was deactivated.`
        }
      });
    });
  } catch (error) {
    return fail(error instanceof TeamServiceError ? error.message : "Member deactivation failed.");
  }

  revalidatePath("/team");
  return { ok: true, message: "Member deactivated." };
}

export async function reactivateMember(session: AppSession, input: unknown): Promise<TeamActionState> {
  let currentSession: AppSession;
  try {
    currentSession = await getCurrentManageSession(session);
  } catch (error) {
    return fail(error instanceof TeamServiceError ? error.message : "Member reactivation failed.");
  }

  const parsed = membershipSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Member reactivation validation failed.", parsed.error.flatten().fieldErrors);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: parsed.data.membershipId, workspaceId: currentSession.workspaceId },
        include: { user: { select: { email: true, name: true } } }
      });
      if (!membership) throw new TeamServiceError("Member was not found.");
      if (membership.active) throw new TeamServiceError("Member is already active.");

      await tx.membership.update({
        where: { id: membership.id },
        data: { active: true }
      });
      await incrementUserSessionVersion(tx, membership.userId);
      await tx.teamAuditLog.create({
        data: {
          workspaceId: currentSession.workspaceId,
          actorId: currentSession.userId,
          action: TeamAuditAction.MEMBER_REACTIVATED,
          targetUserId: membership.userId,
          targetEmail: membership.user.email,
          message: `${membership.user.name} was reactivated as ${roleLabel(membership.role)}.`
        }
      });
    });
  } catch (error) {
    return fail(error instanceof TeamServiceError ? error.message : "Member reactivation failed.");
  }

  revalidatePath("/team");
  return { ok: true, message: "Member reactivated." };
}
