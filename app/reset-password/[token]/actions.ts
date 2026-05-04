"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resetPasswordWithToken, type PasswordResetState } from "@/lib/auth/password-reset";
import { resolveClientIp } from "@/lib/auth/rate-limit";

export async function resetPasswordAction(
  _state: PasswordResetState,
  formData: FormData
): Promise<PasswordResetState> {
  const headerStore = await headers();
  const result = await resetPasswordWithToken(
    {
      token: formData.get("token"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword")
    },
    {
      ip: resolveClientIp(headerStore),
      userAgent: headerStore.get("user-agent") ?? undefined
    }
  );

  if (!result.ok) {
    return result;
  }

  redirect("/signin?reset=success");
}
