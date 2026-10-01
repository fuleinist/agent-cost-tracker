import type { DatabaseSync } from "node:sqlite";
import { queryEntries, type Entry } from "./db.js";
import { round6 } from "./util.js";

export type GroupBy = "agent" | "project" | "model";
export type RangeKind = "week" | "month" | "all";

export interface ReportRow {
  key: string;
  entries: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  pct: number;
}

export interface Report {
  range: RangeKind;
  startIso?: string;
  endIso?: string;
  by: GroupBy;
  total: number;
  entryCount: number;
  rows: ReportRow[];
}

function groupKey(e: Entry, by: GroupBy): string {
  if (by === "agent") return e.agent;
  if (by === "model") return e.model ? `${e.agent}/${e.model}` : `${e.agent}/(unknown model)`;
  return e.project || "(no project)";
}

export function buildReport(
  db: DatabaseSync,
  opts: { range: RangeKind; by: GroupBy; startIso?: string; endIso?: string },
): Report {
  const entries = queryEntries(db, { startIso: opts.startIso, endIso: opts.endIso });
  const map = new Map<string, ReportRow>();
  let total = 0;
  for (const e of entries) {
    const k = groupKey(e, opts.by);
    let row = map.get(k);
    if (!row) {
      row = { key: k, entries: 0, tokensIn: 0, tokensOut: 0, cost: 0, pct: 0 };
      map.set(k, row);
    }
    row.entries += 1;
    row.tokensIn += e.tokens_in;
    row.tokensOut += e.tokens_out;
    row.cost += e.cost_usd;
    total += e.cost_usd;
  }
  const rows = [...map.values()].sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));
  for (const r of rows) {
    r.cost = round6(r.cost);
    r.pct = total > 0 ? Math.round((r.cost / total) * 1000) / 10 : 0;
  }
  return {
    range: opts.range,
    startIso: opts.startIso,
    endIso: opts.endIso,
    by: opts.by,
    total: round6(total),
    entryCount: entries.length,
    rows,
  };
}
