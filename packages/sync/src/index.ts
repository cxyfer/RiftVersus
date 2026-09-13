export const packageName = "@riftversus/sync";
export { downloadBounded } from "./download.js";
export type { DownloadDependencies, DownloadRequest, DownloadResult } from "./download.js";
export { mediaObjectKey, retainMedia, retainSource, sha256, sourceObjectKey } from "./publication.js";
export { runSync } from "./runner.js";
export { scheduleSync } from "./scheduler.js";
export type { ScheduleHandle, ScheduleOptions } from "./scheduler.js";
export { validateSyncRequest } from "./types.js";
export { RetainableStageError } from "./types.js";
export type {
  RetainedMediaInput, RetainedMediaRecord, RetainedSourceInput, RetainedSourceRecord, StagedSyncBatch,
  StagedDimensions, StagedEntityDefinition, StagedRegionDefinition, StagedTeamEraDefinition,
  StagedTournamentDefinition, StagedVersionProvenance, SyncDependencies, SyncProvider, SyncPublicationInput, SyncRepository, SyncRequest, SyncResult,
  PublicationScope,
} from "./types.js";
export type { ImmutableObject, ObjectStore, SignedObjectStore, StoredObjectMetadata } from "./storage.js";
export { createFilesystemObjectStore } from "./storage/filesystem.js";
export { loadSyncConfig } from "./config.js";
export type { SyncConfig } from "./config.js";
export { createS3ObjectStore } from "./storage/s3.js";
export { bootstrapS3Bucket } from "./storage/bootstrap.js";
export type { S3ObjectStoreConfig } from "./storage.js";
export { loadOverrides } from "./overrides.js";
export type { IdentityOverride, OverridePaths, RegionOverride, ReviewedOverrides, TournamentOverride } from "./overrides.js";
export {
  LeaguepediaApiError, LeaguepediaCargoEnvelopeError, LeaguepediaClient, LeaguepediaResourceLimitError, LeaguepediaSnapshotError, createLeaguepediaProvider, deriveLeaguepediaCoverage, fetchAllCargoPages, fetchLeaguepediaRawInput, fetchLeaguepediaSnapshot,
  encodeLeaguepediaRawInput, normalizeLeaguepediaSnapshot, parseLeaguepediaMedia, parseLeaguepediaRawInput,
} from "./providers/leaguepedia/index.js";
export type * from "./providers/leaguepedia/types.js";
export type { LeaguepediaProviderOptions } from "./providers/leaguepedia/index.js";
export type { LeaguepediaReadClient, SnapshotRequest, SnapshotResourceLimits, SnapshotSliceRequest, TraversedRows } from "./providers/leaguepedia/index.js";
