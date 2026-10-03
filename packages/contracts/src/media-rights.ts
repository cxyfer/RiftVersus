import { z } from "zod";

export const MediaRightsBasisSchema = z.object({
  kind: z.literal("editorial-use"),
  policy: z.literal("leaguepedia-editorial-v1"),
  sourcePageUrl: z.url().refine(value => {
    const url = new URL(value);
    return url.origin === "https://lol.fandom.com" && url.pathname.startsWith("/wiki/File:") && !url.username && !url.password && !url.search && !url.hash;
  }, "Expected an exact Leaguepedia file page."),
  revisionId: z.number().int().positive(),
  fileChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  statement: z.string().trim().min(1),
  reviewedNote: z.string().trim().min(1),
  sourceFileSha1: z.string().regex(/^[a-f0-9]{40}$/u).optional(),
  variant: z.enum(["original", "thumbnail", "cdn-render"]).optional(),
}).strict();

export type MediaRightsBasis = z.infer<typeof MediaRightsBasisSchema>;

export function validMediaRights(input: { license?: string | null; attribution?: string | null; rightsBasis?: unknown; checksum?: string }): boolean {
  if (!input.attribution?.trim()) return false;
  if (input.rightsBasis === undefined || input.rightsBasis === null) return Boolean(input.license?.trim());
  const parsed = MediaRightsBasisSchema.safeParse(input.rightsBasis);
  return parsed.success && !input.license?.trim() && (input.checksum === undefined || parsed.data.fileChecksum === input.checksum);
}
