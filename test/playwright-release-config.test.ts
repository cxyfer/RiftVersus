import { describe, expect, it } from "vitest";

import { parseReleaseBaseUrl } from "../apps/web/playwright.release-url.js";

describe("release Playwright deployment URL", () => {
  it.each([
    ["http://127.0.0.1:3001", "http://127.0.0.1:3001/"],
    ["http://localhost:3000/", "http://localhost:3000/"],
    ["http://riftversus.example/", "http://riftversus.example/"],
    ["https://riftversus.example/", "https://riftversus.example/"],
  ])("accepts the root deployment URL %s", (input, expected) => {
    expect(parseReleaseBaseUrl(input)).toBe(expected);
  });

  it.each([
    undefined,
    "not-a-url?token=secret-value",
    "ftp://riftversus.example/",
    "https://riftversus.example/subpath",
    "https://riftversus.example/?token=secret-value",
    "https://riftversus.example/#secret-fragment",
    "https://secret-user:secret-pass@riftversus.example/",
  ])("rejects a non-root or unsafe deployment URL without echoing it: %s", (input) => {
    let thrown: unknown;
    try {
      parseReleaseBaseUrl(input);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("RIFTVERSUS_E2E_BASE_URL");
    expect(message).not.toContain("secret-value");
    expect(message).not.toContain("secret-fragment");
    expect(message).not.toContain("secret-user");
    expect(message).not.toContain("secret-pass");
  });
});
