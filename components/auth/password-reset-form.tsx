"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/app/reset-password/[token]/actions";
import type { PasswordResetState } from "@/lib/auth/password-reset";

const initialState: PasswordResetState = {
  ok: false,
  message: ""
};

export function PasswordResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="text-sm font-medium text-ink">New password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          data-testid="reset-password"
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
          data-testid="reset-confirm-password"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>
      {state.message ? (
        <p className={state.ok ? "text-sm text-success" : "text-sm text-danger"} data-testid="reset-error">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        data-testid="reset-submit"
        className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Saving..." : "Reset password"}
      </button>
    </form>
  );
}
