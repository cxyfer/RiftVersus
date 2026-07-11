export const seedIds = {
  teamA: "00000000-0000-4000-8000-000000000001",
  teamB: "00000000-0000-4000-8000-000000000002",
  teamC: "00000000-0000-4000-8000-000000000003",
  tournament: "00000000-0000-4000-8000-000000000009",
  series: "00000000-0000-4000-8000-000000000010",
  game: "00000000-0000-4000-8000-000000000011",
  sourceObject: "00000000-0000-4000-8000-000000000012",
} as const;

export function createTestSchemaName() {
  return `rv_test_${crypto.randomUUID().replaceAll("-", "")}`;
}
