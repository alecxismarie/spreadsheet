import { redirect } from "next/navigation";
import { getSession, refreshSession } from "@/lib/auth/session";
import { SignInForm } from "@/components/auth/sign-in-form";

export default async function SignInPage() {
  const session = await getSession();
  if (session && (await refreshSession(session))) redirect("/overview");

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
        <SignInForm />
        <div className="mt-6 rounded-md bg-slate-50 p-4 text-sm text-muted">
          Demo: owner@northstar.test / demo1234
        </div>
      </section>
    </main>
  );
}
