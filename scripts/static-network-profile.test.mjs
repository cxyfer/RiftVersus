import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createControlledPreview } from "./static-network-profile.mjs";

test("rejects nonlocal profile targets", async () => {
  for (const url of ["https://example.com", "http://example.com", "http://user@localhost/"]) {
    await assert.rejects(createControlledPreview(url), /loopback/);
  }
});

test("shapes bytes while preserving range and HEAD semantics", async () => {
  const server = createServer((request, response) => {
    const range = request.headers.range;
    const size = range ? 100 : 32_000;
    response.writeHead(range ? 206 : 200, { "content-length": String(size), "accept-ranges": "bytes",
      ...(range ? { "content-range": "bytes 0-99/32000" } : {}) });
    response.end(request.method === "HEAD" ? undefined : new globalThis.Uint8Array(size));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = await createControlledPreview(`http://127.0.0.1:${server.address().port}/RiftVersus/`, { latencyMs: 30, bytesPerSecond: 32_000 });
  try {
    const started = globalThis.performance.now();
    const full = await globalThis.fetch(profile.url);
    assert.equal((await full.arrayBuffer()).byteLength, 32_000);
    assert.ok(globalThis.performance.now() - started >= 1000);
    const ranged = await globalThis.fetch(profile.url, { headers: { Range: "bytes=0-99" } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), "bytes 0-99/32000");
    assert.equal((await ranged.arrayBuffer()).byteLength, 100);
    const head = await globalThis.fetch(profile.url, { method: "HEAD" });
    assert.equal(head.headers.get("content-length"), "32000");
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await globalThis.fetch(profile.url, { method: "POST" })).status, 403);
  } finally {
    await profile.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
