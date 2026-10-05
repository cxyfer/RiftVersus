import { z } from "zod";
import { isCompletedSeriesScore } from "./series-format.js";

import { CoverageWarningSchema } from "./comparison.js";
import { DatasetSchema } from "./dataset.js";
import { EntityKindSchema, PresentationImageUrlSchema, PublicIdSchema, UuidSchema } from "./entities.js";
import { BestOfSchema, EventCategorySchema, LeagueSlugSchema } from "./comparison.js";
import { DateSchema } from "./primitives.js";
import { MediaRightsBasisSchema, validMediaRights } from "./media-rights.js";

export const SnapshotIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u, "Expected a sha256 snapshot ID.");

export const SnapshotEntitySchema = z
  .object({
    id: UuidSchema,
    kind: EntityKindSchema,
    publicId: PublicIdSchema.optional(),
    publicEraId: PublicIdSchema.optional(),
    displayName: z.string().min(1),
    realName: z.string().min(1).optional(),
    eraLabel: z.string().min(1).optional(),
    teamEraId: UuidSchema.optional(),
    mediaUrl: PresentationImageUrlSchema,
    canonicalName: z.string().min(1),
    slug: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    avatarLabel: z.string().min(1),
    retainedObjectKey: z.string().min(1).nullable(),
  })
  .superRefine((entity, context) => {
    if (entity.kind !== "team" && entity.teamEraId !== undefined) {
      context.addIssue({ code: "custom", message: "teamEraId is only valid for team entities.", path: ["teamEraId"] });
    }
  });

export const SnapshotSideSchema = z.object({
  teamId: UuidSchema,
  eraId: UuidSchema.nullable(),
  regionId: UuidSchema.nullable(),
  playerIds: z.array(UuidSchema),
  teamName: z.string().min(1),
});

export const SnapshotGameSchema = z.object({
  id: UuidSchema,
  seriesId: UuidSchema,
  playedAt: z.iso.datetime(),
  gameNumber: z.number().int().positive(),
  sides: z.tuple([SnapshotSideSchema, SnapshotSideSchema]),
  winnerSide: z.enum(["a", "b"]).nullable(),
});

export const SnapshotSeriesSchema = z.object({
  id: UuidSchema,
  date: DateSchema,
  playedAt: z.iso.datetime(),
  tournament: z.object({
    id: UuidSchema,
    name: z.string().min(1),
    category: EventCategorySchema,
    league: LeagueSlugSchema.nullable(),
  }),
  bestOf: BestOfSchema,
  sides: z.tuple([SnapshotSideSchema, SnapshotSideSchema]),
  games: z.array(SnapshotGameSchema),
  completed: z.boolean(),
  winnerSide: z.enum(["a", "b"]).nullable(),
  score: z.object({ a: z.number().int().min(0), b: z.number().int().min(0) }),
}).superRefine((series, context) => {
  if (!series.completed) return;
  const expected = series.score.a === series.score.b ? null : series.score.a > series.score.b ? "a" : "b";
  if (!isCompletedSeriesScore(series.bestOf, series.score.a, series.score.b) || series.winnerSide !== expected) {
    context.addIssue({ code: "custom", message: "Completed series result must agree with its format and score.", path: ["score"] });
  }
});

// Build-time projection only. Browser queries execute against the SQLite artifact.
export const PublicSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: SnapshotIdSchema,
  dataset: DatasetSchema,
  coverageWarnings: z.array(CoverageWarningSchema),
  entities: z.array(SnapshotEntitySchema),
  series: z.array(SnapshotSeriesSchema),
  freshness: z.array(z.object({ competition: z.string(), seasonYear: z.number().int(), status: z.string(), checkedAt: z.iso.datetime().nullable() })).optional(),
  attribution: z.array(z.object({ objectKey: z.string(), sourceUrl: z.url(), license: z.string().min(1).nullable(), attribution: z.string().min(1), rightsBasis: MediaRightsBasisSchema.optional(), entityId: UuidSchema.optional(), teamEraId: UuidSchema.optional() }).refine(validMediaRights, "Media requires a license or reviewed editorial evidence and attribution.")).optional(),
});

const SqliteFileSchema = z.object({
  file: z.string().regex(/^[a-f0-9]{64}\/database\.sqlite$/u),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  byteSize: z.number().int().positive().max(256 * 1024 * 1024),
  pageSize: z.literal(4096),
  requestChunkSize: z.union([z.literal(4096), z.literal(16384), z.literal(32768), z.literal(65536)]),
}).strict();

export const SqliteManifestSchema = z.object({
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
  snapshotId: SnapshotIdSchema,
  dataset: DatasetSchema,
  coverageWarnings: z.array(CoverageWarningSchema),
  freshness: PublicSnapshotSchema.shape.freshness,
  attribution: PublicSnapshotSchema.shape.attribution,
  database: SqliteFileSchema,
}).strict().superRefine((manifest, context) => {
  if (manifest.database.file !== `${manifest.database.checksum}/database.sqlite` || manifest.database.byteSize % manifest.database.pageSize !== 0) {
    context.addIssue({ code: "custom", message: "SQLite path and file size must match its checksum and page size." });
  }
});

export type SqliteManifest = z.infer<typeof SqliteManifestSchema>;

export type SnapshotEntity = z.infer<typeof SnapshotEntitySchema>;
export type SnapshotSide = z.infer<typeof SnapshotSideSchema>;
export type SnapshotGame = z.infer<typeof SnapshotGameSchema>;
export type SnapshotSeries = z.infer<typeof SnapshotSeriesSchema>;
export type PublicSnapshot = z.infer<typeof PublicSnapshotSchema>;
