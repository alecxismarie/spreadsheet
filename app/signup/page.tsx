import { redirect } from "next/navigation";
import { getSession, refreshSession } from "@/lib/auth/session";
import { WorkspaceSignupForm } from "@/components/auth/workspace-signup-form";

export default async function SignupPage() {
  const session = await getSession();
  if (session && (await refreshSession(session))) redirect("/overview");

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <section className="w-full max-w-md rounded-lg border border-border bg-panel p-8 shadow-subtle">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Workspace</p>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Create your workspace</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Set up the workspace and first owner account for your team.
          </p>
        </div>
        <WorkspaceSignupForm />
      </section>
    </main>
  );
}
