import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

export async function createControlledPreview(value, { latencyMs = 150, bytesPerSecond = 1_250_000 } = {}) {
  const target = new URL(value);
  assert.ok(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    && !target.username && !target.password, "Controlled profile requires a loopback HTTP preview.");
  assert.ok(Number.isFinite(latencyMs) && latencyMs >= 0 && Number.isFinite(bytesPerSecond) && bytesPerSecond > 0);
  const sockets = new Set();
  const controllers = new Set();
  let nextByteAt = 0;
  const server = createServer(async (request, response) => {
    const controller = new globalThis.AbortController();
    controllers.add(controller);
    response.on("close", () => { if (!response.writableFinished) controller.abort(); });
    try {
      const upstreamUrl = new URL(request.url, target.origin);
      if (upstreamUrl.origin !== target.origin || !["GET", "HEAD"].includes(request.method)) {
        response.writeHead(403).end();
        return;
      }
      const headers = { "accept-encoding": "identity" };
      if (request.headers.range) headers.range = request.headers.range;
      const upstream = await globalThis.fetch(upstreamUrl, { method: request.method, headers, redirect: "error", signal: controller.signal });
      await delay(latencyMs, undefined, { signal: controller.signal });
      const outputHeaders = Object.fromEntries(upstream.headers);
      delete outputHeaders["transfer-encoding"];
      delete outputHeaders.connection;
      response.writeHead(upstream.status, outputHeaders);
      if (upstream.body && request.method !== "HEAD") {
        for await (const value of upstream.body) {
          for (let offset = 0; offset < value.byteLength; offset += 16_384) {
            const bytes = value.subarray(offset, offset + 16_384);
            const now = globalThis.performance.now();
            nextByteAt = Math.max(nextByteAt, now) + bytes.byteLength / bytesPerSecond * 1000;
            await delay(Math.max(0, nextByteAt - now), undefined, { signal: controller.signal });
            if (!response.write(bytes)) await new Promise((resolve, reject) => {
              const cleanup = () => { response.off("drain", drained); response.off("close", closed); };
              const drained = () => { cleanup(); resolve(); };
              const closed = () => { cleanup(); reject(new Error("Profile response closed.")); };
              response.once("drain", drained); response.once("close", closed);
            });
          }
        }
      }
      response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502).end();
      else response.destroy();
    } finally { controllers.delete(controller); }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const url = new URL(target.pathname + target.search, `http://127.0.0.1:${address.port}`);
  return {
    url: url.toString(),
    profile: { latencyMs, bytesPerSecond },
    async close() {
      for (const controller of controllers) controller.abort();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
