import JSZip from "jszip";
import { Readable } from "node:stream";
import { z } from "zod";
import { readAndHash } from "./acceptance-media.js";
import type { ReleaseStore } from "./release-store.js";
import type { DownloadResult } from "@riftversus/sync";

export const MEDIA_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
export const ReviewedMediaArchiveSchema = z.object({
  tag: z.string().regex(/^media-reviewed-[a-f0-9]{64}$/u),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  byteSize: z.number().int().positive().max(MEDIA_ARCHIVE_MAX_BYTES),
}).strict();
export const ReviewedImageTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export function reviewedImageFilename(checksum: string, contentType: string): string {
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[ReviewedImageTypeSchema.parse(contentType)];
  return `${checksum}.${extension}`;
}

interface ArchivedImage {
  sourceUrl: string;
  byteSize: number;
  contentType: z.infer<typeof ReviewedImageTypeSchema>;
  rightsBasis: { fileChecksum: string };
}

export async function downloadReviewedMedia(archive: z.infer<typeof ReviewedMediaArchiveSchema>, images: readonly ArchivedImage[], store: ReleaseStore): Promise<Map<string, DownloadResult>> {
  if (archive.tag !== `media-reviewed-${archive.checksum}`) throw new Error("Reviewed media archive tag does not match its pin.");
  if (images.reduce((total, image) => total + image.byteSize, 0) > MEDIA_ARCHIVE_MAX_BYTES) throw new Error("Reviewed images exceed the archive capacity.");
  const release = await store.getRelease(archive.tag);
  if (release === null || release.draft || release.immutable !== true) throw new Error("Reviewed media release must be published and immutable.");
  const name = `media-${archive.checksum}.zip`;
  const matches = (await store.listAssets(release.id)).filter(asset => asset.name === name);
  if (matches.length !== 1 || matches[0]!.size !== archive.byteSize) throw new Error("Reviewed media archive asset does not match its pin.");
  const bytes = await store.downloadAsset(matches[0]!.id, { checksum: archive.checksum, byteSize: archive.byteSize });
  const zip = await JSZip.loadAsync(bytes);
  const expected = new Set(images.map(image => reviewedImageFilename(image.rightsBasis.fileChecksum, image.contentType)));
  if (Object.keys(zip.files).length !== expected.size || Object.keys(zip.files).some(file => !expected.has(file) || zip.files[file]!.dir)) throw new Error("Reviewed media ZIP has unexpected entries.");
  const files = new Map<string, Uint8Array>();
  const output = new Map<string, DownloadResult>();
  for (const image of images) {
    const filename = reviewedImageFilename(image.rightsBasis.fileChecksum, image.contentType);
    let body = files.get(filename);
    if (body === undefined) {
      const result = await readAndHash(new Readable({ objectMode: false }).wrap(zip.file(filename)!.nodeStream()), image.byteSize);
      if (result.body.byteLength !== image.byteSize || result.checksum !== image.rightsBasis.fileChecksum) throw new Error(`Reviewed image checksum/size mismatch: ${filename}.`);
      body = result.body; files.set(filename, body);
    } else if (body.byteLength !== image.byteSize) throw new Error("Conflicting reviewed image byte size.");
    if (output.has(image.sourceUrl)) throw new Error("Conflicting reviewed source URLs.");
    output.set(image.sourceUrl, { bytes: body, contentType: image.contentType, finalUrl: image.sourceUrl });
  }
  return output;
}
