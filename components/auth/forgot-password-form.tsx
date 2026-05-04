"use client";

import { useActionState } from "react";
import { requestPasswordResetAction } from "@/app/forgot-password/actions";
import type { PasswordResetRequestState } from "@/lib/auth/password-reset";

const initialState: PasswordResetRequestState = {
  ok: false,
  message: ""
};

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialState);

  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-ink">Email</span>
        <input
          name="email"
          type="email"
          required
          data-testid="forgot-email"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>
      {state.message ? (
        <div
          className={`rounded-md px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
          data-testid="forgot-message"
        >
          <p>{state.message}</p>
          {state.resetLink ? (
            <a href={state.resetLink} className="mt-2 block break-all font-mono text-xs underline" data-testid="forgot-reset-link">
              Development reset link
            </a>
          ) : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        data-testid="forgot-submit"
        className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Requesting..." : "Request reset link"}
      </button>
    </form>
  );
}
