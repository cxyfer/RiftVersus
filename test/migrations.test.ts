import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function migrationSource(name: string): Promise<string> {
  return readFile(new URL(`../packages/database/src/migrations/${name}`, import.meta.url), "utf8");
}

describe("migration safety contracts", () => {
  it("guards fact-retirement downgrade before dropping either tombstone column", async () => {
    const source = await migrationSource("006_fact_retirement.ts");
    const guard = source.indexOf("Cannot losslessly downgrade fact retirement");
    expect(guard).toBeGreaterThan(-1);
    expect(source).toContain("from series_facts where retired_generation is not null");
    expect(source).toContain("from game_facts where retired_generation is not null");
    expect(guard).toBeLessThan(source.indexOf("alter table game_facts drop column"));
    expect(guard).toBeLessThan(source.indexOf("alter table series_facts drop column"));
  });

  it("protects immutable media object bytes from direct update and delete", async () => {
    const source = await migrationSource("007_shared_media_objects.ts");
    expect(source).toContain("before update or delete on media_objects");
    expect(source).toContain("execute function riftversus_reject_append_only_mutation()");
  });
});
