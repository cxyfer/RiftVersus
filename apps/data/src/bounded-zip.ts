import { createHash } from "node:crypto";

export interface BoundedZipEntry {
  internalStream(type: "uint8array"): BoundedZipStreamHelper;
}

interface BoundedZipStreamHelper {
  on(event: "data", callback: (chunk: Uint8Array) => void): this;
  on(event: "end", callback: () => void): this;
  on(event: "error", callback: (error: Error) => void): this;
  pause(): this;
  resume(): this;
}

export interface BoundedZipExpected {
  byteSize: number;
  checksum: string;
}

export interface BoundedZipBudget {
  used: number;
  limit: number;
}

function chunkBytes(chunk: Uint8Array | string): Uint8Array {
  return typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
}

export async function readBoundedZipEntry(
  entry: BoundedZipEntry,
  expected: BoundedZipExpected,
  budget: BoundedZipBudget,
  label: string,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expected.byteSize) || expected.byteSize < 0) throw new Error(`ZIP entry byte size is invalid: ${label}`);
  if (!Number.isSafeInteger(budget.used) || budget.used < 0 || !Number.isSafeInteger(budget.limit) || budget.limit < 0) {
    throw new Error(`ZIP byte budget is invalid: ${label}`);
  }
  if (expected.byteSize > budget.limit - budget.used) throw new Error(`ZIP entry exceeds the remaining uncompressed byte budget: ${label}`);

  let stream: BoundedZipStreamHelper;
  try {
    stream = entry.internalStream("uint8array");
  } catch (error) {
    throw new Error(`ZIP entry could not be opened: ${label}`, { cause: error });
  }

  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let actualByteSize = 0;
  await new Promise<void>((resolveStream, rejectStream) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      // Pause the worker; one in-flight chunk may still arrive, so callbacks stay attached and guarded.
      stream.pause();
      rejectStream(error);
    };
    const onData = (chunk: Uint8Array | string) => {
      if (settled) return;
      try {
        const bytes = chunkBytes(chunk);
        actualByteSize += bytes.byteLength;
        if (!Number.isSafeInteger(actualByteSize) || actualByteSize > expected.byteSize) {
          fail(new Error(`ZIP entry exceeds the indexed byte size: ${label}`));
          return;
        }
        if (!Number.isSafeInteger(budget.used + actualByteSize) || budget.used + actualByteSize > budget.limit) {
          fail(new Error(`ZIP entry exceeds the remaining uncompressed byte budget: ${label}`));
          return;
        }
        hash.update(bytes);
        chunks.push(bytes);
      } catch (error) {
        fail(error);
      }
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      resolveStream();
    };
    const onError = (error: Error) => fail(error);
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    stream.resume();
  });

  if (actualByteSize !== expected.byteSize || hash.digest("hex") !== expected.checksum) {
    throw new Error(`ZIP entry checksum or byte size mismatch: ${label}`);
  }
  budget.used += actualByteSize;
  const result = new Uint8Array(actualByteSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
