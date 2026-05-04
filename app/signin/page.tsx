import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { getSession, refreshSession } from "@/lib/auth/session";
import { SignInForm } from "@/components/auth/sign-in-form";

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session && (await refreshSession(session))) redirect("/overview");
  const params = await searchParams;
  const resetComplete = params.reset === "success";

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <section className="w-full max-w-md rounded-lg border border-border bg-panel p-8 shadow-subtle">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Sales Oversight</p>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Sign in to your workspace</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Use seeded credentials after running the database seed.
          </p>
        </div>
        {resetComplete ? (
          <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="reset-success-message">
            Password reset complete. Sign in with your new password.
          </div>
        ) : null}
        <SignInForm />
        <Link href={"/forgot-password" as Route} className="mt-4 inline-flex text-sm font-semibold text-accent hover:underline" data-testid="forgot-password-link">
          Forgot password?
        </Link>
        <div className="mt-6 rounded-md bg-slate-50 p-4 text-sm text-muted">
          Demo: owner@northstar.test / demo1234
        </div>
      </section>
    </main>
  );
}
