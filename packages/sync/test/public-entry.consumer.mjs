import assert from "node:assert/strict";
import { packageName as contractsPackageName } from "@riftversus/contracts";
import { packageName as databasePackageName } from "@riftversus/database";
import { packageName as domainPackageName } from "@riftversus/domain";
import { createLeaguepediaProvider, loadOverrides, packageName as syncPackageName } from "@riftversus/sync";

assert.equal(contractsPackageName, "@riftversus/contracts");
assert.equal(domainPackageName, "@riftversus/domain");
assert.equal(databasePackageName, "@riftversus/database");
assert.equal(syncPackageName, "@riftversus/sync");
assert.equal(typeof createLeaguepediaProvider, "function");
assert.equal(typeof loadOverrides, "function");
