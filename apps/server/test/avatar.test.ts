import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const firstChecksum = "d567ce50c30d85fbfef756d10bd35d4299228c3659a86073828dde626d5e2106";
const lowercaseId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const uppercaseId = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";

function avatarModule() {
  return import("../../data/src/avatar.js");
}

function createApp(overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const getAvatarIdentity = vi.fn(async (kind: "player" | "team" | "region", id: string) => ({
    kind,
    id: id.toLowerCase(),
    label: kind === "team" ? "T1" : kind === "player" ? "Faker" : "LCK",
  }));
  const app = buildApp({
    searchEntities: async () => ({ entities: [] }),
    listFilters: async () => ({ eventCategories: [], tournaments: [], bestOf: [] }),
    compare: async () => null,
    getDataset: async () => null,
    getMedia: async () => null,
    getAvatarIdentity,
    ...overrides,
  });
  return { app, getAvatarIdentity };
}

describe("canonical avatar generator", () => {
  it.each([
    ["team", "T1", "T1"],
    ["region", "LCK", "LCK"],
    ["team", "Bilibili Gaming", "BG"],
    ["player", "Faker", "FAK"],
    ["team", "G", "GG"],
    ["player", "李相赫", "PL"],
    ["team", "世界隊", "TM"],
    ["region", "韓國", "RG"],
  ] as const)("abbreviates %s label %s as %s", async (kind, label, expected) => {
    const { avatarAbbreviation } = await avatarModule();

    expect(avatarAbbreviation(kind, label)).toBe(expected);
  });

  it("returns byte-identical v2 output with a stable checksum fixture", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const identity = { kind: "team" as const, id: firstId, label: "T1" };

    const first = generateCanonicalAvatar(identity);
    const second = generateCanonicalAvatar(identity);

    expect(first).toEqual(second);
    expect(first.algorithm).toBe("canonical-avatar-v2");
    expect(first.contentType).toBe("image/svg+xml");
    expect(first.abbreviation).toBe("T1");
    expect(first.checksum).toBe(firstChecksum);
    expect(first.checksum).toBe(createHash("sha256").update(first.body).digest("hex"));
    expect(first.body.equals(second.body)).toBe(true);
    expect(first.body.toString("utf8")).not.toContain("\n");
  });

  it("seeds player and team geometry by kind and canonical UUID", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const team = generateCanonicalAvatar({ kind: "team", id: firstId, label: "T1" });
    const relabeledTeam = generateCanonicalAvatar({ kind: "team", id: firstId, label: "Telecom One" });
    const player = generateCanonicalAvatar({ kind: "player", id: firstId, label: "T1" });
    const otherTeam = generateCanonicalAvatar({ kind: "team", id: secondId, label: "T1" });
    const withoutText = (body: Buffer) => body.toString("utf8").replace(/<text\b[^>]*>[^<]*<\/text>/, "");

    expect(withoutText(relabeledTeam.body)).toBe(withoutText(team.body));
    expect(player.body.equals(team.body)).toBe(false);
    expect(otherTeam.body.equals(team.body)).toBe(false);
  });

  it.each([
    ["LCK", ["#102A43", "#38BDF8", "#BAE6FD"], /<circle [^>]+fill="#38BDF8"\/><circle [^>]+fill="#BAE6FD"\/>/],
    ["LPL", ["#7F1D1D", "#FBBF24", "#FEF3C7"], /<polygon [^>]+fill="#FBBF24"\/><polygon [^>]+fill="#FEF3C7"\/>/],
    ["LEC", ["#14532D", "#34D399", "#D1FAE5"], /<rect [^>]+fill="#34D399"\/><rect [^>]+fill="#D1FAE5"\/>/],
    ["LCS", ["#312E81", "#FB7185", "#FFE4E6"], /<circle [^>]+fill="#FB7185"\/><polygon [^>]+fill="#FFE4E6"\/>/],
  ] as const)("uses the exact reviewed %s palette and pattern", async (label, palette, pattern) => {
    const { generateCanonicalAvatar } = await avatarModule();
    const svg = generateCanonicalAvatar({ kind: "region", id: firstId, label }).body.toString("utf8");

    for (const color of palette) expect(svg).toContain(color);
    expect(svg).toMatch(pattern);
  });

  it("emits one safe text abbreviation without interpolating the raw label", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const label = `Alpha <script>alert(1)</script> & "Beta"`;
    const avatar = generateCanonicalAvatar({ kind: "team", id: firstId, label });
    const svg = avatar.body.toString("utf8");

    expect(svg.match(/<text\b/g)).toHaveLength(1);
    expect(svg).toContain(">ASA</text>");
    expect(svg).not.toContain(label);
    expect(svg).not.toMatch(/<(?:style|script|animate|set|image|use|a|foreignObject)\b/i);
    expect(svg).not.toMatch(/(?:\s(?:href|on\w+)=|url\s*\(|data:|javascript:)/i);
    expect(avatar.abbreviation).toMatch(/^[A-Z0-9]{2,3}$/);
  });

  it("keeps text legible when reviewed light pattern geometry crosses the label", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const svg = generateCanonicalAvatar({ kind: "region", id: secondId, label: "LCK" }).body.toString("utf8");
    const circles = [...svg.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)" fill="(#[A-F0-9]+)"\/>/g)];
    const overlappingCircle = circles.find((match) => {
      const [, cx, cy, radius] = match;
      return (64 - Number(cx)) ** 2 + (66 - Number(cy)) ** 2 <= Number(radius) ** 2;
    });

    expect(overlappingCircle?.[4]).toBe("#38BDF8");
    expect(svg).toContain('stroke="#0B1220"');
    expect(svg).toContain('stroke-width="6"');
    expect(svg).toContain('paint-order="stroke fill"');
  });

  it("canonicalizes uppercase and lowercase UUID representations", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const lowercase = generateCanonicalAvatar({ kind: "player", id: lowercaseId, label: "Faker" });
    const uppercase = generateCanonicalAvatar({ kind: "player", id: uppercaseId, label: "Faker" });

    expect(uppercase.body.equals(lowercase.body)).toBe(true);
    expect(uppercase.checksum).toBe(lowercase.checksum);
  });

  it("rejects malformed UUIDs before producing bytes", async () => {
    const { generateCanonicalAvatar } = await avatarModule();

    expect(() => generateCanonicalAvatar({ kind: "team", id: "not-a-uuid", label: "T1" })).toThrow();
  });
});

describe("canonical avatar route", () => {
  it("resolves identity and serves revalidated canonical bytes with security headers", async () => {
    const { generateCanonicalAvatar } = await avatarModule();
    const expected = generateCanonicalAvatar({ kind: "team", id: firstId, label: "T1" });
    const { app, getAvatarIdentity } = createApp();

    try {
      const response = await app.inject(`/avatars/v2/team/${firstId}.svg`);

      expect(response.statusCode).toBe(200);
      expect(getAvatarIdentity).toHaveBeenCalledWith("team", firstId);
      expect(response.rawPayload.equals(expected.body)).toBe(true);
      expect(response.headers["content-type"]).toBe("image/svg+xml");
      expect(response.headers["cache-control"]).toBe("public, no-cache");
      expect(response.headers.etag).toBe(`"sha256-${expected.checksum}"`);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    } finally {
      await app.close();
    }
  });

  it("uses weak If-None-Match comparison for exact, list, weak, and wildcard validators", async () => {
    const { app } = createApp();

    try {
      const initial = await app.inject(`/avatars/v2/team/${firstId}.svg`);
      const etag = initial.headers.etag!;
      for (const value of [etag, `"other", ${etag}`, `W/${etag}`, "*"]) {
        const response = await app.inject({
          url: `/avatars/v2/team/${firstId}.svg`,
          headers: { "if-none-match": value },
        });
        expect(response.statusCode, value).toBe(304);
        expect(response.body, value).toBe("");
        expect(response.headers["cache-control"], value).toBe("public, no-cache");
        expect(response.headers.etag, value).toBe(etag);
        expect(response.headers["x-content-type-options"], value).toBe("nosniff");
        expect(response.headers["content-security-policy"], value).toBe("default-src 'none'; sandbox");
      }
    } finally {
      await app.close();
    }
  });

  it("revalidates the same player URL when a typed ID replaces the legacy label", async () => {
    const legacyIdentity = { kind: "player" as const, id: firstId, label: "Lee Sang-hyeok" };
    const typedIdentity = { kind: "player" as const, id: firstId, label: "Faker" };
    const getAvatarIdentity = vi.fn()
      .mockResolvedValueOnce(legacyIdentity)
      .mockResolvedValue(typedIdentity);
    const { app } = createApp({ getAvatarIdentity });
    const url = `/avatars/v2/player/${firstId}.svg`;

    try {
      const legacy = await app.inject(url);
      const updated = await app.inject({ url, headers: { "if-none-match": legacy.headers.etag! } });
      const revalidated = await app.inject({ url, headers: { "if-none-match": updated.headers.etag! } });

      expect(legacy.statusCode).toBe(200);
      expect(updated.statusCode).toBe(200);
      expect(updated.headers.etag).not.toBe(legacy.headers.etag);
      expect(updated.rawPayload.equals(legacy.rawPayload)).toBe(false);
      expect(revalidated.statusCode).toBe(304);
      expect(revalidated.body).toBe("");
      expect(revalidated.headers.etag).toBe(updated.headers.etag);
    } finally {
      await app.close();
    }
  });

  it("keeps the canonical body, lookup, and ETag stable across query strings", async () => {
    const { app, getAvatarIdentity } = createApp();

    try {
      const canonical = await app.inject(`/avatars/v2/team/${firstId}.svg`);
      const queried = await app.inject(`/avatars/v2/team/${firstId}.svg?preview=1`);

      expect(queried.statusCode).toBe(200);
      expect(queried.rawPayload.equals(canonical.rawPayload)).toBe(true);
      expect(queried.headers.etag).toBe(canonical.headers.etag);
      expect(getAvatarIdentity).toHaveBeenNthCalledWith(1, "team", firstId);
      expect(getAvatarIdentity).toHaveBeenNthCalledWith(2, "team", firstId);
    } finally {
      await app.close();
    }
  });

  it("returns structured 404 for missing identities without generating bytes", async () => {
    const getAvatarIdentity = vi.fn(async () => null);
    const { app } = createApp({ getAvatarIdentity });

    try {
      const response = await app.inject(`/avatars/v2/team/${firstId}.svg`);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
      expect(getAvatarIdentity).toHaveBeenCalledWith("team", firstId);
    } finally {
      await app.close();
    }
  });

  it.each([
    ["wrong kind", { kind: "region" as const, id: firstId, label: "LCK" }],
    ["wrong valid ID", { kind: "team" as const, id: secondId, label: "T1" }],
    ["malformed returned ID", { kind: "team" as const, id: "not-a-uuid", label: "T1" }],
  ])("returns structured 404 for a dependency identity with %s", async (_case, identity) => {
    const getAvatarIdentity = vi.fn(async () => identity);
    const { app } = createApp({ getAvatarIdentity });

    try {
      const response = await app.inject(`/avatars/v2/team/${firstId}.svg`);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    } finally {
      await app.close();
    }
  });

  it("returns structured 404 for invalid kinds, UUIDs, traversal, and the retired route", async () => {
    const { app, getAvatarIdentity } = createApp();

    try {
      for (const url of [
        `/avatars/v2/league/${firstId}.svg`,
        "/avatars/v2/team/not-a-uuid.svg",
        "/avatars/v2/team/%2e%2e.svg",
        "/avatars/v2/team/%252e%252e.svg",
        `/avatars/team/${firstId}.svg`,
      ]) {
        const response = await app.inject(url);
        expect(response.statusCode, url).toBe(404);
        expect(response.json(), url).toMatchObject({ error: { code: "NOT_FOUND" } });
      }
      expect(getAvatarIdentity).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
