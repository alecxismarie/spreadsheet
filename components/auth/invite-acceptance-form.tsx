"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/app/invite/[token]/actions";
import type { InviteAcceptanceState } from "@/lib/services/team";

const initialState: InviteAcceptanceState = {
  ok: false,
  message: ""
};

export function InviteAcceptanceForm({ token, accountExists }: { token: string; accountExists: boolean }) {
  const [state, action, pending] = useActionState(acceptInviteAction, initialState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {accountExists ? (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
          This email already has an account. Enter the existing account password to accept this invite; it will not be changed.
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-ink">{accountExists ? "Existing password" : "Password"}</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          data-testid="invite-password"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Confirm password</span>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          data-testid="invite-confirm-password"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>
      {state.message ? (
        <p className={state.ok ? "text-sm text-success" : "text-sm text-danger"} data-testid="invite-error">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        data-testid="invite-accept-submit"
        className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Accepting..." : "Accept invite"}
      </button>
    </form>
  );
}
