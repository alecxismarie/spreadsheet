import { AppShell } from "@/components/app/app-shell";
import { getCurrentUser } from "@/lib/auth/session";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const context = await getCurrentUser();
  return <AppShell context={context}>{children}</AppShell>;
}
