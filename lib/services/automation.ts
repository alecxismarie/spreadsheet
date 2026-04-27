import type { AppSession } from "@/lib/auth/session";

export type AutomationJob = "REPORT_DEADLINE_REMINDER" | "OVERDUE_REPORT_CHECK" | "WEEKLY_SUMMARY" | "MANAGER_ALERT";

export async function enqueueAutomationPlaceholder(session: AppSession, job: AutomationJob) {
  void session;
  void job;
  // Phase 1 extension point. Replace with a durable job queue when reminders,
  // deadlines, or summaries move into scope.
  return { queued: false, reason: "Automation jobs are not enabled in phase 1." };
}
