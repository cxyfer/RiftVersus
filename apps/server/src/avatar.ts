import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { UuidSchema, type EntityKind } from "@riftversus/contracts";

export const CANONICAL_AVATAR_ALGORITHM = "canonical-avatar-v1" as const;
export const CANONICAL_AVATAR_CONTENT_TYPE = "image/svg+xml" as const;

export interface CanonicalAvatar {
  algorithm: typeof CANONICAL_AVATAR_ALGORITHM;
  contentType: typeof CANONICAL_AVATAR_CONTENT_TYPE;
  body: Buffer;
  checksum: string;
}

const palettes = [
  ["#172554", "#38BDF8", "#E0F2FE"],
  ["#3B0764", "#C084FC", "#F3E8FF"],
  ["#422006", "#FBBF24", "#FEF3C7"],
  ["#052E16", "#4ADE80", "#DCFCE7"],
  ["#450A0A", "#FB7185", "#FFE4E6"],
  ["#1E1B4B", "#818CF8", "#E0E7FF"],
  ["#431407", "#FB923C", "#FFEDD5"],
  ["#083344", "#22D3EE", "#CFFAFE"],
] as const;

const positions = [
  [30, 30], [64, 30], [98, 30], [30, 64],
  [98, 64], [30, 98], [64, 98], [98, 98],
] as const;

const identityPositions = [
  [16, 16], [48, 16], [80, 16], [112, 16],
  [16, 48], [48, 48], [80, 48], [112, 48],
  [16, 80], [48, 80], [80, 80], [112, 80],
  [16, 112], [48, 112], [80, 112], [112, 112],
] as const;

const radii = [18, 22, 26, 30] as const;

function digestByte(digest: Buffer, index: number): number {
  return digest[index] ?? 0;
}

function kindMarker(kind: EntityKind, fill: string): string {
  switch (kind) {
    case "player":
      return `<circle cx="64" cy="64" r="14" fill="${fill}"/>`;
    case "team":
      return `<polygon points="64,44 82,54 82,74 64,84 46,74 46,54" fill="${fill}"/>`;
    case "region":
      return `<polygon points="64,42 86,64 64,86 42,64" fill="${fill}"/>`;
  }
}

function identityRadius(byte: number): string {
  return `${2 + Math.floor(byte / 100)}.${String(byte % 100).padStart(2, "0")}`;
}

function identityGeometry(uuidBytes: Buffer, fill: string): string {
  return identityPositions.map(([cx, cy], index) =>
    `<circle cx="${cx}" cy="${cy}" r="${identityRadius(digestByte(uuidBytes, index))}" fill="${fill}"/>`
  ).join("");
}

export function generateCanonicalAvatar(kind: EntityKind, id: string): CanonicalAvatar {
  const canonicalId = UuidSchema.parse(id).toLowerCase();
  const digest = createHash("sha256").update(`${kind}:${canonicalId}`).digest();
  const uuidBytes = Buffer.from(canonicalId.replaceAll("-", ""), "hex");
  const palette = palettes[digestByte(digest, 0) % palettes.length]!;
  const firstPosition = positions[digestByte(digest, 1) % positions.length]!;
  const secondPosition = positions[digestByte(digest, 2) % positions.length]!;
  const firstRadius = radii[digestByte(digest, 3) % radii.length]!;
  const secondRadius = radii[digestByte(digest, 4) % radii.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><rect x="0" y="0" width="128" height="128" rx="24" fill="${palette[0]}"/><circle cx="${firstPosition[0]}" cy="${firstPosition[1]}" r="${firstRadius}" fill="${palette[1]}"/><circle cx="${secondPosition[0]}" cy="${secondPosition[1]}" r="${secondRadius}" fill="${palette[2]}"/>${identityGeometry(uuidBytes, palette[2])}${kindMarker(kind, palette[0])}</svg>`;
  const body = Buffer.from(svg, "utf8");

  return {
    algorithm: CANONICAL_AVATAR_ALGORITHM,
    contentType: CANONICAL_AVATAR_CONTENT_TYPE,
    body,
    checksum: createHash("sha256").update(body).digest("hex"),
  };
}
