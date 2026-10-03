import type { LeaguepediaCargoTable } from "./types.js";

const STRING_FIELDS: Readonly<Record<LeaguepediaCargoTable, readonly string[]>> = {
  Teams: ["OverviewPage", "Name", "Short", "Region", "OrganizationPage", "Image", "RenamedTo"],
  TeamRedirects: ["_pageName", "AllName"],
  Players: ["OverviewPage", "ID", "Name", "Player", "Team", "Image"],
  PlayerRedirects: ["OverviewPage", "ID", "AllName"],
  PlayerImages: ["Link", "Team", "Tournament", "FileName", "SortDate", "IsProfileImage"],
  Tournaments: ["OverviewPage", "Name", "Region", "DateStart", "StandardName", "BasePage", "AlternativeNames"],
  MatchSchedule: ["UniqueMatch", "MatchId", "OverviewPage", "DateTimeUTC", "Team1", "Team2"],
  ScoreboardGames: ["GameId", "MatchId", "Tournament", "DateTimeUTC", "Team1", "Team2"],
  ScoreboardPlayers: ["GameId", "PlayerWin", "PlayerDisplayName", "PlayerKey", "Team"],
};

export function decodeCargoExportRows(table: LeaguepediaCargoTable, response: unknown): Record<string, unknown>[] {
  if (!Array.isArray(response)) throw new Error("Leaguepedia CargoExport response must be a JSON array.");
  return response.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Leaguepedia CargoExport item ${index} must be an object.`);
    const normalized = { ...item };
    for (const field of STRING_FIELDS[table]) if (typeof normalized[field] === "number" && Number.isFinite(normalized[field])) normalized[field] = String(normalized[field]);
    if (table === "ScoreboardGames") {
      return { ...normalized, DateTime_UTC: normalized.DateTimeUTC, N_GameInMatch: normalized.GameNumber };
    }
    if (table === "MatchSchedule") return { ...normalized, DateTime_UTC: normalized.DateTimeUTC };
    if (table === "ScoreboardPlayers") {
      return { ...normalized, PlayerName: normalized.PlayerKey };
    }
    return normalized;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
