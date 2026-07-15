import type { LeaguepediaRawInput } from "./types.js";

export interface LeaguepediaRawEnvelope {
  format: "riftversus-leaguepedia-raw-v1";
  input: LeaguepediaRawInput;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function encodeLeaguepediaRawInput(input: LeaguepediaRawInput): Uint8Array {
  return new TextEncoder().encode(canonicalJson({ format: "riftversus-leaguepedia-raw-v1", input } satisfies LeaguepediaRawEnvelope));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, sortValue(item)]));
}
