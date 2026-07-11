import { packageName as contractsPackageName } from "@riftversus/contracts";
import { packageName as databasePackageName } from "@riftversus/database";
import { packageName as domainPackageName } from "@riftversus/domain";
import { packageName as syncPackageName } from "@riftversus/sync";

const packageNames: readonly string[] = [
  contractsPackageName,
  domainPackageName,
  databasePackageName,
  syncPackageName,
];

void packageNames;
