import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createDb } from "@riftversus/database";
import { sql } from "kysely";
import { verifyCheckpoint } from "./checkpoint.js";
import { join } from "node:path";

function runPostgres(command: "pg_dump" | "pg_restore", args: string[], databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !database) throw new Error("Invalid PostgreSQL URL.");
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer", PGCONNECT_TIMEOUT: "15" };
  return new Promise((resolve, reject) => {
    const child = spawn(command, command === "pg_restore" ? ["--dbname", database, ...args] : args, { env, stdio: ["ignore", "ignore", "pipe"] });
    // libpq diagnostics can contain connection details; keep them out of logs.
    child.stderr.resume();
    child.once("error", () => reject(new Error(`${command} could not start; install PostgreSQL 17 client tools.`)));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} failed with exit status ${code}.`)));
  });
}

export async function dumpDatabase(databaseUrl: string, destination: string, snapshot?: string): Promise<Uint8Array> {
  const db = createDb({ databaseUrl });
  try {
    const version = await sql<{ version: string }>`show server_version_num`.execute(db);
    const actual = Number(Object.values(version.rows[0] ?? {})[0]);
    if (Math.floor(actual / 10000) !== 17) throw new Error("Checkpoint requires PostgreSQL 17.");
  } finally { await db.destroy(); }
  await runPostgres("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", destination, ...(snapshot === undefined ? [] : ["--snapshot", snapshot])], databaseUrl);
  return readFile(destination);
}

export async function restoreDatabase(databaseUrl: string, directory: string): Promise<void> {
  await verifyCheckpoint(directory);
  const db = createDb({ databaseUrl });
  try {
    const version = await sql<{ server_version_num: string }>`show server_version_num`.execute(db);
    if (Math.floor(Number(version.rows[0]?.server_version_num) / 10000) !== 17) throw new Error("Checkpoint restore requires PostgreSQL 17.");
    const existing = await sql<{ count: string }>`select count(*)::text as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S','f')`.execute(db);
    if (existing.rows[0]?.count !== "0") throw new Error("Checkpoint restore requires an empty staging database.");
  } finally { await db.destroy(); }
  await runPostgres("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", join(directory, "database.dump")], databaseUrl);
}
