"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  changeMemberRoleAction,
  deactivateMemberAction,
  inviteTeamMemberAction,
  reactivateMemberAction
} from "@/app/(app)/team/actions";
import type { TeamActionState } from "@/lib/services/team";

type Role = "OWNER" | "MANAGER" | "MEMBER";
type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
type TeamAuditAction = "INVITE_CREATED" | "INVITE_ACCEPTED" | "ROLE_CHANGED" | "MEMBER_DEACTIVATED" | "MEMBER_REACTIVATED";

type TeamMember = {
  id: string;
  userId: string;
  role: Role;
  active: boolean;
  user: {
    id: string;
    name: string;
    email: string;
  };
};

type PendingInvitation = {
  id: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
};

type TeamAudit = {
  id: string;
  action: TeamAuditAction;
  targetEmail: string | null;
  message: string | null;
  createdAt: string;
};

const roles: Role[] = ["OWNER", "MANAGER", "MEMBER"];
const emptyState: TeamActionState = { ok: false, message: "" };

export function TeamManagementPanel({
  members,
  pendingInvitations,
  auditLogs
}: {
  members: TeamMember[];
  pendingInvitations: PendingInvitation[];
  auditLogs: TeamAudit[];
}) {
  const router = useRouter();
  const [inviteState, inviteAction, invitePending] = useActionState(inviteTeamMemberAction, emptyState);
  const [roleState, roleAction, rolePending] = useActionState(changeMemberRoleAction, emptyState);
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(deactivateMemberAction, emptyState);
  const [reactivateState, reactivateAction, reactivatePending] = useActionState(reactivateMemberAction, emptyState);
  const [lastAction, setLastAction] = useState<"invite" | "role" | "deactivate" | "reactivate" | null>(null);
  const actionState =
    lastAction === "invite"
      ? inviteState
      : lastAction === "role"
        ? roleState
        : lastAction === "deactivate"
          ? deactivateState
          : lastAction === "reactivate"
            ? reactivateState
            : emptyState;

  useEffect(() => {
    if (inviteState.ok || roleState.ok || deactivateState.ok || reactivateState.ok) {
      router.refresh();
    }
  }, [deactivateState.ok, inviteState.ok, reactivateState.ok, roleState.ok, router]);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-white shadow-subtle">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold text-ink">Team management</h2>
          <p className="mt-1 text-sm text-muted">Invite users, update roles, and control member access.</p>
        </div>
        <div className="space-y-4 p-4">
          <form action={inviteAction} onSubmit={() => setLastAction("invite")} className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
            <input
              name="email"
              type="email"
              required
              placeholder="new.member@example.com"
              data-testid="team-invite-email"
              className="rounded-md border border-border px-3 py-2 text-sm"
            />
            <select
              name="role"
              defaultValue="MEMBER"
              data-testid="team-invite-role"
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={invitePending}
              data-testid="team-invite-submit"
              className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Invite
            </button>
          </form>

          {actionState.message ? <ActionMessage state={actionState} /> : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-white shadow-subtle">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold text-ink">Members</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3">Member</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((member) => (
                <tr key={member.id} data-testid={`team-member-row-${member.userId}`}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink">{member.user.name}</p>
                    <p className="text-xs text-muted">{member.user.email}</p>
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill active={member.active} />
                  </td>
                  <td className="px-5 py-3">
                    <form action={roleAction} onSubmit={() => setLastAction("role")} className="flex items-center gap-2">
                      <input type="hidden" name="membershipId" value={member.id} />
                      <select
                        name="role"
                        defaultValue={member.role}
                        data-testid={`team-role-select-${member.id}`}
                        className="rounded-md border border-border px-3 py-2 text-sm"
                      >
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={rolePending}
                        data-testid={`team-role-submit-${member.id}`}
                        className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="px-5 py-3">
                    {member.active ? (
                      <form action={deactivateAction} onSubmit={() => setLastAction("deactivate")}>
                        <input type="hidden" name="membershipId" value={member.id} />
                        <button
                          type="submit"
                          disabled={deactivatePending}
                          data-testid={`team-deactivate-${member.id}`}
                          className="rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      </form>
                    ) : (
                      <form action={reactivateAction} onSubmit={() => setLastAction("reactivate")}>
                        <input type="hidden" name="membershipId" value={member.id} />
                        <button
                          type="submit"
                          disabled={reactivatePending}
                          data-testid={`team-reactivate-${member.id}`}
                          className="rounded-md border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-white shadow-subtle">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold text-ink">Pending invites</h2>
        </div>
        <div className="divide-y divide-border">
          {pendingInvitations.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">No pending invites.</p>
          ) : (
            pendingInvitations.map((invite) => (
              <div key={invite.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_120px_160px]" data-testid="team-pending-invite">
                <div>
                  <p className="font-medium text-ink">{invite.email}</p>
                  <p className="text-xs text-muted">Created {formatDate(invite.createdAt)}</p>
                </div>
                <p>{invite.role}</p>
                <p className="text-muted">Expires {formatDate(invite.expiresAt)}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-white shadow-subtle">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold text-ink">Team activity</h2>
        </div>
        <div className="divide-y divide-border">
          {auditLogs.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">No team activity yet.</p>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[180px_1fr]" data-testid="team-audit-log">
                <p className="text-muted">{formatDate(log.createdAt)}</p>
                <p className="text-ink">{log.message ?? activityLabel(log.action, log.targetEmail)}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ActionMessage({ state }: { state: TeamActionState }) {
  return (
    <div
      data-testid="team-action-message"
      className={`rounded-md px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
    >
      <p>{state.message}</p>
      {state.inviteLink ? (
        <p className="mt-1 break-all font-mono text-xs" data-testid="team-invite-link">
          {state.inviteLink}
        </p>
      ) : null}
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {active ? "Active" : "Deactivated"}
    </span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function activityLabel(action: TeamAuditAction, targetEmail: string | null) {
  const target = targetEmail ? ` for ${targetEmail}` : "";
  return `${action.replaceAll("_", " ").toLowerCase()}${target}.`;
}
