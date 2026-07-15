import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import { UuidSchema, type EntityKind, type ResolvedSubject } from "@riftversus/contracts";
import type { AcceptanceMediaObjectMetadata } from "@riftversus/database";
import { z } from "zod";

import {
  CANONICAL_AVATAR_ALGORITHM,
  CANONICAL_AVATAR_CONTENT_TYPE,
  type CanonicalAvatar,
} from "./avatar.js";

const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ExpectedPresentationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("retained-media"),
    checksum: ChecksumSchema,
    contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  }).strict(),
  z.object({
    kind: z.literal("generated-avatar"),
    entityKind: z.enum(["player", "team", "region"]),
    entityId: UuidSchema,
    algorithm: z.literal(CANONICAL_AVATAR_ALGORITHM),
    checksum: ChecksumSchema,
    contentType: z.literal(CANONICAL_AVATAR_CONTENT_TYPE),
  }).strict(),
]);

export type ExpectedPresentation = z.infer<typeof ExpectedPresentationSchema>;

export interface AcceptancePresentationDependencies {
  maxMediaObjectBytes: number;
  getRawObject(key: string): Promise<Readable | null>;
  getMediaMetadata(key: string): Promise<AcceptanceMediaObjectMetadata | null>;
  generateAvatar(kind: EntityKind, id: string): CanonicalAvatar;
}

export async function readAndHash(stream: Readable, maxBytes: number): Promise<{ checksum: string; body: Buffer }> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteSize += bytes.byteLength;
    if (byteSize > maxBytes) throw new Error(`Immutable raw object exceeds ${maxBytes} bytes.`);
    chunks.push(bytes);
  }
  const body = Buffer.concat(chunks);
  return { checksum: createHash("sha256").update(body).digest("hex"), body };
}

function mediaObjectKey(mediaUrl: string): string | null {
  if (!mediaUrl.startsWith("/media/") || mediaUrl.includes("?") || mediaUrl.includes("#")) return null;
  const rawKey = mediaUrl.slice("/media/".length);
  if (!rawKey || /%(?:2f|5c|25)/iu.test(rawKey)) return null;
  try {
    const key = decodeURIComponent(rawKey);
    if ([...key].some((character) => (character.codePointAt(0) ?? 0) <= 31)
      || key.includes("%") || key.includes("\\")
      || key.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
    return key;
  } catch {
    return null;
  }
}

async function verifyRetainedMedia(
  side: "left" | "right",
  mediaUrl: string,
  expected: Extract<ExpectedPresentation, { kind: "retained-media" }>,
  dependencies: AcceptancePresentationDependencies,
  blockers: string[],
): Promise<void> {
  const key = mediaObjectKey(mediaUrl);
  if (key === null || key.endsWith("placeholder.svg")) {
    blockers.push(`Canonical retained media URL is invalid for ${side}.`);
    return;
  }
  const metadata = await dependencies.getMediaMetadata(key);
  if (metadata === null) {
    blockers.push(`Canonical media metadata is missing for ${side}.`);
    return;
  }
  const stream = await dependencies.getRawObject(key);
  if (stream === null) {
    blockers.push(`Canonical media object is missing for ${side}.`);
    return;
  }
  const retained = await readAndHash(stream, dependencies.maxMediaObjectBytes);
  if (retained.body.byteLength === 0 || retained.checksum !== metadata.checksum) blockers.push(`Canonical media checksum is invalid for ${side}.`);
  if (metadata.checksum !== expected.checksum) blockers.push(`Canonical object does not match reviewed media checksum for ${side}.`);
  if (metadata.contentType !== expected.contentType) blockers.push(`Canonical media content type does not match reviewed media for ${side}.`);
  if (metadata.objectKey !== key || metadata.byteSize !== String(retained.body.byteLength)) blockers.push(`Canonical media metadata does not match retained object for ${side}.`);
}

function verifyGeneratedAvatar(
  side: "left" | "right",
  subject: ResolvedSubject,
  mediaUrl: string,
  expected: Extract<ExpectedPresentation, { kind: "generated-avatar" }>,
  dependencies: AcceptancePresentationDependencies,
  blockers: string[],
): void {
  const canonicalId = expected.entityId.toLowerCase();
  const expectedUrl = `/avatars/${expected.entityKind}/${canonicalId}.svg`;
  if (subject.kind !== expected.entityKind || subject.id.toLowerCase() !== canonicalId) {
    blockers.push(`Generated avatar subject identity does not match reviewed evidence for ${side}.`);
    return;
  }
  if (mediaUrl !== expectedUrl || mediaUrl.endsWith("placeholder.svg")) {
    blockers.push(`Canonical generated avatar URL is invalid for ${side}.`);
    return;
  }

  const avatar = dependencies.generateAvatar(expected.entityKind, canonicalId);
  const bodyChecksum = createHash("sha256").update(avatar.body).digest("hex");
  if (avatar.algorithm !== CANONICAL_AVATAR_ALGORITHM || avatar.algorithm !== expected.algorithm) blockers.push(`Generated avatar algorithm does not match reviewed evidence for ${side}.`);
  if (avatar.contentType !== CANONICAL_AVATAR_CONTENT_TYPE || avatar.contentType !== expected.contentType) blockers.push(`Generated avatar content type does not match reviewed evidence for ${side}.`);
  if (avatar.body.byteLength === 0 || avatar.checksum !== bodyChecksum) blockers.push(`Generated avatar checksum does not match its bytes for ${side}.`);
  if (avatar.checksum !== expected.checksum || bodyChecksum !== expected.checksum) blockers.push(`Generated avatar does not match reviewed checksum for ${side}.`);
}

export async function verifyPresentation(
  side: "left" | "right",
  subject: ResolvedSubject,
  mediaUrl: string,
  expected: ExpectedPresentation,
  dependencies: AcceptancePresentationDependencies,
  blockers: string[],
): Promise<void> {
  if (expected.kind === "retained-media") {
    await verifyRetainedMedia(side, mediaUrl, expected, dependencies, blockers);
    return;
  }
  verifyGeneratedAvatar(side, subject, mediaUrl, expected, dependencies, blockers);
}
