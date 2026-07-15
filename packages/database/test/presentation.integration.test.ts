import { describe, expect, it } from "vitest";

import { presentationImageUrl } from "../src/repositories/presentation.js";

describe("presentationImageUrl", () => {
  it.each([
    ["player", "/avatars/player/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.svg"],
    ["team", "/avatars/team/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.svg"],
    ["region", "/avatars/region/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.svg"],
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
