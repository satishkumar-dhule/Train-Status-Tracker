/** Strip HTML tags from a string. */
export function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/<[^>]+>/g, "").trim() || null;
}
