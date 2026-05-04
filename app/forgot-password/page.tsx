import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <section className="w-full max-w-md rounded-lg border border-border bg-panel p-8 shadow-subtle">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Account recovery</p>
          <h1 className="mt-3 text-2xl font-semibold text-ink">Reset your password</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Enter the email for your workspace account.
          </p>
        </div>
        <ForgotPasswordForm />
        <Link href="/signin" className="mt-6 inline-flex text-sm font-semibold text-accent hover:underline">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
