export const MAX_NAME_LENGTH = 16;

export function sanitizeName(name: unknown): string {
  const cleaned = String(name ?? "")
    .replace(/[^\p{L}\p{N} _.\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || "Player";
}
