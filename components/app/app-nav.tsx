"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Settings, Table2, Users } from "lucide-react";

const nav = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/reports", label: "Reports", icon: Table2 },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings }
] satisfies Array<{ href: Route; label: string; icon: typeof LayoutDashboard }>;

export function AppNav({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const pathname = usePathname();
  const isMobile = variant === "mobile";

  return (
    <nav
      className={
        isMobile
          ? "flex gap-1 overflow-x-auto border-t border-border pt-3 lg:hidden"
          : "mt-8 space-y-1"
      }
      aria-label="Primary navigation"
      data-testid={isMobile ? "mobile-nav" : "sidebar-nav"}
    >
      {nav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              isMobile
                ? `inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                    active ? "bg-slate-100 text-ink" : "text-slate-700 hover:bg-slate-50"
                  }`
                : `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                    active ? "bg-slate-100 text-ink" : "text-slate-700 hover:bg-slate-50"
                  }`
            }
          >
            <Icon className={isMobile ? "h-4 w-4 shrink-0" : "h-4 w-4"} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
