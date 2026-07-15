import { describe, expect, it } from "vitest";

describe("PostgreSQL date text parser", () => {
  it("accepts canonical calendar dates and fails closed for unsupported PostgreSQL date text", async () => {
    const dbModule = await import("../packages/database/src/db.js") as Record<string, unknown>;
    expect(dbModule).toHaveProperty("parsePostgresDateText");
    const parse = dbModule.parsePostgresDateText as (value: string) => string;

    expect(parse("0001-01-01")).toBe("0001-01-01");
    expect(parse("2024-02-29")).toBe("2024-02-29");
    for (const invalid of ["2023-02-29", "infinity", "-infinity", "0001-01-01 BC", "10000-01-01"]) {
      expect(() => parse(invalid)).toThrow();
    }
  });
});
