#!/usr/bin/env node
import process from "node:process";
import { parseArgs, str, bool, num } from "./args.js";
import { openDb, insertEntry, queryEntries, deleteEntry, defaultDbPath, type Entry } from "./db.js";
import { lookupPrice, computeCost, setDbPrice, listDbPrices, BUILTIN_PRICES } from "./prices.js";
import { setBudget, listBudgets, currentBudgetReports, checkBudgetsForEntry, spendForWeek } from "./budget.js";
import { buildReport, type GroupBy, type RangeKind } from "./report.js";
import { buildWeekly, renderWeeklyMd, renderWeeklyText } from "./weekly.js";
import { importClaudeCode } from "./importers/claude.js";
import { startServer } from "./serve.js";
import { renderTable, toCsv, fmtUsd, weekKey, weekRange, monthRange, round6, type Cell } from "./util.js";

// node:sqlite still prints ExperimentalWarning on some Node 22/24 builds.
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.error(w.toString());
});

const VERSION = "0.1.0";

const HELP = `agent-cost-tracker (act) v${VERSION} — cross-agent AI coding cost dashboard

Usage:
  act init                                    create/verify the local database
  act add --agent <a> [--model m] [--project p]
          [--tokens-in N] [--tokens-out N] [--cost X]
          [--note "..."] [--date ISO]         record usage (cost computed from price table if omitted)
  act list [--limit N] [--agent a] [--project p] [--format table|json|csv]
  act rm <id>                                 delete an entry
  act report [--week|--month|--all] [--by agent|project|model]
             [--format table|json|csv]
  act weekly [--week YYYY-Www] [--format md|text|json]
  act budget set --weekly X [--project p | --agent a]
  act budget list
  act prices                                  list built-in + custom prices
  act prices set --agent a [--model m] --in $/Mtok --out $/Mtok
  act import claude-code [--dir path] [--dry-run]
  act serve [--port 3737]                     local web dashboard

Global flags: --db <path>   (default: ~/.act/db.sqlite or $ACT_DB)
              --format json works on every data command.
`;

function fail(msg: string): never {
  console.error(`act: ${msg}`);
  process.exit(1);
}

function outputFormat(p: ReturnType<typeof parseArgs>): "table" | "json" | "csv" {
  const f = str(p, "format") ?? "table";
  if (f === "json" || f === "csv" || f === "table") return f;
  return fail(`unknown format: ${f}`);
}

function emit(format: "table" | "json" | "csv", headers: string[], rows: Cell[][], json: unknown): void {
  if (format === "json") console.log(JSON.stringify(json, null, 2));
  else if (format === "csv") console.log(toCsv(headers, rows));
  else console.log(rows.length ? renderTable(headers, rows) : "(no data)");
}

function rangeFor(p: ReturnType<typeof parseArgs>, now: Date): { range: RangeKind; startIso?: string; endIso?: string } {
  if (bool(p, "all")) return { range: "all" };
  if (bool(p, "month")) {
    const { start, end } = monthRange(now);
    return { range: "month", startIso: start.toISOString(), endIso: end.toISOString() };
  }
  const { start, end } = weekRange(weekKey(now));
  return { range: "week", startIso: start.toISOString(), endIso: end.toISOString() };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const p = parseArgs(argv);
  const [cmd, ...rest] = p._;

  if (bool(p, "version") || cmd === "version") {
    console.log(VERSION);
    return;
  }
  if (!cmd || cmd === "help" || bool(p, "help")) {
    console.log(HELP);
    return;
  }

  const dbPath = str(p, "db");
  const db = openDb(dbPath);
  const now = new Date();

  switch (cmd) {
    case "init": {
      console.log(`database ready: ${dbPath ?? defaultDbPath()}`);
      break;
    }

    case "add": {
      const agent = str(p, "agent") ?? fail("add: --agent is required");
      const model = str(p, "model") ?? "";
      const project = str(p, "project") ?? "";
      const tokensIn = num(p, "tokens-in") ?? 0;
      const tokensOut = num(p, "tokens-out") ?? 0;
      const explicitCost = num(p, "cost");
      const note = str(p, "note") ?? "";
      const dateStr = str(p, "date");
      let ts: Date;
      if (dateStr) {
        ts = new Date(dateStr);
        if (Number.isNaN(ts.getTime())) fail(`add: invalid --date "${dateStr}"`);
      } else {
        ts = now;
      }
      let cost: number;
      let priceSrc = "explicit";
      if (explicitCost !== undefined) {
        cost = round6(explicitCost);
      } else {
        if (tokensIn <= 0 && tokensOut <= 0) fail("add: provide --cost, or --tokens-in/--tokens-out");
        const price = lookupPrice(db, agent, model);
        if (price.source === "none") {
          console.error(`act: warning — no price known for agent "${agent}" model "${model || "(default)"}"; recording $0. Set one with: act prices set --agent ${agent} ${model ? `--model ${model} ` : ""}--in X --out Y`);
        }
        cost = computeCost(tokensIn, tokensOut, price);
        priceSrc = price.source;
      }
      const { id } = insertEntry(db, { ts: ts.toISOString(), agent, model, project, tokensIn, tokensOut, costUsd: cost, note });
      const result = { id, agent, model, project, tokensIn, tokensOut, costUsd: cost, ts: ts.toISOString(), priceSource: priceSrc };
      if (outputFormat(p) === "json") console.log(JSON.stringify(result, null, 2));
      else console.log(`recorded #${id}: ${agent}${model ? "/" + model : ""}${project ? " @" + project : ""} — ${fmtUsd(cost)}`);
      for (const w of checkBudgetsForEntry(db, ts, agent, project)) console.error(w);
      break;
    }

    case "list": {
      const format = outputFormat(p);
      const entries = queryEntries(db, {
        agent: str(p, "agent"),
        project: str(p, "project"),
        limit: num(p, "limit") ?? 20,
      });
      const headers = ["id", "when", "agent", "model", "project", "tok_in", "tok_out", "cost"];
      const rows = entries.map((e) => [e.id, e.ts.slice(0, 16).replace("T", " "), e.agent, e.model || "-", e.project || "-", e.tokens_in, e.tokens_out, fmtUsd(e.cost_usd)]);
      emit(format, headers, rows, entries);
      break;
    }

    case "rm": {
      const id = Number(rest[0]);
      if (!Number.isInteger(id) || id <= 0) fail("rm: usage `act rm <id>`");
      const ok = deleteEntry(db, id);
      console.log(ok ? `deleted entry #${id}` : `no entry with id ${id}`);
      if (!ok) process.exitCode = 1;
      break;
    }

    case "report": {
      const format = outputFormat(p);
      const byRaw = str(p, "by") ?? "agent";
      if (!["agent", "project", "model"].includes(byRaw)) fail(`report: unknown --by "${byRaw}"`);
      const by = byRaw as GroupBy;
      const range = rangeFor(p, now);
      const rep = buildReport(db, { ...range, by });
      const headers = [by, "entries", "tokens_in", "tokens_out", "cost", "share"];
      const rows = rep.rows.map((r) => [r.key, r.entries, r.tokensIn, r.tokensOut, fmtUsd(r.cost), `${r.pct}%`]);
      if (format === "json") console.log(JSON.stringify(rep, null, 2));
      else if (format === "csv") console.log(toCsv(headers, rows));
      else {
        console.log(`Spend report — range: ${rep.range}${rep.startIso ? ` (${rep.startIso.slice(0, 10)} → ${rep.endIso?.slice(0, 10)})` : ""}, grouped by ${by}`);
        console.log(rows.length ? renderTable(headers, rows) : "(no entries in range)");
        console.log(`TOTAL: ${fmtUsd(rep.total)} across ${rep.entryCount} entries`);
        if (rep.range === "week") {
          for (const b of currentBudgetReports(db, now)) {
            console.log(`budget [${b.scope}]: ${fmtUsd(b.spend)} / ${fmtUsd(b.weeklyUsd)} — ${b.status.toUpperCase()}`);
          }
        }
      }
      break;
    }

    case "weekly": {
      const format = str(p, "format") ?? "md";
      const data = buildWeekly(db, str(p, "week"), now);
      if (format === "json") console.log(JSON.stringify(data, null, 2));
      else if (format === "text") console.log(renderWeeklyText(data));
      else if (format === "md") console.log(renderWeeklyMd(data));
      else fail(`weekly: unknown format "${format}" (md|text|json)`);
      break;
    }

    case "budget": {
      const sub = rest[0];
      if (sub === "set") {
        const weekly = num(p, "weekly") ?? fail("budget set: --weekly <usd> is required");
        const project = str(p, "project");
        const agent = str(p, "agent");
        const scope = project ? `project:${project}` : agent ? `agent:${agent}` : "global";
        if (project && agent) fail("budget set: use only one of --project / --agent");
        setBudget(db, scope, weekly);
        console.log(`budget set [${scope}]: ${fmtUsd(weekly)}/week`);
      } else if (sub === "list" || !sub) {
        const format = outputFormat(p);
        const reports = currentBudgetReports(db, now);
        const key = weekKey(now);
        const headers = ["scope", "spent (" + key + ")", "weekly limit", "status"];
        const rows = reports.map((b) => [b.scope, fmtUsd(b.spend), fmtUsd(b.weeklyUsd), b.status]);
        emit(format, headers, rows, { week: key, budgets: reports });
      } else fail(`budget: unknown subcommand "${sub}" (set|list)`);
      break;
    }

    case "prices": {
      const sub = rest[0];
      if (sub === "set") {
        const agent = str(p, "agent") ?? fail("prices set: --agent is required");
        const model = (str(p, "model") ?? "default").toLowerCase();
        const pin = num(p, "in") ?? fail("prices set: --in <usd per Mtok> is required");
        const pout = num(p, "out") ?? fail("prices set: --out <usd per Mtok> is required");
        setDbPrice(db, agent, model, pin, pout);
        console.log(`price set: ${agent}/${model} = $${pin}/Mtok in, $${pout}/Mtok out`);
      } else {
        const format = outputFormat(p);
        type PRow = { agent: string; model: string; perMtokIn: number; perMtokOut: number; source: string };
        const all: PRow[] = [];
        for (const [agent, models] of Object.entries(BUILTIN_PRICES)) {
          for (const [model, pr] of Object.entries(models)) {
            all.push({ agent, model, perMtokIn: pr.in, perMtokOut: pr.out, source: "builtin" });
          }
        }
        for (const r of listDbPrices(db)) {
          const existing = all.find((x) => x.agent === r.agent && x.model === r.model);
          if (existing) { existing.perMtokIn = r.per_mtok_in; existing.perMtokOut = r.per_mtok_out; existing.source = "custom"; }
          else all.push({ agent: r.agent, model: r.model, perMtokIn: r.per_mtok_in, perMtokOut: r.per_mtok_out, source: "custom" });
        }
        const headers = ["agent", "model", "$/Mtok in", "$/Mtok out", "source"];
        const rows = all.map((r) => [r.agent, r.model, r.perMtokIn, r.perMtokOut, r.source]);
        emit(format, headers, rows, all);
      }
      break;
    }

    case "import": {
      const what = rest[0];
      if (what !== "claude-code") fail(`import: unknown source "${what ?? ""}" (supported: claude-code)`);
      const res = importClaudeCode(db, str(p, "dir"), bool(p, "dry-run"));
      const out = { source: "claude-code", ...res };
      if (outputFormat(p) === "json") console.log(JSON.stringify(out, null, 2));
      else console.log(`imported ${res.added} entries from ${res.files} transcript files (${res.skipped} duplicates skipped, ${res.malformed} malformed lines)${bool(p, "dry-run") ? " [dry-run]" : ""}`);
      if (!bool(p, "dry-run") && res.added > 0) {
        for (const w of checkBudgetsForEntry(db, now, "", "")) console.error(w);
        const g = currentBudgetReports(db, now);
        for (const b of g) {
          if (b.status !== "ok") console.error(`⚠ budget [${b.scope}] ${weekKey(now)}: ${fmtUsd(b.spend)} of ${fmtUsd(b.weeklyUsd)} — ${b.status.toUpperCase()}`);
        }
      }
      break;
    }

    case "serve": {
      const port = num(p, "port") ?? Number(process.env.PORT ?? 3737);
      const server = await startServer(db, port);
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`dashboard: http://localhost:${actualPort} (db: ${dbPath ?? defaultDbPath()})`);
      await new Promise<void>((resolve) => {
        process.on("SIGINT", () => { server.close(); resolve(); });
        process.on("SIGTERM", () => { server.close(); resolve(); });
      });
      break;
    }

    default:
      fail(`unknown command "${cmd}" — try \`act help\``);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
