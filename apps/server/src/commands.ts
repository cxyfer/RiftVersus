export type CliCommand =
  | { kind: "serve" }
  | { kind: "migrate" }
  | { kind: "sync-scheduled" }
  | { kind: "sync-health" }
  | { kind: "sync-map-check" }
  | { kind: "sync-history-once" }
  | { kind: "sync-once"; fixture: "leaguepedia-small" | null }
  | { kind: "backfill"; years: number[]; competitions: string[]; fixture: "leaguepedia-small" | null };

export const cliUsage = `Usage:
  riftversus serve
  riftversus migrate
  riftversus sync
  riftversus sync --history-once
  riftversus sync-health
  riftversus sync-map-check
  riftversus sync --once [--fixture leaguepedia-small]
  riftversus backfill --year YYYY [--year YYYY] --competition NAME [--competition NAME] [--fixture leaguepedia-small]`;

function fixtureValue(value: string | undefined): "leaguepedia-small" {
  if (value !== "leaguepedia-small") throw new Error("Fixture must be leaguepedia-small.");
  return value;
}

export function parseCliCommand(argv: readonly string[]): CliCommand {
  const [command, ...args] = argv;
  if (command === "serve" || command === "migrate" || command === "sync-health" || command === "sync-map-check") {
    if (args.length) throw new Error(`${command} does not accept arguments.`);
    return { kind: command };
  }
  if (command === "sync") {
    if (args.length === 0) return { kind: "sync-scheduled" };
    if (args.length === 1 && args[0] === "--history-once") return { kind: "sync-history-once" };
    if (args[0] !== "--once") throw new Error("sync accepts --history-once or --once with an optional reviewed fixture.");
    if (args.length === 1) return { kind: "sync-once", fixture: null };
    if (args.length === 3 && args[1] === "--fixture") return { kind: "sync-once", fixture: fixtureValue(args[2]) };
    throw new Error("Invalid sync arguments.");
  }
  if (command === "backfill") {
    const years: number[] = []; const competitions: string[] = []; let fixture: "leaguepedia-small" | null = null;
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index]; const value = args[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${flag}.`);
      if (flag === "--year") {
        const year = Number(value); if (!Number.isInteger(year) || year < 2011 || year > 2100) throw new Error("Backfill year must be between 2011 and 2100."); years.push(year);
      } else if (flag === "--competition") { if (!value.trim()) throw new Error("Backfill competition is required."); competitions.push(value.trim()); }
      else if (flag === "--fixture") fixture = fixtureValue(value);
      else throw new Error(`Unknown backfill flag: ${flag}.`);
    }
    if (years.length === 0) throw new Error("Backfill requires at least one --year.");
    if (competitions.length === 0) throw new Error("Backfill requires at least one --competition.");
    if (new Set(years).size !== years.length || new Set(competitions).size !== competitions.length) throw new Error("Backfill years and competitions must be unique.");
    if (years.length > 20 || competitions.length > 50) throw new Error("Backfill bounds exceed the supported limit.");
    return { kind: "backfill", years, competitions, fixture };
  }
  throw new Error(`Unknown command: ${command ?? "(missing)"}.`);
}
