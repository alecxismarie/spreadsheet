import Image from "next/image";
import { signOutAction } from "@/lib/auth/actions";
import type { getCurrentUser } from "@/lib/auth/session";
import { AppNav } from "@/components/app/app-nav";

type Context = Awaited<ReturnType<typeof getCurrentUser>>;

export function AppShell({ context, children }: { context: Context; children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-white px-4 py-5 lg:block">
        <div className="px-2">
          <Image src="/workspacelogo.png" alt="Workspace" width={1200} height={900} className="h-7 w-auto object-contain" />
          <h1 className="mt-2 truncate text-lg font-semibold text-ink">{context.workspace.name}</h1>
        </div>
        <AppNav />
      </aside>
      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-white/95 px-5 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{context.user.name}</p>
              <p className="text-xs text-muted">{context.membership.role}</p>
            </div>
            <form action={signOutAction}>
              <button
                data-testid="sign-out"
                className="rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
          <AppNav variant="mobile" />
        </header>
        <main className="min-w-0 px-4 py-5 sm:px-5 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
