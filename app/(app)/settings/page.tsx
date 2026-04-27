import { canManageWorkspace } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

export default async function SettingsPage() {
  const { workspace, membership } = await getCurrentUser();
  const canManage = canManageWorkspace(membership.role);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted">Settings</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Workspace foundation</h1>
      </div>

      <section className="rounded-lg border border-border bg-white p-5 shadow-subtle">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Workspace</dt>
            <dd className="mt-1 font-medium text-ink">{workspace.name}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Your role</dt>
            <dd className="mt-1 font-medium text-ink">{membership.role}</dd>
          </div>
        </dl>
        <div className="mt-6 rounded-md bg-slate-50 p-4 text-sm text-muted">
          {canManage
            ? "Phase 1 includes the settings surface and permission boundary. Workspace management, invites, exports, and automation controls are prepared for later implementation."
            : "Workspace settings are visible for context. Management controls are owner-only."}
        </div>
      </section>
    </div>
  );
}
