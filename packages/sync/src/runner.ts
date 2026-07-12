import { retainMedia, retainSource } from "./publication.js";
import { validateSyncRequest, type SyncDependencies, type SyncProvider, type SyncRequest, type SyncResult } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runSync(provider: SyncProvider, requestInput: SyncRequest, dependencies: SyncDependencies): Promise<SyncResult> {
  const request = validateSyncRequest(requestInput);
  const acquired = await dependencies.repository.acquireLock(provider.id);
  if (!acquired) return { status: "locked" };

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
      sourceObjectId: sourceRecord.id,
      media,
      coverage: batch.coverage,
      facts: batch.facts,
      rosterGameIds: batch.rosterGameIds,
    });
    return { status: "published", version: published.version };
  } catch (error) {
    if (syncRunId !== undefined) {
      try {
        await dependencies.repository.failRun({ syncRunId, error: errorMessage(error) });
      } catch (failureRecordingError) {
        throw new AggregateError([error, failureRecordingError], "Sync failed and its failure could not be recorded.", { cause: failureRecordingError });
      }
    }
    throw error;
  } finally {
    await dependencies.repository.releaseLock(provider.id);
  }
}
