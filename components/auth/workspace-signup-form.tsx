"use client";

import Link from "next/link";
import { useActionState } from "react";
import { workspaceSignupAction } from "@/app/signup/actions";
import type { WorkspaceSignupState } from "@/lib/services/workspace-signup";

const initialState: WorkspaceSignupState = {
  ok: false,
  message: ""
};

export function WorkspaceSignupForm() {
  const [state, action, pending] = useActionState(workspaceSignupAction, initialState);

  return (
    <form action={action} className="space-y-4">
      <FieldError errors={state.fieldErrors?.workspaceName} />
      <label className="block">
        <span className="text-sm font-medium text-ink">Workspace name</span>
        <input
          name="workspaceName"
          required
          maxLength={120}
          data-testid="signup-workspace-name"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <FieldError errors={state.fieldErrors?.ownerName} />
      <label className="block">
        <span className="text-sm font-medium text-ink">Owner name</span>
        <input
          name="ownerName"
          required
          maxLength={120}
          data-testid="signup-owner-name"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <FieldError errors={state.fieldErrors?.email} />
      <label className="block">
        <span className="text-sm font-medium text-ink">Email</span>
        <input
          name="email"
          type="email"
          required
          data-testid="signup-email"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <FieldError errors={state.fieldErrors?.password} />
      <label className="block">
        <span className="text-sm font-medium text-ink">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          data-testid="signup-password"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>

      <FieldError errors={state.fieldErrors?.confirmPassword} />
      <label className="block">
        <span className="text-sm font-medium text-ink">Confirm password</span>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          data-testid="signup-confirm-password"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>

      {state.message ? (
        <p className={state.ok ? "text-sm text-success" : "text-sm text-danger"} data-testid="signup-message">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        data-testid="signup-submit"
        className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating workspace..." : "Create workspace"}
      </button>

      <p className="text-sm text-muted">
        Already have a workspace?{" "}
        <Link href="/signin" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;

  return (
    <p className="text-sm text-danger" data-testid="signup-field-error">
      {errors[0]}
    </p>
  );
}
