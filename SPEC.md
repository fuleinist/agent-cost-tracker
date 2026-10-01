# SPEC — agent-cost-tracker (act)

Cross-agent AI coding cost dashboard. Track spending across Claude Code, Cursor, Copilot, Codex and other AI coding tools in one place — per-project breakdowns, weekly reports, budget alerts.

## Goals

- One local SQLite database, zero cloud dependency, zero runtime npm dependencies (Node >= 22 `node:sqlite`).
- CLI-first (`act`), plus a lightweight self-hosted web dashboard.
- Cost is derived from tokens via a built-in, overridable price table — or recorded directly as a flat cost (subscriptions, one-off charges).

## Non-goals

- Real-time provider API integrations (no live billing pulls in v0.1).
- Multi-user / team server mode.
- GUI installers.

## Features

- **F1 — init/storage**: `act init` creates `~/.act/db.sqlite` (override with `ACT_DB` env or `--db`). Schema: `entries` (id, ts, agent, model, project, tokens_in, tokens_out, cost_usd, note), `budgets` (scope, limit_usd), `prices` (agent, model, per_mtok_in, per_mtok_out).
- **F2 — record usage**: `act add --agent <name> [--model m] [--project p] [--tokens-in N] [--tokens-out N] [--cost X] [--note "..."] [--date ISO]`. If `--cost` omitted, compute from tokens via price table. Rejects entries with neither tokens nor cost.
- **F3 — price table**: built-in defaults for common agents/models (claude-code, cursor, copilot, codex, gemini, local). `act prices` lists; `act prices set --agent a --model m --in $/Mtok --out $/Mtok` overrides; unknown model falls back to agent default, then to $0 with a warning.
- **F4 — reports**: `act report [--week|--month|--all] [--by agent|project|model] [--format table|json|csv]` — spend grouped by dimension with totals and percentages.
- **F5 — weekly summary**: `act weekly [--week N] [--format md|text]` — markdown/text digest: total, per-agent, per-project, top sessions, week-over-week delta.
- **F6 — budgets & alerts**: `act budget set --weekly 50 [--project p] [--agent a]`, `act budget list`. `act add` checks affected budgets after insert and prints a warning when >=100% (over) or >=80% (near) of the weekly limit. `act report` shows budget status line.
- **F7 — importers**: `act import claude-code [--dir <path>]` parses Claude Code JSONL transcripts (`~/.claude/projects/**/*.jsonl`), extracts per-message token usage + model, maps to entries (deduplicated by transcript message id). Extensible importer interface for future agents.
- **F8 — web dashboard**: `act serve [--port 3737]` — zero-dep HTTP server exposing JSON API (`/api/summary`, `/api/entries`, `/api/budgets`) and a single-page HTML dashboard (spend-by-week chart via inline SVG, per-agent/project breakdown tables, budget status). Read-only.
- **F9 — list/edit**: `act list [--limit N] [--project p] [--agent a]`, `act rm <id>`.
- **F10 — machine output**: every command supports `--format json` for scripting.

## Acceptance criteria

- **AC1**: `act init && act add --agent claude-code --model sonnet --tokens-in 1000000 --tokens-out 500000 --project demo` records an entry with cost computed from the price table (non-zero, correct arithmetic).
- **AC2**: `act report --by agent` and `--by project` show correct grouped totals; JSON/CSV formats parse cleanly.
- **AC3**: `act budget set --weekly 10` then adds totaling >$10 in the current week print an over-budget warning; 80–100% prints near-budget warning.
- **AC4**: `act import claude-code` against a fixture transcript directory imports token usage, is idempotent (re-run adds 0 new entries).
- **AC5**: `act serve` responds 200 on `/` (HTML), `/api/summary` (JSON matching DB totals).
- **AC6**: Full test suite (`npm test`, node:test) green; `tsc --strict` clean; CLI runs via `node dist/cli.js` on a fresh checkout after `npm install && npm run build` with zero runtime deps.
- **AC7**: `act weekly` emits a markdown digest containing total spend, per-agent and per-project sections.

## Tech stack

TypeScript (strict), Node >= 22 (`node:sqlite`, `node:test`, `node:http`), zero runtime dependencies. Compiled with tsc to `dist/`.

## Iteration budget

Max 10 spec→build→verify cycles. Commit after each cycle.
