# agent-cost-tracker (`act`)

Cross-agent AI coding cost dashboard — track spending across Claude Code, Cursor, Copilot, Codex, Gemini and more in one place, with per-project breakdowns, weekly reports, and budget alerts.

One local SQLite file. Zero runtime dependencies (Node ≥ 22 built-ins only). CLI-first, plus a self-hosted read-only web dashboard.

```
$ act add --agent claude-code --model claude-sonnet-4-5 --project api --tokens-in 1000000 --tokens-out 500000
recorded #1: claude-code/claude-sonnet-4-5 @api — $10.50

$ act report --by project
Spend report — range: week (2026-09-28 → 2026-10-05), grouped by project
project  entries  tokens_in  tokens_out  cost    share
-------  -------  ---------  ----------  ------  -----
api      1        1000000    500000      $10.50  100%
TOTAL: $10.50 across 1 entries

$ act budget set --weekly 50
budget set [global]: $50.00/week

$ act add --agent codex --project api --cost 45
recorded #2: codex @api — $45.00
⚠ budget nearly reached [global] 2026-W40: $55.50 of $50.00 (>=80%)
```

## Install

```sh
git clone https://github.com/fuleinist/agent-cost-tracker
cd agent-cost-tracker
npm install && npm run build
npm link            # or: node dist/cli.js ...
```

Requires Node ≥ 22 (`node:sqlite`, `node:test`, `node:http` — no native modules, no packages at runtime).

## Commands

| Command | What it does |
| --- | --- |
| `act init` | Create/verify the database (`~/.act/db.sqlite`, or `$ACT_DB` / `--db`) |
| `act add` | Record usage: `--agent --model --project --tokens-in --tokens-out`, or a flat `--cost` (subscriptions). Cost is computed from the price table when omitted. `--date`, `--note`. |
| `act list` / `act rm <id>` | Inspect / delete entries |
| `act report` | Spend grouped `--by agent\|project\|model` over `--week` (default), `--month`, `--all` |
| `act weekly` | Markdown/text/JSON digest: total, per-agent, per-project, top entries, week-over-week delta |
| `act budget set/list` | Weekly limits, globally or per `--project` / `--agent`. Warns at ≥80% and ≥100% whenever you add or import. |
| `act prices` | List built-in + custom prices; `act prices set --agent a --model m --in X --out Y` ($ per Mtok) |
| `act import claude-code` | Parse Claude Code transcripts (`~/.claude/projects/**/*.jsonl`), extract per-message token usage, idempotent via dedupe keys. `--dir`, `--dry-run`. |
| `act serve` | Local dashboard at http://localhost:3737 — 12-week spend chart, per-agent/project tables, budget status. Read-only JSON API at `/api/summary`, `/api/entries`, `/api/budgets`. |

Every data command supports `--format table|json|csv` (weekly: `md|text|json`) for scripting.

## Pricing

Built-in table (per 1M tokens, USD) covers `claude-code` (opus/sonnet/haiku/fable), `cursor`, `copilot`, `codex`, `gemini`, `local`. Model names are matched by substring, so `claude-sonnet-4-5` resolves to the `sonnet` tier. Unknown agents record $0 with a warning; set your own with `act prices set`. DB overrides always beat built-ins.

Subscription tools (Copilot, Cursor Pro, Claude Pro) have no marginal token price — record the flat charge: `act add --agent copilot --cost 10 --note "monthly sub"`.

### Import accuracy note

The Claude Code importer counts `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` as input at the model's full rate. Cached reads are actually billed at a discount, so imported costs are an **upper-bound approximation**. Flat `--cost` entries are exact.

## Tests

```sh
npm test   # builds, then runs 11 end-to-end CLI tests (node:test)
```

## Status

v0.1.0 — spec in [SPEC.md](SPEC.md), all acceptance criteria AC1–AC7 verified by the test suite. Ideas/welcome: importers for Cursor/Codex session logs, provider billing API pulls, multi-currency.

MIT licensed.
