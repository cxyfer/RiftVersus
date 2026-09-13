import type { SyncConfig as Config } from "@riftversus/sync";

export interface MappingCheck {
  required: Array<{ competition: string; year: number }>;
  missing: Array<{ competition: string; year: number }>;
  mapped: Array<{ competition: string; year: number; sourceKeys: string[] }>;
}

export function checkLeaguepediaMappings(config: Config): MappingCheck {
  const required = config.leaguepedia.mappingCompetitions.flatMap((competition) => config.leaguepedia.mappingYears.map((year) => ({ competition, year })));
  const mapped: MappingCheck["mapped"] = [];
  const missing: MappingCheck["missing"] = [];
  for (const item of required) {
    const value = config.leaguepedia.competitionMap[item.competition]?.[String(item.year)];
    if (value === undefined) missing.push(item);
    else mapped.push({ ...item, sourceKeys: Array.isArray(value) ? value : [value] });
  }
  return { required, missing, mapped };
}
