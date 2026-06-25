# Task Breakdown Plan: Iteration 3

Date: 2026-06-17

PRD: docs/prd-20260617.md

## Overview

9 tasks total (continuing from iteration 2's task-15). Bugs first, then new
features. Strictly sequential execution - no parallel tracks.

## Task Summary

### Bug Fixes (task-16, task-17)

| ID      | Title                      | Criticality | Status | Requirements | Dependencies |
|---------|----------------------------|-------------|--------|--------------|--------------|
| task-16 | Incomplete Event Filtering | HIGH        | TO_DO  | FR-16, TR-13 | none         |
| task-17 | Live Card Elapsed Refresh  | HIGH        | TO_DO  | FR-19, TR-15 | task-16      |

### New Features (task-18 through task-24)

| ID      | Title                              | Criticality | Status | Requirements        | Dependencies |
|---------|------------------------------------|-------------|--------|---------------------|--------------|
| task-18 | Broadcast Card Redesign            | HIGH        | TO_DO  | FR-17, FR-18, TR-14 | task-17      |
| task-19 | Match-End Detection and Final Card | HIGH        | TO_DO  | FR-20, TR-16        | task-18      |
| task-20 | Per-Thread Match Personas          | MEDIUM      | TO_DO  | FR-14, FR-15, TR-12 | task-19      |
| task-21 | Web Search Client and Guardrails   | HIGH        | TO_DO  | FR-13, TR-9, TR-10  | task-20      |
| task-22 | Post-LLM Fallback Integration      | HIGH        | TO_DO  | FR-11, TR-11, TR-17 | task-21      |
| task-23 | Source Citation in AI Responses    | MEDIUM      | TO_DO  | FR-12               | task-22      |
| task-24 | Post-Match AI Summary              | MEDIUM      | TO_DO  | FR-21, FR-22, TR-17 | task-23      |

## Execution Order

```text
task-16 -> 17 -> 18 -> 19 -> 20 -> 21 -> 22 -> 23 -> 24
```

## Task Descriptions

### task-16: Incomplete Event Filtering

Add a guard in the scheduler's `postEventAlert` function that checks
`playerName` before broadcasting. If playerName is null, undefined, empty
string, or "unknown" (case-insensitive comparison), log the event to console
and return early without posting to Slack. Exception: Var events bypass this
check entirely (VAR decisions use `event.detail`, not player identity).

Files: `src/broadcast/scheduler.js`
Tests: `src/test/broadcast.test.js` or new `src/test/event-filter.test.js`

### task-17: Live Card Elapsed Refresh

Modify the poller-to-scheduler pipeline so the card updates on every poll cycle,
not just when `scoreChanged` is true. Currently `handleDiffs` only calls
`updateCard` when score changes. Add an `elapsedChanged` or unconditional
refresh trigger so the header minute ticks up every ~15 seconds during live
matches.

Files: `src/live-data/differ.js`, `src/broadcast/scheduler.js`
Tests: `src/test/broadcast.test.js`, `src/test/live-data-differ.test.js`

### task-18: Broadcast Card Redesign

Replace `formatLiveCard` with the new 3-block layout:

- Header block: status indicator (green/red circle) + full status text (no
  abbreviations) + elapsed minute
- Section block: flag emoji + team name + score + team name + flag emoji
- Context block: scorers line with flag per scorer, grouped by team (home left
  of middle dot, away right), with minutes

Requires adding flag emoji data to teams.json (or a lookup map). Update
`buildFixtureCard` (pre-match card) to use the same section/context pattern for
visual consistency.

Files: `src/broadcast/format.js`, `src/data/teams.json` (add flag field)
Tests: `src/test/broadcast-format.test.js`

### task-19: Match-End Detection and Final Card

Track previously-seen live fixture IDs in the poller. When a fixture disappears
from the live response (status transition to finished), fetch its final state
and call `updateCard` with the red indicator + "Match Finished" status + final
score + complete scorer list. Fallback: passive-mode date check also detects
recently-finished matches.

Files: `src/live-data/poller.js`, `src/broadcast/scheduler.js`,
`src/broadcast/format.js`
Tests: `src/test/live-data-poller.test.js`, `src/test/broadcast.test.js`

### task-20: Per-Thread Match Personas

Define three persona system prompt templates (sporty, funny, serious) in a new
module. When posting a broadcast card, assign a random persona and store it in
Slack message metadata (`event_payload: { matchId, persona }`). In the chat
handler, read the persona from thread parent metadata (same fetch that reads
matchId) and pass it to the `ask()` function to select the corresponding system
prompt tone.

Files: `src/mia/personas.js` (new), `src/mia/index.js`,
`src/broadcast/scheduler.js`, `src/handlers/chat.js`
Tests: `src/test/mia.test.js`, `src/test/chat.test.js`

### task-21: Web Search Client and Guardrails

Create a web search API client (`src/search/client.js`) using native fetch with
configurable timeout. Design as a provider-agnostic interface (the underlying
provider is swappable without changing the rest of the pipeline). Sanitize the search
query before sending (strip PII tokens, injection markers). Sanitize returned
results (treat as untrusted data - strip injection patterns, delimit clearly).
Add rate limiting (configurable max calls/minute, default 10). Never log API key
in errors.

Files: `src/search/client.js` (new), `src/search/sanitize.js` (new)
Tests: `src/test/web-search.test.js` (new)
Env: `WEB_SEARCH_API_KEY` added to required vars

### task-22: Post-LLM Fallback Integration

Wire the web search client into the MIA pipeline. After the first MIA call, check
the response for "I don't know" patterns (configurable list). If detected, call
the web search client with the sanitized user query, sanitize results, and call
MIA again with both local and web context. All existing guardrails (PII masking, toxicity
filtering, audit) apply to the second call. Log both attempts in audit trail.

Files: `src/mia/index.js`, `src/mia/fallback.js` (new)
Tests: `src/test/mia.test.js`

### task-23: Source Citation in AI Responses

When the fallback path fires and web results are used, append source citations
to the system prompt instructions telling MIA to cite sources. Format: "According
to [source name]..." with URL available. The citation instruction is only added
when web context is present (not on local-only responses).

Files: `src/mia/index.js` or `src/mia/fallback.js`
Tests: `src/test/mia.test.js`

### task-24: Post-Match AI Summary

After the match-end final card is posted (task-19), trigger an AI recap
generation. Build context from the full match event data (all goals, cards,
subs, statistics). Call MIA with a recap-specific system prompt that includes
the thread's persona tone (if set). Post the generated summary as a threaded
reply to the match card. Handle MIA timeout/failure gracefully (log error,
don't crash).

Files: `src/broadcast/scheduler.js`, `src/mia/recap.js` (new)
Tests: `src/test/broadcast.test.js`, `src/test/mia.test.js`
