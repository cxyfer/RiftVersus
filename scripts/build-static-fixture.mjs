import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_COMPARISON_SUBJECTS } from "../packages/domain/dist/default-comparison.js";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputDirectory = join(rootDirectory, "apps", "web", "dist");
const outputDirectory = resolve(process.argv[2] ?? defaultOutputDirectory);
const basePath = normalizeBasePath(process.env.VITE_BASE_PATH ?? "/RiftVersus/");

const SUBJECT_IDS = {
  t1: DEFAULT_COMPARISON_SUBJECTS.left.id,
  geng: "22222222-2222-4222-8222-222222222222",
  blg: "33333333-3333-4333-8333-333333333333",
  faker: "44444444-4444-4444-8444-444444444444",
  knight: "55555555-5555-4555-8555-555555555555",
  lck: "66666666-6666-4666-8666-666666666666",
  lpl: DEFAULT_COMPARISON_SUBJECTS.right.id,
};

const generatedAvatarModule = await import("../apps/data/dist/avatar.js");
const snapshotModule = await import("../apps/data/dist/export-snapshot.js");
const { generateCanonicalAvatar } = generatedAvatarModule;
const { writeSnapshotData } = snapshotModule;

function normalizeBasePath(value) {
  if (!value.startsWith("/") || value.includes("..") || /[?#\\]/u.test(value)) {
    throw new Error("VITE_BASE_PATH must be a safe absolute path.");
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest();
}

function uuidFromKey(key) {
  const bytes = hashBytes(key).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function entity({ kind, id, displayName, realName, eraLabel, teamEraId, canonicalName, slug, aliases, avatarLabel }) {
  return {
    id,
    kind,
    displayName,
    ...(realName === undefined ? {} : { realName }),
    ...(eraLabel === undefined ? {} : { eraLabel }),
    ...(teamEraId === undefined ? {} : { teamEraId }),
    mediaUrl: `${basePath}presentation/pending.svg`,
    canonicalName,
    slug,
    aliases,
    avatarLabel,
    retainedObjectKey: null,
  };
}

function teamEntity(id, displayName, aliases = []) {
  return entity({
    kind: "team",
    id,
    displayName,
    canonicalName: displayName,
    slug: displayName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-"),
    aliases,
    avatarLabel: displayName,
  });
}

function addTeamEntities(entities, id, canonicalName, eras) {
  const aliases = eras.map((era) => era.displayName);
  entities.push(teamEntity(id, canonicalName, aliases));
  for (const era of eras) {
    entities.push(entity({
      kind: "team",
      id,
      displayName: era.displayName,
      eraLabel: era.label,
      teamEraId: era.id,
      canonicalName,
      slug: `${canonicalName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-${era.id.slice(0, 8)}`,
      aliases,
      avatarLabel: era.displayName,
    }));
  }
}

const t1Eras = {
  historic: { id: uuidFromKey("team-era:t1:sk-telecom-t1"), displayName: "SK Telecom T1", label: "2013-2016" },
  modern: { id: uuidFromKey("team-era:t1:t1"), displayName: "T1", label: "2019-2026" },
};

const opposingTeams = [
  ["Weibo Gaming", "weibo"],
  ["Top Esports", "top-esports"],
  ["Royal Club", "royal-club"],
  ["Edward Gaming", "edward-gaming"],
  ["JD Gaming", "jd-gaming"],
  ["Bilibili Gaming", "bilibili-gaming"],
  ["FunPlus Phoenix", "funplus-phoenix"],
  ["Invictus Gaming", "invictus-gaming"],
  ["LNG Esports", "lng-esports"],
].map(([displayName, slug]) => ({ id: uuidFromKey(`team:${slug}`), displayName, slug }));

const playerIds = {
  oner: uuidFromKey("player:oner"),
  zeus: uuidFromKey("player:zeus"),
  gumayusi: uuidFromKey("player:gumayusi"),
  keria: uuidFromKey("player:keria"),
};

function buildEntities() {
  const entities = [
    entity({ kind: "region", id: SUBJECT_IDS.lck, displayName: "LCK", canonicalName: "LCK", slug: "lck", aliases: ["Korea"], avatarLabel: "LCK" }),
    entity({ kind: "region", id: SUBJECT_IDS.lpl, displayName: "LPL", canonicalName: "LPL", slug: "lpl", aliases: ["China"], avatarLabel: "LPL" }),
    entity({ kind: "player", id: SUBJECT_IDS.faker, displayName: "Faker", realName: "Lee Sang-hyeok", canonicalName: "Faker", slug: "faker", aliases: ["Lee Sang-hyeok", "Hide on bush"], avatarLabel: "Faker" }),
    entity({ kind: "player", id: SUBJECT_IDS.knight, displayName: "knight", realName: "Zhuo Ding", canonicalName: "knight", slug: "knight", aliases: ["Zhuo Ding"], avatarLabel: "knight" }),
    entity({ kind: "player", id: playerIds.oner, displayName: "Oner", realName: "Mun Hyeon-jun", canonicalName: "Oner", slug: "oner", aliases: ["Mun Hyeon-jun"], avatarLabel: "Oner" }),
    entity({ kind: "player", id: playerIds.zeus, displayName: "Zeus", realName: "Choi Woo-je", canonicalName: "Zeus", slug: "zeus", aliases: ["Choi Woo-je"], avatarLabel: "Zeus" }),
    entity({ kind: "player", id: playerIds.gumayusi, displayName: "Gumayusi", realName: "Lee Min-hyeong", canonicalName: "Gumayusi", slug: "gumayusi", aliases: ["Lee Min-hyeong"], avatarLabel: "Gumayusi" }),
    entity({ kind: "player", id: playerIds.keria, displayName: "Keria", realName: "Ryu Min-seok", canonicalName: "Keria", slug: "keria", aliases: ["Ryu Min-seok"], avatarLabel: "Keria" }),
  ];

  addTeamEntities(entities, SUBJECT_IDS.t1, "T1", [t1Eras.historic, t1Eras.modern]);
  for (const team of opposingTeams) addTeamEntities(entities, team.id, team.displayName, []);
  return entities;
}

function gameSide(teamId, eraId, regionId, players, teamName) {
  return { teamId, eraId, regionId, playerIds: [...players], teamName };
}

function dateForSeries(year, index) {
  const month = String((index % 9) + 1).padStart(2, "0");
  const day = String((index % 24) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function tournamentFor(category, year, index) {
  const labels = {
    league: "LPL Playoffs",
    msi: "Mid-Season Invitational",
    fst: "First Stand",
    other: "Regional Cup",
    worlds: "World Championship",
  };
  return {
    id: uuidFromKey(`tournament:${category}:${year}:${index}`),
    name: `${labels[category]} ${year}`,
    category,
    league: "lpl",
  };
}

function makeSeries({ key, date, tournament, opponent, leftName, rightName, leftWins, rightWins, leftPlayers }) {
  const id = uuidFromKey(`series:${key}`);
  const leftSide = gameSide(SUBJECT_IDS.t1, leftName === "SK Telecom T1" ? t1Eras.historic.id : t1Eras.modern.id, SUBJECT_IDS.lck, [], leftName);
  const rightSide = gameSide(opponent.id, null, SUBJECT_IDS.lpl, [], rightName);
  const games = [];
  for (let gameNumber = 1; gameNumber <= leftWins + rightWins; gameNumber += 1) {
    games.push({
      id: uuidFromKey(`game:${key}:${gameNumber}`),
      seriesId: id,
      playedAt: `${date}T${String(10 + gameNumber).padStart(2, "0")}:00:00.000Z`,
      gameNumber,
      sides: [
        gameSide(leftSide.teamId, leftSide.eraId, leftSide.regionId, leftPlayers, leftName),
        gameSide(rightSide.teamId, rightSide.eraId, rightSide.regionId, [SUBJECT_IDS.knight], rightName),
      ],
      winnerSide: gameNumber <= leftWins ? "a" : "b",
    });
  }
  return {
    id,
    date,
    playedAt: `${date}T10:00:00.000Z`,
    tournament,
    bestOf: 5,
    sides: [leftSide, rightSide],
    games,
    completed: true,
    winnerSide: "a",
    score: { a: leftWins, b: rightWins },
  };
}

function buildSeries() {
  const series = [
    makeSeries({
      key: "worlds-2024-weibo",
      date: "2024-11-02",
      tournament: tournamentFor("worlds", 2024, 0),
      opponent: opposingTeams[0],
      leftName: "T1",
      rightName: "Weibo Gaming",
      leftWins: 3,
      rightWins: 1,
      leftPlayers: [SUBJECT_IDS.faker, playerIds.oner, playerIds.zeus, playerIds.gumayusi, playerIds.keria],
    }),
    makeSeries({
      key: "worlds-2023-weibo",
      date: "2023-11-19",
      tournament: tournamentFor("worlds", 2023, 1),
      opponent: opposingTeams[0],
      leftName: "SK Telecom T1",
      rightName: "Weibo Gaming",
      leftWins: 3,
      rightWins: 2,
      leftPlayers: [SUBJECT_IDS.faker, playerIds.oner, playerIds.zeus, playerIds.gumayusi, playerIds.keria],
    }),
    makeSeries({
      key: "worlds-2022-top",
      date: "2022-11-05",
      tournament: tournamentFor("worlds", 2022, 2),
      opponent: opposingTeams[1],
      leftName: "SK Telecom T1",
      rightName: "Top Esports",
      leftWins: 3,
      rightWins: 0,
      leftPlayers: [SUBJECT_IDS.faker, playerIds.oner, playerIds.zeus, playerIds.gumayusi, playerIds.keria],
    }),
  ];

  for (let index = 0; index < 98; index += 1) {
    const category = ["league", "msi", "fst", "other"][index % 4];
    const year = 2019 + Math.floor(index / 14);
    const opponent = opposingTeams[(index + 2) % opposingTeams.length];
    const leftWins = 3;
    const rightWins = index % 3;
    series.push(makeSeries({
      key: `broad-${index}`,
      date: dateForSeries(year, index),
      tournament: tournamentFor(category, year, index + 10),
      opponent,
      leftName: index % 5 === 0 ? "SK Telecom T1" : "T1",
      rightName: opponent.displayName,
      leftWins,
      rightWins,
      leftPlayers: [SUBJECT_IDS.faker, playerIds.oner, playerIds.zeus, playerIds.gumayusi, playerIds.keria],
    }));
  }
  return series;
}

async function writePresentationAssets(entities) {
  const seen = new Set();
  for (const item of entities) {
    const avatar = generateCanonicalAvatar({ kind: item.kind, id: item.id, label: item.avatarLabel });
    const filename = `${avatar.checksum}.svg`;
    if (!seen.has(filename)) {
      await writeFile(join(outputDirectory, "presentation", filename), avatar.body);
      seen.add(filename);
    }
    item.mediaUrl = `${basePath}presentation/${filename}`;
  }
}

await rm(join(outputDirectory, "data"), { recursive: true, force: true });
await rm(join(outputDirectory, "presentation"), { recursive: true, force: true });
await mkdir(join(outputDirectory, "presentation"), { recursive: true });

const projection = {
  schemaVersion: 1,
  dataset: {
    version: "static-fixture-v1",
    lastSuccessfulSyncAt: "2026-01-01T00:00:00.000Z",
    coverage: { from: "2019-01-01", to: "2026-12-31" },
  },
  coverageWarnings: [],
  entities: buildEntities(),
  series: buildSeries(),
  freshness: [],
  attribution: [],
};

await writePresentationAssets(projection.entities);
const snapshot = await writeSnapshotData(outputDirectory, projection);
const manifest = JSON.parse(await readFile(join(outputDirectory, "data", "manifest.json"), "utf8"));
if (
  manifest.schemaVersion !== 2
  || typeof manifest.database?.file !== "string"
  || !/^[a-f0-9]{64}\/database\.sqlite$/u.test(manifest.database.file)
  || manifest.database.pageSize !== 4096
  || manifest.database.requestChunkSize !== 4096
) {
  throw new Error("Static fixture writer must produce a schema v2 SQLite manifest.");
}

process.stdout.write(`Built static fixture ${snapshot.snapshotId} with ${snapshot.series.length} series at ${outputDirectory}\n`);
