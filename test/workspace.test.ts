import { describe, expect, it } from "vitest";
import { packageName as contractsPackageName } from "@riftversus/contracts";
import { packageName as databasePackageName } from "@riftversus/database";
import { packageName as domainPackageName } from "@riftversus/domain";
import { packageName as syncPackageName } from "@riftversus/sync";

describe("workspace public entry points", () => {
  it("exports each library package name", () => {
    expect(contractsPackageName).toBe("@riftversus/contracts");
    expect(domainPackageName).toBe("@riftversus/domain");
    expect(databasePackageName).toBe("@riftversus/database");
    expect(syncPackageName).toBe("@riftversus/sync");
  });
});
