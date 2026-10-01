import type { DatabaseSync } from "node:sqlite";
import { queryEntries, sumCost } from "./db.js";
import { weekKey, weekRange, fmtUsd } from "./util.js";

export interface Budget {
  scope: string; // "global" | "project:<p>" | "agent:<a>"
  weeklyUsd: number;
}

export function setBudget(db: DatabaseSync, scope: string, weeklyUsd: number): void {
  if (!(weeklyUsd > 0)) throw new Error("budget must be a positive number");
  db.prepare(
    `INSERT INTO budgets (scope, weekly_usd) VALUES (?, ?)
     ON CONFLICT(scope) DO UPDATE SET weekly_usd = excluded.weekly_usd`,
  ).run(scope, weeklyUsd);
}

export function listBudgets(db: DatabaseSync): Budget[] {
  const rows = db.prepare("SELECT scope, weekly_usd FROM budgets ORDER BY scope").all() as {
    scope: string;
    weekly_usd: number;
  }[];
  return rows.map((r) => ({ scope: r.scope, weeklyUsd: r.weekly_usd }));
}

export function scopeQuery(scope: string): { agent?: string; project?: string } {
  if (scope === "global") return {};
  if (scope.startsWith("project:")) return { project: scope.slice("project:".length) };
  if (scope.startsWith("agent:")) return { agent: scope.slice("agent:".length) };
  throw new Error(`unknown budget scope: ${scope}`);
}

export function spendForWeek(db: DatabaseSync, key: string, scope: string): number {
  const { start, end } = weekRange(key);
  return sumCost(db, { startIso: start.toISOString(), endIso: end.toISOString(), ...scopeQuery(scope) });
}

export type BudgetStatus = "ok" | "near" | "over";

export function budgetStatus(spend: number, limit: number): BudgetStatus {
  if (spend >= limit) return "over";
  if (spend >= limit * 0.8) return "near";
  return "ok";
}

export interface BudgetReport {
  scope: string;
  weeklyUsd: number;
  spend: number;
  status: BudgetStatus;
}

export function currentBudgetReports(db: DatabaseSync, now = new Date()): BudgetReport[] {
  const key = weekKey(now);
  return listBudgets(db).map((b) => {
    const spend = spendForWeek(db, key, b.scope);
    return { scope: b.scope, weeklyUsd: b.weeklyUsd, spend, status: budgetStatus(spend, b.weeklyUsd) };
  });
}

/** Warnings for budgets affected by a freshly added entry (week of entry ts). */
export function checkBudgetsForEntry(
  db: DatabaseSync,
  entryTs: Date,
  agent: string,
  project: string,
): string[] {
  const key = weekKey(entryTs);
  const scopes = new Set(["global"]);
  if (project) scopes.add(`project:${project}`);
  if (agent) scopes.add(`agent:${agent}`);
  const warnings: string[] = [];
  for (const b of listBudgets(db)) {
    if (!scopes.has(b.scope)) continue;
    const spend = spendForWeek(db, key, b.scope);
    const status = budgetStatus(spend, b.weeklyUsd);
    if (status === "over") {
      warnings.push(`⚠ BUDGET EXCEEDED [${b.scope}] ${key}: ${fmtUsd(spend)} spent of ${fmtUsd(b.weeklyUsd)} weekly limit`);
    } else if (status === "near") {
      warnings.push(`⚠ budget nearly reached [${b.scope}] ${key}: ${fmtUsd(spend)} of ${fmtUsd(b.weeklyUsd)} (>=80%)`);
    }
  }
  return warnings;
}

/** All entries in the given week (any scope). */
export function entriesForWeek(db: DatabaseSync, key: string) {
  const { start, end } = weekRange(key);
  return queryEntries(db, { startIso: start.toISOString(), endIso: end.toISOString() });
}
