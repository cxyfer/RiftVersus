import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { downloadReviewedMedia, MEDIA_ARCHIVE_MAX_BYTES, reviewedImageFilename } from "../src/media-archive.js";
import type { ReleaseStore } from "../src/release-store.js";

const bytes = Buffer.from("reviewed fixture");
const checksum = createHash("sha256").update(bytes).digest("hex");
const image = { sourceUrl: "https://static.wikia.nocookie.net/fixture.png", byteSize: bytes.length, contentType: "image/png" as const, rightsBasis: { fileChecksum: checksum } };
async function fixture(body = bytes, extra = false) {
  const zip = new JSZip(); zip.file(reviewedImageFilename(checksum, "image/png"), body);
  if (extra) zip.file("unexpected.txt", "extra");
  const bundle = await zip.generateAsync({ type: "nodebuffer" });
  const digest = createHash("sha256").update(bundle).digest("hex");
  const archive = { tag: `media-reviewed-${digest}`, checksum: digest, byteSize: bundle.length };
  const store: ReleaseStore = { getRelease: vi.fn(async () => ({ id: 1, tag_name: archive.tag, draft: false, immutable: true })),
    listAssets: vi.fn(async () => [{ id: 2, name: `media-${digest}.zip`, size: bundle.length }]),
    downloadAsset: vi.fn(async () => bundle), listReleases: vi.fn(), createDraft: vi.fn(), publishDraft: vi.fn(), uploadAsset: vi.fn() };
  return { archive, store };
}
describe("immutable reviewed media transport", () => {
  it("downloads the pinned GitHub archive and verifies each exact image without fetching the CDN", async () => {
    const { archive, store } = await fixture();
    const downloaded = await downloadReviewedMedia(archive, [image], store);
    expect(downloaded.get(image.sourceUrl)).toEqual({ bytes, contentType: "image/png", finalUrl: image.sourceUrl });
    expect(store.downloadAsset).toHaveBeenCalledWith(2, { checksum: archive.checksum, byteSize: archive.byteSize });
  });
  it("rejects a draft or mutable release before downloading its contents", async () => {
    for (const change of [{ draft: true }, { immutable: false }]) {
      const { archive, store } = await fixture();
      vi.mocked(store.getRelease).mockResolvedValue({ id: 1, tag_name: archive.tag, draft: false, immutable: true, ...change });
      await expect(downloadReviewedMedia(archive, [image], store)).rejects.toThrow(/published and immutable/);
      expect(store.downloadAsset).not.toHaveBeenCalled();
    }
  });
  it("rejects a changed image, oversized inflated image and unexpected archive entries", async () => {
    for (const [body, extra] of [[Buffer.from("changed fixture"), false], [Buffer.alloc(bytes.length + 1), false], [bytes, true]] as const) {
      const { archive, store } = await fixture(body, extra);
      await expect(downloadReviewedMedia(archive, [image], store)).rejects.toThrow();
    }
  });
  it("rejects a mismatched release identity, changed asset size or excessive capacity", async () => {
    const { archive, store } = await fixture();
    await expect(downloadReviewedMedia({ ...archive, tag: `media-reviewed-${"f".repeat(64)}` }, [image], store)).rejects.toThrow(/tag/);
    await expect(downloadReviewedMedia(archive, [{ ...image, byteSize: MEDIA_ARCHIVE_MAX_BYTES + 1 }], store)).rejects.toThrow(/capacity/);
    vi.mocked(store.listAssets).mockResolvedValue([{ id: 2, name: `media-${archive.checksum}.zip`, size: archive.byteSize + 1 }]);
    await expect(downloadReviewedMedia(archive, [image], store)).rejects.toThrow(/asset/);
  });
});
