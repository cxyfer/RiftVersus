import { describe, expect, it, vi } from "vitest";

import { downloadBounded } from "../src/index.js";

const base = {
  url: "https://wiki.example.test/file.json",
  allowedHosts: ["wiki.example.test"],
  allowedContentTypes: ["application/json"],
  maxBytes: 8,
  timeoutMs: 20,
};

describe("bounded downloader", () => {
  it("downloads an allow-listed HTTPS response", async () => {
    const fetch = vi.fn(async () => new Response("fixture", { headers: { "content-type": "application/json" } }));
    await expect(downloadBounded(base, { fetch })).resolves.toMatchObject({ contentType: "application/json", finalUrl: base.url });
  });

  it("rejects non-HTTPS and unlisted hosts before fetching", async () => {
    const fetch = vi.fn();
    await expect(downloadBounded({ ...base, url: "http://wiki.example.test/file.json" }, { fetch })).rejects.toThrow("HTTPS");
    await expect(downloadBounded({ ...base, url: "https://evil.example/file.json" }, { fetch })).rejects.toThrow("allow-listed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects excessive bytes and disallowed content types", async () => {
    await expect(downloadBounded(base, { fetch: async () => new Response("123456789", { headers: { "content-type": "application/json" } }) })).rejects.toThrow("maximum byte size");
    await expect(downloadBounded(base, { fetch: async () => new Response("<html>", { headers: { "content-type": "text/html" } }) })).rejects.toThrow("content type");
  });

  it("follows at most five redirects and validates every redirect host", async () => {
    const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
    await expect(downloadBounded(base, { fetch: async () => redirect("https://evil.example/file.json") })).rejects.toThrow("allow-listed");

    const fetch = vi.fn(async () => redirect(base.url));
    await expect(downloadBounded(base, { fetch })).rejects.toThrow("redirects");
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("times out and honors a caller abort signal", async () => {
    const never = (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    await expect(downloadBounded(base, { fetch: never })).rejects.toThrow(/timed out/i);

    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    await expect(downloadBounded({ ...base, signal: controller.signal }, { fetch: never })).rejects.toThrow("caller cancelled");
  });
});
