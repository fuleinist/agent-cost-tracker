import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Entry {
  id: number;
  ts: string;
  agent: string;
  model: string;
  project: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  note: string;
  dedupe_key: string | null;
}

export interface NewEntry {
  ts: string;
  agent: string;
  model?: string;
  project?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd: number;
  note?: string;
  dedupeKey?: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_entries_dedupe ON entries(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_entries_ts ON entries(ts);
CREATE INDEX IF NOT EXISTS ix_entries_project ON entries(project);
CREATE INDEX IF NOT EXISTS ix_entries_agent ON entries(agent);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL UNIQUE,
  weekly_usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS prices (
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  per_mtok_in REAL NOT NULL,
  per_mtok_out REAL NOT NULL,
  PRIMARY KEY (agent, model)
);
`;

export function defaultDbPath(): string {
  return process.env.ACT_DB || join(homedir(), ".act", "db.sqlite");
}

export function openDb(path?: string): DatabaseSync {
  const p = path ?? defaultDbPath();
  mkdirSync(dirname(p), { recursive: true });
  const db = new DatabaseSync(p);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

export function insertEntry(db: DatabaseSync, e: NewEntry): { id: number; inserted: boolean } {
  if (e.dedupeKey) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO entries (ts, agent, model, project, tokens_in, tokens_out, cost_usd, note, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const res = stmt.run(
      e.ts, e.agent, e.model ?? "", e.project ?? "",
      e.tokensIn ?? 0, e.tokensOut ?? 0, e.costUsd, e.note ?? "", e.dedupeKey,
    );
    return { id: Number(res.lastInsertRowid), inserted: res.changes > 0 };
  }
  const stmt = db.prepare(
    `INSERT INTO entries (ts, agent, model, project, tokens_in, tokens_out, cost_usd, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const res = stmt.run(
    e.ts, e.agent, e.model ?? "", e.project ?? "",
    e.tokensIn ?? 0, e.tokensOut ?? 0, e.costUsd, e.note ?? "",
  );
  return { id: Number(res.lastInsertRowid), inserted: true };
}

export interface EntryQuery {
  startIso?: string;
  endIso?: string;
  agent?: string;
  project?: string;
  limit?: number;
}

export function queryEntries(db: DatabaseSync, q: EntryQuery = {}): Entry[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q.startIso) { where.push("ts >= ?"); params.push(q.startIso); }
  if (q.endIso) { where.push("ts < ?"); params.push(q.endIso); }
  if (q.agent) { where.push("agent = ?"); params.push(q.agent); }
  if (q.project) { where.push("project = ?"); params.push(q.project); }
  let sql = "SELECT * FROM entries";
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY ts DESC, id DESC";
  if (q.limit) sql += " LIMIT ?" , params.push(q.limit);
  return db.prepare(sql).all(...params) as unknown as Entry[];
}

export function deleteEntry(db: DatabaseSync, id: number): boolean {
  return db.prepare("DELETE FROM entries WHERE id = ?").run(id).changes > 0;
}

export function sumCost(db: DatabaseSync, q: EntryQuery = {}): number {
  const rows = queryEntries(db, q);
  return rows.reduce((s, r) => s + r.cost_usd, 0);
}
