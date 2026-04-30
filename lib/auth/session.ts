import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "sales_ops_session";

export type AppSession = {
  userId: string;
  workspaceId: string;
  role: Role;
  sessionVersion: number;
  expiresAt: number;
};

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production.");
  }
  return secret ?? "development-only-session-secret-change-me";
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function encodeSession(session: AppSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(value?: string): AppSession | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AppSession;
    if (session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, workspaceId: string, role: Role, sessionVersion: number) {
  const session: AppSession = {
    userId,
    workspaceId,
    role,
    sessionVersion,
    expiresAt: Date.now() + 1000 * 60 * 60 * 12
  };

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession() {
  const cookieStore = await cookies();
  return decodeSession(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/signin");
  return session;
}

export async function refreshSession(session: AppSession): Promise<AppSession | null> {
  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.userId,
      workspaceId: session.workspaceId,
      active: true
    },
    select: {
      role: true,
      user: { select: { sessionVersion: true } }
    }
  });

  if (!membership) return null;
  if (session.sessionVersion !== membership.user.sessionVersion) return null;
  return { ...session, role: membership.role };
}

export async function requireCurrentSession() {
  const session = await requireSession();
  const currentSession = await refreshSession(session);
  if (!currentSession) {
    redirect("/signin");
  }
  return currentSession;
}

export async function getCurrentUser() {
  const session = await requireCurrentSession();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    include: {
      memberships: {
        where: { workspaceId: session.workspaceId, active: true },
        include: { workspace: true }
      }
    }
  });

  const membership = user.memberships[0];
  if (!membership) {
    redirect("/signin");
  }

  return { user, membership, workspace: membership.workspace };
}
