import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { UuidSchema, type EntityKind } from "@riftversus/contracts";

export const CANONICAL_AVATAR_ALGORITHM = "canonical-avatar-v2" as const;
export const CANONICAL_AVATAR_CONTENT_TYPE = "image/svg+xml" as const;

export interface AvatarIdentity {
  kind: EntityKind;
  id: string;
  label: string;
}

export interface CanonicalAvatar {
  algorithm: typeof CANONICAL_AVATAR_ALGORITHM;
  contentType: typeof CANONICAL_AVATAR_CONTENT_TYPE;
  abbreviation: string;
  body: Buffer;
  checksum: string;
}

type Palette = readonly [background: string, primary: string, secondary: string, text: string];

const palettes: readonly Palette[] = [
  ["#102A43", "#38BDF8", "#BAE6FD", "#FFFFFF"],
  ["#7F1D1D", "#FBBF24", "#FEF3C7", "#FFFFFF"],
  ["#14532D", "#34D399", "#D1FAE5", "#FFFFFF"],
  ["#312E81", "#FB7185", "#FFE4E6", "#FFFFFF"],
  ["#3F3F46", "#A3E635", "#ECFCCB", "#FFFFFF"],
  ["#164E63", "#F97316", "#FFEDD5", "#FFFFFF"],
  ["#4C1D95", "#22D3EE", "#CFFAFE", "#FFFFFF"],
  ["#1F2937", "#F472B6", "#FCE7F3", "#FFFFFF"],
] as const;

const knownRegionStyles: Readonly<Record<string, { palette: number; pattern: number }>> = {
  LCK: { palette: 0, pattern: 0 },
  LPL: { palette: 1, pattern: 1 },
  LEC: { palette: 2, pattern: 2 },
  LCS: { palette: 3, pattern: 3 },
};

const fallbackAbbreviation: Readonly<Record<EntityKind, string>> = {
  player: "PL",
  team: "TM",
  region: "RG",
};

function digestByte(digest: Buffer, index: number): number {
  return digest[index] ?? 0;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function avatarAbbreviation(kind: EntityKind, label: string): string {
  const words = label.normalize("NFKD").toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return fallbackAbbreviation[kind];
  if (words.length > 1) return words.slice(0, 3).map((word) => word[0]!).join("");
  const word = words[0]!;
  if (word.length === 1) return `${word}${word}`;
  return word.length <= 3 ? word : word.slice(0, 3);
}

function patternGeometry(pattern: number, palette: Palette, digest: Buffer): string {
  const offset = 8 + digestByte(digest, 2) % 17;
  switch (pattern) {
    case 0:
      return `<circle cx="${32 + offset}" cy="38" r="34" fill="${palette[1]}"/><circle cx="96" cy="${90 - offset}" r="28" fill="${palette[2]}"/>`;
    case 1:
      return `<polygon points="0,96 72,0 112,0 40,128 0,128" fill="${palette[1]}"/><polygon points="70,128 128,50 128,104 110,128" fill="${palette[2]}"/>`;
    case 2:
      return `<rect x="${offset}" y="18" width="30" height="92" rx="12" fill="${palette[1]}"/><rect x="${72 + offset % 10}" y="0" width="32" height="82" rx="12" fill="${palette[2]}"/>`;
    default:
      return `<circle cx="30" cy="30" r="${22 + offset % 9}" fill="${palette[1]}"/><polygon points="128,26 128,128 38,128" fill="${palette[2]}"/>`;
  }
}

function kindMarker(kind: EntityKind, fill: string): string {
  switch (kind) {
    case "player":
      return `<circle cx="18" cy="110" r="6" fill="${fill}"/>`;
    case "team":
      return `<polygon points="18,102 25,106 25,114 18,118 11,114 11,106" fill="${fill}"/>`;
    case "region":
      return `<rect x="12" y="104" width="12" height="12" rx="2" fill="${fill}"/>`;
  }
}

function avatarStyle(identity: AvatarIdentity, canonicalId: string): {
  digest: Buffer;
  palette: Palette;
  pattern: number;
} {
  const normalizedRegionLabel = identity.kind === "region"
    ? identity.label.normalize("NFKD").toUpperCase().trim()
    : "";
  const seed = identity.kind === "region"
    ? `${identity.kind}:${canonicalId}:${normalizedRegionLabel}`
    : `${identity.kind}:${canonicalId}`;
  const digest = createHash("sha256").update(seed).digest();
  const known = identity.kind === "region" ? knownRegionStyles[normalizedRegionLabel] : undefined;
  const paletteIndex = known?.palette ?? digestByte(digest, 0) % palettes.length;
  return {
    digest,
    palette: palettes[paletteIndex]!,
    pattern: known?.pattern ?? digestByte(digest, 1) % 4,
  };
}

export function generateCanonicalAvatar(identity: AvatarIdentity): CanonicalAvatar {
  const canonicalId = UuidSchema.parse(identity.id).toLowerCase();
  const abbreviation = avatarAbbreviation(identity.kind, identity.label);
  const style = avatarStyle(identity, canonicalId);
  const fontSize = abbreviation.length === 3 ? 38 : 44;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><rect x="0" y="0" width="128" height="128" rx="20" fill="${style.palette[0]}"/>${patternGeometry(style.pattern, style.palette, style.digest)}${kindMarker(identity.kind, style.palette[3])}<text x="64" y="66" fill="${style.palette[3]}" stroke="#0B1220" stroke-width="6" paint-order="stroke fill" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeXmlText(abbreviation)}</text></svg>`;
  const body = Buffer.from(svg, "utf8");

  return {
    algorithm: CANONICAL_AVATAR_ALGORITHM,
    contentType: CANONICAL_AVATAR_CONTENT_TYPE,
    abbreviation,
    body,
    checksum: createHash("sha256").update(body).digest("hex"),
  };
}
