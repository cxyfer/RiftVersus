export interface DownloadRequest {
  url: string;
  allowedHosts: readonly string[];
  allowedContentTypes: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export interface DownloadResult {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
}

export interface DownloadDependencies {
  fetch?: typeof globalThis.fetch;
}

function validateUrl(raw: string, allowedHosts: ReadonlySet<string>): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Downloads require HTTPS.");
  if (!allowedHosts.has(url.hostname.toLowerCase())) throw new Error(`Download host is not allow-listed: ${url.hostname}`);
  return url;
}

function abortSignal(timeoutMs: number, caller?: AbortSignal): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Download timed out after ${timeoutMs}ms.`)), timeoutMs);
  const onAbort = () => controller.abort(caller?.reason ?? new Error("Download cancelled."));
  caller?.addEventListener("abort", onAbort, { once: true });
  if (caller?.aborted) onAbort();
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      caller?.removeEventListener("abort", onAbort);
    },
  };
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Download exceeds maximum byte size of ${maxBytes}.`);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await withAbort(reader.read(), signal);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Download exceeds maximum byte size of ${maxBytes}.`);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadBounded(request: DownloadRequest, dependencies: DownloadDependencies = {}): Promise<DownloadResult> {
  if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) throw new Error("maxBytes must be a positive safe integer.");
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) throw new Error("timeoutMs must be a positive safe integer.");
  const maxRedirects = request.maxRedirects ?? 5;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) throw new Error("maxRedirects must be between 0 and 5.");
  const allowedHosts = new Set(request.allowedHosts.map((host) => host.toLowerCase()));
  const allowedTypes = new Set(request.allowedContentTypes.map((type) => type.toLowerCase()));
  let url = validateUrl(request.url, allowedHosts);
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const abort = abortSignal(request.timeoutMs, request.signal);
  try {
    for (let redirects = 0; ; redirects += 1) {
      if (abort.signal.aborted) throw abort.signal.reason;
      const response = await withAbort(fetchImplementation(url, { redirect: "manual", signal: abort.signal }), abort.signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (location === null) throw new Error("Redirect response has no Location header.");
        if (redirects >= maxRedirects) throw new Error(`Download exceeds maximum redirects of ${maxRedirects}.`);
        url = validateUrl(new URL(location, url).toString(), allowedHosts);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Download failed with HTTP ${response.status}.`);
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
      if (!allowedTypes.has(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Download content type is not allowed: ${contentType || "missing"}`);
      }
      const bytes = await readBounded(response, request.maxBytes, abort.signal);
      return { bytes, contentType, finalUrl: url.toString() };
    }
  } finally {
    abort.cleanup();
  }
}
