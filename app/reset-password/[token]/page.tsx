import Link from "next/link";
import type { Route } from "next";
import { PasswordResetForm } from "@/components/auth/password-reset-form";
import { getPasswordResetDetails } from "@/lib/auth/password-reset";

export default async function ResetPasswordPage({
  params
}: {
  params: Promise<{ token?: string }>;
}) {
  const { token } = await params;
  const reset = await getPasswordResetDetails(token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <section className="w-full max-w-md rounded-lg border border-border bg-panel p-8 shadow-subtle">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Account recovery</p>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Choose a new password</h1>
        </div>

        {reset.state === "valid" ? (
          <PasswordResetForm token={token ?? ""} />
        ) : (
          <ResetUnavailable message={reset.message} />
        )}
      </section>
    </main>
  );
}

function ResetUnavailable({ message }: { message: string }) {
  return (
    <div className="space-y-5">
      <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-800" data-testid="reset-state-message">
        {message}
      </div>
      <Link href={"/forgot-password" as Route} className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
        Request a new link
      </Link>
    </div>
  );
}
