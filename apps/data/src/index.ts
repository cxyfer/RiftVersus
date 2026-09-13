export { executeLeaguepediaSync, buildLeaguepediaSlices, createDatabaseSyncRepository } from "./sync-service.js";
export { historyRequests } from "./sync-plan.js";
export { checkLeaguepediaMappings } from "./mapping-check.js";
export { evaluateSyncHealth, readSyncHealth } from "./sync-health.js";
export { generateCanonicalAvatar, CANONICAL_AVATAR_ALGORITHM, CANONICAL_AVATAR_CONTENT_TYPE } from "./avatar.js";
export type { AvatarIdentity, CanonicalAvatar } from "./avatar.js";
export { verifyAcceptanceSnapshot } from "./acceptance.js";
export type { AcceptanceEvaluation } from "./acceptance.js";
