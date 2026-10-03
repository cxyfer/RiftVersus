import { describe, expect, it } from "vitest";
import type { PublicSnapshot } from "@riftversus/contracts";
import { renderMediaCredits } from "../src/media-credits.js";

const projection: Omit<PublicSnapshot, "snapshotId"> = { schemaVersion: 1, dataset: { version: "test", coverage: { from: "2024-01-01", to: "2024-12-31" }, lastSuccessfulSyncAt: "2024-12-31T00:00:00Z" }, coverageWarnings: [], series: [], entities: [{
  id: "00000000-0000-4000-8000-000000000001", kind: "player", displayName: "Faker", canonicalName: "Lee Sang-hyeok", slug: "faker", aliases: [], avatarLabel: "Faker", retainedObjectKey: "media/example.png", mediaUrl: "/RiftVersus/presentation/example.png",
}], attribution: [{ objectKey: "media/example.png", sourceUrl: "https://static.wikia.nocookie.net/example.png", license: null, attribution: '<script>alert("credit")</script>', rightsBasis: { kind: "editorial-use", policy: "leaguepedia-editorial-v1", sourcePageUrl: "https://lol.fandom.com/wiki/File:Faker.png", revisionId: 123, fileChecksum: "a".repeat(64), statement: "Fair-use statement, not a redistribution license.", reviewedNote: "Profile binding reviewed." } }] };

describe("public media credits", () => {
  it("shows the local image, source revision and honest rights statement while escaping source text", () => {
    const html = renderMediaCredits(projection, "/RiftVersus/");
    expect(html).toContain('src="/RiftVersus/presentation/example.png"');
    expect(html).toContain('href="https://lol.fandom.com/wiki/File:Faker.png"');
    expect(html).toContain("來源版本 123");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("未宣稱取得再散布授權");
  });
  it("does not render unsafe licensed-media source links", () => {
    expect(() => renderMediaCredits({ ...projection, attribution: [{ ...projection.attribution![0]!, rightsBasis: undefined, license: "CC BY", sourceUrl: "javascript:alert(1)" }] }, "/")).toThrow(/HTTPS/);
  });
  it("keeps identical image bytes credited to the exact reviewed owner", () => {
    const html = renderMediaCredits({ ...projection, entities: [...projection.entities, { ...projection.entities[0]!, id: "00000000-0000-4000-8000-000000000002", displayName: "Other owner" }],
      attribution: [{ ...projection.attribution![0]!, entityId: projection.entities[0]!.id }] }, "/");
    expect(html).toContain("<h2>Faker</h2>");
    expect(html).not.toContain("Other owner");
  });
});
