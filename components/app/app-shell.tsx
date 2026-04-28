import Link from "next/link";
import type { Route } from "next";
import { LayoutDashboard, Settings, Table2, Users } from "lucide-react";
import { signOutAction } from "@/lib/auth/actions";
import type { getCurrentUser } from "@/lib/auth/session";

type Context = Awaited<ReturnType<typeof getCurrentUser>>;

const nav = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/reports", label: "Reports", icon: Table2 },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings }
] satisfies Array<{ href: Route; label: string; icon: typeof LayoutDashboard }>;

export function AppShell({ context, children }: { context: Context; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-white px-4 py-5 lg:block">
        <div className="px-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Workspace</p>
          <h1 className="mt-2 truncate text-lg font-semibold text-ink">{context.workspace.name}</h1>
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-white/95 px-5 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
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
        </header>
        <main className="px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
