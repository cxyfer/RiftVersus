import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { validMediaRights, type MediaRightsBasis } from "@riftversus/contracts";
import { retainMedia } from "../src/publication.js";
import type { ObjectStore } from "../src/storage.js";

const bytes = new Uint8Array([1, 2, 3]);
const rightsBasis: MediaRightsBasis = { kind: "editorial-use", policy: "leaguepedia-editorial-v1", sourcePageUrl: "https://lol.fandom.com/wiki/File:Faker.png", revisionId: 123,
  fileChecksum: createHash("sha256").update(bytes).digest("hex"), statement: "File page carries a fair-use statement, not a redistribution license.", reviewedNote: "Exact player binding reviewed." };

describe("reviewed editorial media", () => {
  it("accepts a complete editorial basis without fabricating a license", async () => {
    expect(validMediaRights({ license: null, attribution: "Source: Leaguepedia", rightsBasis })).toBe(true);
    const putImmutable = vi.fn().mockResolvedValue("inserted");
    const store: ObjectStore = { putImmutable, get: async () => null, head: async () => null };
    const retained = await retainMedia(store, "leaguepedia", { sourceUrl: "https://static.wikia.nocookie.net/faker.png", attribution: "Source: Leaguepedia", license: null, rightsBasis, bytes, contentType: "image/png" });
    expect(retained).toMatchObject({ license: null, rightsBasis });
    expect(putImmutable).toHaveBeenCalledOnce();
  });
  it("rejects changed bytes before writing an immutable object", async () => {
    const putImmutable = vi.fn();
    const store: ObjectStore = { putImmutable, get: async () => null, head: async () => null };
    await expect(retainMedia(store, "leaguepedia", { sourceUrl: "https://static.wikia.nocookie.net/faker.png", attribution: "Source: Leaguepedia", license: null, rightsBasis, bytes: new Uint8Array([9]), contentType: "image/png" })).rejects.toThrow(/checksum/);
    expect(putImmutable).not.toHaveBeenCalled();
  });
  it.each([
    { rightsBasis: { ...rightsBasis, revisionId: 0 } },
    { rightsBasis: { ...rightsBasis, sourcePageUrl: "https://example.com/wiki/File:Faker.png" } },
    { rightsBasis: { ...rightsBasis, reviewedNote: "" } },
    { license: "CC BY", rightsBasis },
    { attribution: "", rightsBasis },
    { license: null },
  ])("keeps incomplete or misleading evidence ineligible: %j", input => {
    expect(validMediaRights({ attribution: "Source: Leaguepedia", ...input })).toBe(false);
  });
  it("preserves existing licensed media eligibility", () => {
    expect(validMediaRights({ attribution: "Photographer", license: "CC BY 4.0" })).toBe(true);
  });
});
