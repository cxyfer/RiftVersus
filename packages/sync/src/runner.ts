import { retainMedia, retainSource } from "./publication.js";
import { RetainableStageError, validateSyncRequest, type SyncDependencies, type SyncProvider, type SyncRequest, type SyncResult } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runSync(provider: SyncProvider, requestInput: SyncRequest, dependencies: SyncDependencies): Promise<SyncResult> {
  const request = validateSyncRequest(requestInput);
  let result: Exclude<SyncResult, { status: "locked" }> | undefined;
  const lockStatus = await dependencies.repository.withLock(provider.id, async () => {
    let syncRunId: string | undefined;
    try {
      const run = await dependencies.repository.beginRun({
        provider: provider.id,
        mode: request.mode === "backfill" ? "backfill" : "sync",
        parserVersion: provider.parserVersion,
      });
      syncRunId = run.id;
      const batch = await provider.stage(request);
      await dependencies.validate(batch);
      const existing = await dependencies.repository.findPublication(batch.version);
      if (existing !== null) {
        await dependencies.repository.completeUnchanged({ syncRunId, version: existing.version });
        result = { status: "unchanged", version: existing.version };
        return;
      }

      const source = await retainSource(dependencies.objectStore, provider.id, provider.parserVersion, batch.source);
      const sourceRecord = await dependencies.repository.recordSource(source);
      const media = [];
      for (const input of batch.media) {
        const download = await dependencies.downloadMedia(input.sourceUrl);
        const record = await retainMedia(dependencies.objectStore, provider.id, {
          ...input,
          bytes: download.bytes,
          contentType: download.contentType,
        });
        media.push(record);
      }
      const published = await dependencies.repository.publish({
        syncRunId,
        version: batch.version,
        provenance: batch.provenance,
        sourceObjectId: sourceRecord.id,
        media,
        coverage: batch.coverage,
        dimensions: batch.dimensions,
        facts: batch.facts,
        rosterGameIds: batch.rosterGameIds,
        publicationScopes: batch.publicationScopes,
      });
      result = { status: "published", version: published.version };
    } catch (error) {
      let operationError: unknown = error;
      if (error instanceof RetainableStageError) {
        try {
          const retained = await retainSource(dependencies.objectStore, provider.id, provider.parserVersion, error.source);
          await dependencies.repository.recordSource(retained);
        } catch (retentionError) {
          operationError = new AggregateError([error, retentionError], "Sync staging failed and its raw evidence could not be retained.", { cause: error });
        }
      }
      if (syncRunId !== undefined) {
        try {
          await dependencies.repository.failRun({ syncRunId, error: errorMessage(operationError) });
        } catch (failureRecordingError) {
          throw new AggregateError([operationError, failureRecordingError], "Sync failed and its failure could not be recorded.", { cause: failureRecordingError });
        }
      }
      throw operationError;
    }
  });
  if (lockStatus === "locked") return { status: "locked" };
  if (result === undefined) throw new Error("Sync lock completed without a publication result.");
  return result;
}
