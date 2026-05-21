import { z } from "zod";

export const WORKSPACE_NAME_MAX_LENGTH = 120;
export const WORKSPACE_SLUG_MAX_LENGTH = 80;
export const OWNER_NAME_MAX_LENGTH = 120;

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, "Workspace name must be at least 2 characters.")
  .max(WORKSPACE_NAME_MAX_LENGTH, `Workspace name must be ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer.`);

export const ownerNameSchema = z
  .string()
  .trim()
  .min(1, "Owner name is required.")
  .max(OWNER_NAME_MAX_LENGTH, `Owner name must be ${OWNER_NAME_MAX_LENGTH} characters or fewer.`);

export function slugifyWorkspaceName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSPACE_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");

  return slug || "workspace";
}

export function workspaceSlugForAttempt(baseSlug: string, attempt: number) {
  if (attempt === 0) return baseSlug.slice(0, WORKSPACE_SLUG_MAX_LENGTH);

  const suffix = `-${attempt + 1}`;
  return `${baseSlug.slice(0, WORKSPACE_SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
