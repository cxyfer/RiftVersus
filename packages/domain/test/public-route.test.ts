import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createSqliteSchema } from "../src/sqlite-schema.js";
import { resolvePublicSubject } from "../src/public-route.js";
import type { SqliteExecutor } from "../src/sqlite-query.js";

describe("exact public subject resolution", () => {
  it("resolves public/legacy IDs and scoped eras without fuzzy matching", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      createSqliteSchema(db);
      const team = "11111111-1111-4111-8111-111111111111";
      const player = "22222222-2222-4222-8222-222222222222";
      const era = "33333333-3333-4333-8333-333333333333";
      const insert = db.prepare("INSERT INTO entity_variants (variant_id,entity_id,kind,team_era_id,display_name,canonical_name,slug,avatar_label,media_url) VALUES (?,?,?,?,?,?,?,?,?)");
      insert.run(team, team, "team", null, "T1", "T1", "t1", "T1", "/t1.png");
      insert.run(player, player, "player", null, "T1", "Person", "person", "T1", "/person.png");
      insert.run(era, team, "team", era, "SK Telecom T1", "T1", "t1", "SKT", "/skt.png");
      db.prepare("INSERT INTO public_ids VALUES (?,?,?)").run("team", "t1", team);
      db.prepare("INSERT INTO public_ids VALUES (?,?,?)").run("player", "t1", player);
      db.prepare("INSERT INTO public_era_ids VALUES (?,?,?)").run(team, "sk-telecom-t1", era);
      const executor: SqliteExecutor = { async all<T extends Record<string, unknown>>(sql: string, params: readonly (string | number | null)[]) { return db.prepare(sql).all(...params) as T[]; } };
      await expect(resolvePublicSubject(executor, { kind: "team", id: "Ｔ１" })).resolves.toMatchObject({ id: team, publicId: "t1" });
      await expect(resolvePublicSubject(executor, { kind: "player", id: "t1" })).resolves.toMatchObject({ id: player });
      await expect(resolvePublicSubject(executor, { kind: "team", id: team, teamEraId: era })).resolves.toMatchObject({ id: team, publicId: "t1", teamEraId: era, publicEraId: "sk-telecom-t1" });
      await expect(resolvePublicSubject(executor, { kind: "team", id: "t1", teamEraId: "sk-telecom-t1" })).resolves.toMatchObject({ displayName: "SK Telecom T1", mediaUrl: "/skt.png" });
      for (const id of ["t", "t1%", "T1' OR 1=1 --", "benny"]) {
        await expect(resolvePublicSubject(executor, { kind: "team", id })).rejects.toThrow("找不到指定");
      }
      await expect(resolvePublicSubject(executor, { kind: "player", id: team })).rejects.toThrow("找不到指定");
      await expect(resolvePublicSubject(executor, { kind: "team", id: "t1", teamEraId: player })).rejects.toThrow("找不到指定");
    } finally { db.close(); }
  });
});
