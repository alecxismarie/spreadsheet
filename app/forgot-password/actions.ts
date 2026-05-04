"use server";

import { headers } from "next/headers";
import { requestPasswordReset, type PasswordResetRequestState } from "@/lib/auth/password-reset";
import { resolveClientIp } from "@/lib/auth/rate-limit";

export async function requestPasswordResetAction(
  _state: PasswordResetRequestState,
  formData: FormData
): Promise<PasswordResetRequestState> {
  const headerStore = await headers();
  return requestPasswordReset(
    {
      email: formData.get("email")
    },
    {
      ip: resolveClientIp(headerStore),
      userAgent: headerStore.get("user-agent") ?? undefined
    }
  );
}
