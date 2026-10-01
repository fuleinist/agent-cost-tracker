import type { DatabaseSync } from "node:sqlite";
import { round6 } from "./util.js";

// $ per 1M tokens: { in, out }. Model keys are matched as substrings of the
// reported model name, so "sonnet" matches "claude-sonnet-4-5" etc.
export const BUILTIN_PRICES: Record<string, Record<string, { in: number; out: number }>> = {
  "claude-code": {
    default: { in: 3, out: 15 },
    opus: { in: 15, out: 75 },
    sonnet: { in: 3, out: 15 },
    haiku: { in: 0.8, out: 4 },
    fable: { in: 5, out: 25 },
  },
  cursor: {
    default: { in: 3, out: 15 },
    sonnet: { in: 3, out: 15 },
    gpt: { in: 2.5, out: 10 },
  },
  copilot: {
    default: { in: 0, out: 0 }, // subscription — record flat costs with `act add --cost`
  },
  codex: {
    default: { in: 2.5, out: 10 },
    mini: { in: 0.25, out: 2 },
  },
  gemini: {
    default: { in: 1.25, out: 10 },
    flash: { in: 0.3, out: 2.5 },
  },
  local: {
    default: { in: 0, out: 0 }, // local models are free at the margin
  },
};

export interface Price {
  perMtokIn: number;
  perMtokOut: number;
  source: string; // "db" | "builtin" | "none"
  modelKey: string;
}

function dbOverride(db: DatabaseSync, agent: string, model: string): Price | null {
  const row = db
    .prepare("SELECT * FROM prices WHERE agent = ? AND model = ?")
    .get(agent, model) as { per_mtok_in: number; per_mtok_out: number } | undefined;
  if (!row) return null;
  return {
    perMtokIn: row.per_mtok_in,
    perMtokOut: row.per_mtok_out,
    source: "db",
    modelKey: model,
  };
}

export function lookupPrice(db: DatabaseSync, agent: string, model: string): Price {
  const m = (model || "").toLowerCase();
  // 1. Exact DB override, then agent default override.
  if (m) {
    const exact = dbOverride(db, agent, m);
    if (exact) return exact;
  }
  const agentDefault = dbOverride(db, agent, "default");
  // 2. Built-in alias matching.
  const table = BUILTIN_PRICES[agent] ?? BUILTIN_PRICES[agent.split(/[-@/]/)[0]] ?? undefined;
  if (table && m) {
    for (const key of Object.keys(table)) {
      if (key !== "default" && (m.includes(key) || key.includes(m))) {
        return { perMtokIn: table[key].in, perMtokOut: table[key].out, source: "builtin", modelKey: key };
      }
    }
  }
  // 3. DB agent default beats built-in agent default.
  if (agentDefault) return agentDefault;
  if (table) return { perMtokIn: table.default.in, perMtokOut: table.default.out, source: "builtin", modelKey: "default" };
  // 4. Unknown agent — zero price, caller warns.
  return { perMtokIn: 0, perMtokOut: 0, source: "none", modelKey: m || "default" };
}

export function computeCost(tokensIn: number, tokensOut: number, p: Price): number {
  return round6((tokensIn / 1e6) * p.perMtokIn + (tokensOut / 1e6) * p.perMtokOut);
}

export function setDbPrice(db: DatabaseSync, agent: string, model: string, perIn: number, perOut: number): void {
  db.prepare(
    `INSERT INTO prices (agent, model, per_mtok_in, per_mtok_out) VALUES (?, ?, ?, ?)
     ON CONFLICT(agent, model) DO UPDATE SET per_mtok_in = excluded.per_mtok_in, per_mtok_out = excluded.per_mtok_out`,
  ).run(agent, model, perIn, perOut);
}

export function listDbPrices(db: DatabaseSync): { agent: string; model: string; per_mtok_in: number; per_mtok_out: number }[] {
  return db.prepare("SELECT * FROM prices ORDER BY agent, model").all() as never[];
}
