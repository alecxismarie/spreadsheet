"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/lib/auth/actions";

const initialState: SignInState = {};

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);

  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-ink">Email</span>
        <input
          name="email"
          type="email"
          required
          data-testid="sign-in-email"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Password</span>
        <input
          name="password"
          type="password"
          required
          data-testid="sign-in-password"
          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
        />
      </label>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        data-testid="sign-in-submit"
        className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
