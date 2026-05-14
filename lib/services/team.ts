import { createHash, randomBytes } from "crypto";
import { InvitationStatus, Prisma, Role, TeamAuditAction } from "@prisma/client";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";
import { canManageWorkspace, canViewWorkspaceReports } from "@/lib/auth/permissions";
import { refreshSession, type AppSession } from "@/lib/auth/session";
import { dbEmailSchema } from "@/lib/domain/db-constraints";
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
const emailSchema = dbEmailSchema();

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

const inviteAcceptanceSchema = z
  .object({
    token: z.string().trim().min(1).max(512),
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

export type TeamActionState = {
  ok: boolean;
  message: string;
  inviteLink?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type InviteAcceptanceState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type InviteAcceptanceDetails =
  | {
      state: "valid";
      workspaceName: string;
      email: string;
      role: Role;
      expiresAt: Date;
      accountExists: boolean;
    }
  | {
      state: "invalid" | "expired" | "revoked" | "accepted";
      message: string;
    };

export type AcceptedInviteSession = {
  userId: string;
  workspaceId: string;
  role: Role;
  sessionVersion: number;
};

export type InviteAcceptanceResult =
  | (InviteAcceptanceState & { ok: false })
  | {
      ok: true;
      message: string;
      session: AcceptedInviteSession;
    };

export type TeamManagementData = {
  memberships: Prisma.MembershipGetPayload<{ select: typeof memberSelect }>[];
  pendingInvitations: Prisma.WorkspaceInvitationGetPayload<{ select: typeof inviteSelect }>[];
  auditLogs: Prisma.TeamAuditLogGetPayload<{ select: typeof teamAuditSelect }>[];
};

class TeamServiceError extends Error {}

type InvitationCleanupClient = Pick<Prisma.TransactionClient, "workspaceInvitation">;

function fail(message: string, fieldErrors?: TeamActionState["fieldErrors"]): TeamActionState {
  return { ok: false, message, fieldErrors };
}

function inviteFail(message: string, fieldErrors?: InviteAcceptanceState["fieldErrors"]): InviteAcceptanceState & { ok: false } {
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

function nameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? "";
  const normalized = localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "Workspace member";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 120);
}

function inviteUnavailableMessage(status: InvitationStatus) {
  if (status === InvitationStatus.ACCEPTED) return "This invite has already been accepted.";
  if (status === InvitationStatus.REVOKED) return "This invite has been revoked.";
  if (status === InvitationStatus.EXPIRED) return "This invite has expired.";
  return "This invite link is invalid.";
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

export async function cleanupExpiredPendingInvitations(
  workspaceId: string,
  now = new Date(),
  options: { email?: string; client?: InvitationCleanupClient } = {}
) {
  const client = options.client ?? prisma;
  return client.workspaceInvitation.updateMany({
    where: {
      workspaceId,
      status: InvitationStatus.PENDING,
      expiresAt: { lte: now },
      ...(options.email ? { email: options.email } : {})
    },
    data: { status: InvitationStatus.EXPIRED }
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

  const now = new Date();
  await cleanupExpiredPendingInvitations(currentSession.workspaceId, now);
  const [pendingInvitations, auditLogs] = await Promise.all([
    prisma.workspaceInvitation.findMany({
      where: { workspaceId: currentSession.workspaceId, status: InvitationStatus.PENDING, expiresAt: { gt: now } },
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
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);

  try {
    await prisma.$transaction(async (tx) => {
      await cleanupExpiredPendingInvitations(currentSession.workspaceId, now, { email, client: tx });
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
        where: { workspaceId: currentSession.workspaceId, email, status: InvitationStatus.PENDING, expiresAt: { gt: now } },
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

export async function getInviteAcceptanceDetails(token: string | undefined, now = new Date()): Promise<InviteAcceptanceDetails> {
  const normalizedToken = token?.trim();
  if (!normalizedToken) {
    return { state: "invalid", message: "This invite link is invalid." };
  }

  const invite = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash: hashInviteToken(normalizedToken) },
    select: {
      id: true,
      workspaceId: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      workspace: {
        select: {
          name: true,
          active: true
        }
      }
    }
  });

  if (!invite) {
    return { state: "invalid", message: "This invite link is invalid." };
  }
  if (!invite.workspace.active) {
    return { state: "invalid", message: "This invite link is invalid." };
  }

  await cleanupExpiredPendingInvitations(invite.workspaceId, now);

  if (invite.status !== InvitationStatus.PENDING) {
    return {
      state:
        invite.status === InvitationStatus.ACCEPTED
          ? "accepted"
          : invite.status === InvitationStatus.REVOKED
            ? "revoked"
            : "expired",
      message: inviteUnavailableMessage(invite.status)
    };
  }

  if (invite.expiresAt <= now) {
    return { state: "expired", message: "This invite has expired." };
  }

  const accountExists = Boolean(
    await prisma.user.findUnique({
      where: { email: invite.email },
      select: { id: true }
    })
  );

  return {
    state: "valid",
    workspaceName: invite.workspace.name,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    accountExists
  };
}

export async function acceptWorkspaceInvitation(input: unknown, now = new Date()): Promise<InviteAcceptanceResult> {
  const parsed = inviteAcceptanceSchema.safeParse(input);
  if (!parsed.success) {
    return inviteFail("Invite acceptance failed.", parsed.error.flatten().fieldErrors);
  }

  const { token, password } = parsed.data;
  const tokenHash = hashInviteToken(token);
  const invite = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash },
    include: {
      workspace: { select: { name: true, active: true } }
    }
  });

  if (!invite) {
    return inviteFail("This invite link is invalid.");
  }
  if (!invite.workspace.active) {
    return inviteFail("This invite link is invalid.");
  }
  await cleanupExpiredPendingInvitations(invite.workspaceId, now);

  if (invite.status !== InvitationStatus.PENDING) {
    return inviteFail(inviteUnavailableMessage(invite.status));
  }
  if (invite.expiresAt <= now) {
    return inviteFail("This invite has expired.");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: invite.email },
    select: {
      id: true,
      passwordHash: true
    }
  });

  if (existingUser && !(await bcrypt.compare(password, existingUser.passwordHash))) {
    return inviteFail("Password did not match the existing account for this invite.");
  }

  const newUserPasswordHash = existingUser ? null : await bcrypt.hash(password, 10);

  try {
    const accepted = await prisma.$transaction(async (tx): Promise<AcceptedInviteSession> => {
      const reservedInvite = await tx.workspaceInvitation.updateMany({
        where: {
          id: invite.id,
          tokenHash,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: now }
        },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: now
        }
      });

      if (reservedInvite.count !== 1) {
        throw new TeamServiceError("This invite is no longer available.");
      }

      let user = await tx.user.findUnique({
        where: { email: invite.email },
        include: {
          memberships: {
            where: { workspaceId: invite.workspaceId },
            select: {
              id: true,
              active: true,
              role: true
            }
          }
        }
      });

      if (user && (!existingUser || user.id !== existingUser.id)) {
        throw new TeamServiceError("An account now exists for this invite email. Reload the invite and use that account password.");
      }

      if (!user) {
        user = await tx.user.create({
          data: {
            email: invite.email,
            name: nameFromEmail(invite.email),
            passwordHash: newUserPasswordHash!
          },
          include: {
            memberships: {
              where: { workspaceId: invite.workspaceId },
              select: {
                id: true,
                active: true,
                role: true
              }
            }
          }
        });
      }

      const existingMembership = user.memberships[0];
      if (existingMembership?.active) {
        throw new TeamServiceError("This account is already an active member of the invited workspace.");
      }

      if (existingMembership) {
        await tx.membership.update({
          where: { id: existingMembership.id },
          data: {
            active: true,
            role: invite.role
          }
        });
      } else {
        await tx.membership.create({
          data: {
            userId: user.id,
            workspaceId: invite.workspaceId,
            role: invite.role,
            active: true
          }
        });
      }

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
        select: {
          id: true,
          name: true,
          sessionVersion: true
        }
      });

      await tx.teamAuditLog.create({
        data: {
          workspaceId: invite.workspaceId,
          actorId: updatedUser.id,
          action: TeamAuditAction.INVITE_ACCEPTED,
          targetUserId: updatedUser.id,
          targetEmail: invite.email,
          message: `${updatedUser.name} accepted invite as ${roleLabel(invite.role)}.`
        }
      });

      return {
        userId: updatedUser.id,
        workspaceId: invite.workspaceId,
        role: invite.role,
        sessionVersion: updatedUser.sessionVersion
      };
    });

    revalidatePath("/team");
    return {
      ok: true,
      message: `Invite accepted for ${invite.workspace.name}.`,
      session: accepted
    };
  } catch (error) {
    return inviteFail(error instanceof TeamServiceError ? error.message : "Invite acceptance failed.");
  }
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
