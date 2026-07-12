import { packageName as contractsPackageName } from "@riftversus/contracts";
import { packageName as databasePackageName } from "@riftversus/database";
import { packageName as domainPackageName } from "@riftversus/domain";
import {
  createLeaguepediaProvider,
  loadOverrides,
  packageName as syncPackageName,
  type LeaguepediaProviderOptions,
  type LeaguepediaSnapshot,
} from "@riftversus/sync";

const packageNames: readonly string[] = [
  contractsPackageName,
  domainPackageName,
  databasePackageName,
  syncPackageName,
];

void packageNames;
void createLeaguepediaProvider;
void loadOverrides;
void (undefined as LeaguepediaProviderOptions | LeaguepediaSnapshot | undefined);
