import Link from "next/link";
import { InviteAcceptanceForm } from "@/components/auth/invite-acceptance-form";
import { getInviteAcceptanceDetails } from "@/lib/services/team";

export default async function InvitePage({
  params
}: {
  params: Promise<{ token?: string }>;
}) {
  const { token } = await params;
  const invite = await getInviteAcceptanceDetails(token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <section className="w-full max-w-md rounded-lg border border-border bg-panel p-8 shadow-subtle">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Workspace invite</p>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Accept your invite</h1>
        </div>

        {invite.state === "valid" ? (
          <>
            <dl className="mb-6 space-y-3 rounded-md bg-slate-50 p-4 text-sm">
              <div>
                <dt className="text-muted">Workspace</dt>
                <dd className="mt-1 font-medium text-ink" data-testid="invite-workspace">
                  {invite.workspaceName}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Invited email</dt>
                <dd className="mt-1 font-medium text-ink" data-testid="invite-email">
                  {invite.email}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Role</dt>
                <dd className="mt-1 font-medium text-ink" data-testid="invite-role">
                  {invite.role}
                </dd>
              </div>
            </dl>
            <InviteAcceptanceForm token={token ?? ""} accountExists={invite.accountExists} />
          </>
        ) : (
          <InviteUnavailable message={invite.message} />
        )}
      </section>
    </main>
  );
}

function InviteUnavailable({ message }: { message: string }) {
  return (
    <div className="space-y-5">
      <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800" data-testid="invite-state-message">
        {message}
      </div>
      <Link href="/signin" className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
        Go to sign in
      </Link>
    </div>
  );
}
