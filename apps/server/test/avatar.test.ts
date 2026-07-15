import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const firstChecksum = "70ffa6f6966cd93dff0bce6a16a1faf31fb2cd16cdb3eebffa29701bee312e1a";
const collidingIdA = "00000000-0000-4000-8000-00000000006e";
const collidingIdB = "00000000-0000-4000-8000-000000000099";
const lowercaseId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const uppercaseId = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";

function avatarModule() {
  return import("../src/avatar.js");
}

function createApp() {
  return buildApp({
    searchEntities: async () => ({ entities: [] }),
    listFilters: async () => ({ eventCategories: [], tournaments: [], bestOf: [] }),
    compare: async () => null,
    getDataset: async () => null,
    getMedia: async () => null,
  });
}

describe("canonical avatar generator", () => {
  it("returns byte-identical output with a stable checksum fixture", async () => {
    const { generateCanonicalAvatar } = await avatarModule();

    const first = generateCanonicalAvatar("team", firstId);
    const second = generateCanonicalAvatar("team", firstId);

    expect(first).toEqual(second);
    expect(first.algorithm).toBe("canonical-avatar-v1");
    expect(first.contentType).toBe("image/svg+xml");
    expect(first.checksum).toBe(firstChecksum);
    expect(first.checksum).toBe(createHash("sha256").update(first.body).digest("hex"));
    expect(first.body.equals(second.body)).toBe(true);
    expect(first.body.toString("utf8")).not.toContain("\n");
  });

  it("separates different entity kinds and UUIDs", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const subject = generateCanonicalAvatar("team", firstId).body;

    expect(generateCanonicalAvatar("player", firstId).body.equals(subject)).toBe(false);
    expect(generateCanonicalAvatar("team", secondId).body.equals(subject)).toBe(false);
  });

  it("keeps every UUID byte significant for canonical output", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const first = generateCanonicalAvatar("team", collidingIdA);
    const second = generateCanonicalAvatar("team", collidingIdB);

    expect(first.body.equals(second.body)).toBe(false);
    expect(first.checksum).not.toBe(second.checksum);
  });

  it("canonicalizes uppercase and lowercase UUID representations to the same bytes", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const lowercase = generateCanonicalAvatar("team", lowercaseId);
    const uppercase = generateCanonicalAvatar("team", uppercaseId);

    expect(uppercase.body.equals(lowercase.body)).toBe(true);
    expect(uppercase.checksum).toBe(lowercase.checksum);
  });

  it("emits only audited passive SVG primitives", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const svg = generateCanonicalAvatar("region", firstId).body.toString("utf8");

    expect(svg).toMatch(/^<svg [^>]+><rect [^>]+\/>(?:<circle [^>]+\/>)+<polygon [^>]+\/><\/svg>$/);
    expect(svg).not.toMatch(/<(?:text|style|script|animate|set|image|use|a|foreignObject)\b/i);
    expect(svg).not.toMatch(/(?:href|on\w+|url\s*\(|data:|javascript:)/i);
  });

  it("rejects malformed UUIDs before producing bytes", async () => {
    const { generateCanonicalAvatar } = await avatarModule();

    expect(() => generateCanonicalAvatar("team", "not-a-uuid")).toThrow();
  });
});

describe("canonical avatar route", () => {
  it("serves canonical bytes with immutable security headers and checksum ETag", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const expected = generateCanonicalAvatar("team", firstId);
    const app = createApp();

    try {
      const response = await app.inject(`/avatars/team/${firstId}.svg`);

      expect(response.statusCode).toBe(200);
      expect(response.rawPayload.equals(expected.body)).toBe(true);
      expect(response.headers["content-type"]).toBe("image/svg+xml");
      expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(response.headers.etag).toBe(`"sha256-${expected.checksum}"`);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    } finally {
      await app.close();
    }
  });

  it("keeps the canonical body and ETag stable across query strings", async () => {
    const app = createApp();

    try {
      const canonical = await app.inject(`/avatars/team/${firstId}.svg`);
      const queried = await app.inject(`/avatars/team/${firstId}.svg?preview=1`);

      expect(queried.statusCode).toBe(200);
      expect(queried.rawPayload.equals(canonical.rawPayload)).toBe(true);
      expect(queried.headers.etag).toBe(canonical.headers.etag);
    } finally {
      await app.close();
    }
  });

  it("serves one canonical body and ETag for uppercase and lowercase UUID paths", async () => {
    const app = createApp();

    try {
      const lowercase = await app.inject(`/avatars/team/${lowercaseId}.svg`);
      const uppercase = await app.inject(`/avatars/team/${uppercaseId}.svg`);

      expect(lowercase.statusCode).toBe(200);
      expect(uppercase.statusCode).toBe(200);
      expect(uppercase.rawPayload.equals(lowercase.rawPayload)).toBe(true);
      expect(uppercase.headers.etag).toBe(lowercase.headers.etag);
    } finally {
      await app.close();
    }
  });

  it("returns structured 404 errors for invalid kinds, UUIDs, and encoded traversal", async () => {
    const app = createApp();

    try {
      for (const url of [
        `/avatars/league/${firstId}.svg`,
        "/avatars/team/not-a-uuid.svg",
        "/avatars/team/%2e%2e.svg",
        "/avatars/team/%252e%252e.svg",
      ]) {
        const response = await app.inject(url);
        expect(response.statusCode, url).toBe(404);
        expect(response.json(), url).toMatchObject({ error: { code: "NOT_FOUND" } });
      }
    } finally {
      await app.close();
    }
  });
});
