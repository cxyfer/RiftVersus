import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginSyncRun, publishDataset, recordSourceObjectWithId } from "../src/index.js";
import { createDb, destroyDb } from "../src/db.js";
import { migrateToLatest } from "../src/migrator.js";
import { entityPresentation, getAvatarIdentity, presentationImageUrl } from "../src/repositories/presentation.js";
import { escapeLikePattern } from "../src/repositories/entities.js";
import { createTestSchemaName, seedComparisonFixture, seedIds } from "./fixtures/seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describe("escapeLikePattern", () => {
  it("treats PostgreSQL LIKE metacharacters as literal search input", () => {
    expect(escapeLikePattern("F_%\\")).toBe("F\\_\\%\\\\");
  });
});

describe("entityPresentation", () => {
  it("presents a distinct player ID and real name as typed fields", () => {
    expect(entityPresentation({ kind: "player", canonicalName: "Lee Sang-hyeok", playerId: "Faker" })).toEqual({
      displayName: "Faker",
      realName: "Lee Sang-hyeok",
    });
  });

  it.each([
    ["player", "Xiaohu", null, { displayName: "Xiaohu" }],
    ["player", "Caps", "Caps", { displayName: "Caps" }],
    ["team", "T1", null, { displayName: "T1" }],
    ["region", "LCK", null, { displayName: "LCK" }],
  ] as const)("keeps legacy and unchanged %s presentation compact", (kind, canonicalName, playerId, expected) => {
    expect(entityPresentation({ kind, canonicalName, playerId })).toEqual(expected);
  });
});

describe("presentationImageUrl", () => {
  it.each([
    ["player", "/avatars/v2/player/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.svg"],
    ["team", "/avatars/v2/team/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.svg"],
    ["region", "/avatars/v2/region/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.svg"],
  ] as const)("generates a canonical %s avatar URL", (kind, expected) => {
    expect(presentationImageUrl({
      kind,
      entityId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      retainedObjectKey: null,
    })).toBe(expected);
  });

  it("prefers a retained media object key", () => {
    expect(presentationImageUrl({
      kind: "team",
      entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      retainedObjectKey: "media/team.png",
    })).toBe("/media/media/team.png");
  });

  it("rejects an invalid UUID when generating an avatar URL", () => {
    expect(() => presentationImageUrl({
      kind: "team",
      entityId: "not-a-uuid",
      retainedObjectKey: null,
    })).toThrow();
  });
});

describeWithDatabase("getAvatarIdentity", () => {
  const schema = createTestSchemaName();
  const adminPool = new Pool({ connectionString: databaseUrl });
  const db = createDb({ databaseUrl: databaseUrl!, schema });
  let stagedIdentity: Awaited<ReturnType<typeof getAvatarIdentity>>;

  beforeAll(async () => {
    await adminPool.query(`create schema ${schema}`);
    await migrateToLatest(db, { schema });
    await seedComparisonFixture(db);
    stagedIdentity = await getAvatarIdentity("team", seedIds.t1, db);
    const run = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({ syncRunId: run.id, version: "avatar-identity-visible", coverage: [] }, db);
  });

  afterAll(async () => {
    await destroyDb(db);
    await adminPool.query(`drop schema if exists ${schema} cascade`);
    await adminPool.end();
  });

  it("follows publication visibility while using shared canonical labels", async () => {
    expect(stagedIdentity).toBeNull();
    await expect(getAvatarIdentity("player", seedIds.faker, db)).resolves.toEqual({
      kind: "player", id: seedIds.faker, label: "Faker",
    });
    await expect(getAvatarIdentity("player", seedIds.xiaohu, db)).resolves.toEqual({
      kind: "player", id: seedIds.xiaohu, label: "Xiaohu",
    });
    await expect(getAvatarIdentity("team", seedIds.t1, db)).resolves.toEqual({
      kind: "team", id: seedIds.t1, label: "T1",
    });
    await expect(getAvatarIdentity("region", seedIds.lck, db)).resolves.toEqual({
      kind: "region", id: seedIds.lck, label: "LCK",
    });
    await expect(getAvatarIdentity("team", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", db)).resolves.toBeNull();
    await expect(getAvatarIdentity("region", seedIds.t1, db)).resolves.toBeNull();

    await expect(getAvatarIdentity("team", seedIds.genG, db)).resolves.toEqual({
      kind: "team", id: seedIds.genG, label: "Gen.G",
    });
    const source = await recordSourceObjectWithId({
      provider: "fixture", sourceKey: "avatar-retirement", sourceUrl: "https://example.test/avatar-retirement",
      objectKey: "sources/avatar-retirement", checksum: "avatar-retirement", parserVersion: "test",
    }, db);
    const retirement = await beginSyncRun({ provider: "fixture", mode: "sync", parserVersion: "test" }, db);
    await publishDataset({
      syncRunId: retirement.id,
      version: "avatar-identity-retired",
      sourceObjectId: source.id,
      coverage: [],
      publicationScopes: [{
        provider: "fixture", tournamentSourceKey: "lck", from: "2024-01-01", to: "2025-01-01",
        status: "complete", unresolvedRows: 0,
      }],
    }, db);
    await expect(getAvatarIdentity("team", seedIds.genG, db)).resolves.toBeNull();
  });
});
