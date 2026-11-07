/**
 * Jarvis has one account, so a file is either private (only the owner) or
 * public (anyone with its `/d/<shareId>` link). Older multi-user versions
 * also stored `"shared"` (every signed-in account) and `"account"`; both
 * read as private now, so no stored row becomes more visible than before.
 */
export type ResourceVisibility = "private" | "public";

export function parseVisibility(value: unknown): ResourceVisibility | undefined {
  if (value === "private" || value === "public") return value;
  if (value === "shared" || value === "account") return "private";
  return undefined;
}

export function isResourceVisibility(value: unknown): value is ResourceVisibility {
  return parseVisibility(value) !== undefined;
}

export function normalizeVisibility(
  value: unknown,
  fallback: ResourceVisibility = "private",
): ResourceVisibility {
  return parseVisibility(value) ?? fallback;
}

/** A file is public when it is marked public or carries the legacy `is_public` flag. */
export function normalizeLibraryVisibility(
  visibility: unknown,
  isPublic?: boolean,
): ResourceVisibility {
  return isPublic || visibility === "public" ? "public" : "private";
}

export function resolveFileVisibility(input: {
  readonly visibility?: unknown;
  readonly isPublic?: boolean;
  readonly currentVisibility?: ResourceVisibility;
}): ResourceVisibility {
  if (input.isPublic === true) return "public";
  if (input.isPublic === false) return "private";
  const parsed = input.visibility === undefined ? undefined : parseVisibility(input.visibility);
  return parsed ?? input.currentVisibility ?? "private";
}

export function isPublicVisibility(visibility: ResourceVisibility): boolean {
  return visibility === "public";
}

export function isOwnedBy(resource: { readonly userId: string }, viewerId: string): boolean {
  return resource.userId === viewerId;
}
