# Task Plan: Daily Highlight Playlist Review

Date: 2026-06-19

Task breakdown for PRD iteration 4. Ten tasks in execution order.
Manual sync (task-28) is prioritized immediately after enrichment so
operators can backfill fixture data before the automated scheduler is
wired up. Tasks 32-34 are follow-ups raised after the command shipped:
a test-isolation fix, a UI polish pass, and an off-topic guardrail.

## Task Summary

| ID      | Title                              | Criticality | Dependencies |
|---------|------------------------------------|-------------|--------------|
| task-25 | Playlist API Client                | HIGH        | none         |
| task-26 | Video-to-Fixture Matcher           | HIGH        | task-25      |
| task-27 | Fixture Data Enrichment            | MEDIUM      | task-26      |
| task-28 | Manual Sync Command                | LOW         | task-27      |
| task-29 | Daily Highlight Digest (AI + Post) | HIGH        | task-27      |
| task-30 | Daily Scheduler                    | MEDIUM      | task-29      |
| task-31 | `/worldcup2026 highlights` Command | LOW         | task-29      |
| task-32 | Fix flaky enrich/poller test race  | LOW         | task-27      |
| task-33 | Broadcast & command UI polish      | LOW         | task-31      |
| task-34 | Off-topic question handling        | MEDIUM      | task-22      |

## Dependency Chain

```text
task-25 (Playlist API Client)
  -> task-26 (Matcher)
       -> task-27 (Fixture Enrichment)
            -> task-28 (Manual Sync Command)
            -> task-29 (AI Digest)
                 -> task-30 (Scheduler)
                 -> task-31 (Highlights Command)
                      -> task-33 (UI polish)
            -> task-32 (Enrich/poller test race fix)

task-34 (Off-topic handling) refines the task-22 web-search fallback
(ADR-3 -> ADR-5); independent of the highlights chain above.
```

Execution order: task-25 -> 26 -> 27 -> 28 -> 29 -> 30 -> 31 -> 32 -> 33 -> 34

task-28 branches from task-27 (not task-29) because the manual sync command
reuses the adapter + enrichment logic but does not need the scheduler or
digest features. It is executed immediately after task-27 so operators can
backfill highlight URLs into fixtures.json as soon as the core pipeline
(client + adapter + enrichment) is complete.

## Task Details

### task-25: Playlist API Client

Requirements: TR-18, TR-19, TR-25

Build a client module (`src/highlights/client.js`) that fetches playlist items
from the configured playlist API.

- Native fetch with configurable timeout (default 10s)
- API key auth via `HIGHLIGHTS_API_KEY` env var
- Pagination: follow `nextPageToken` until all items retrieved
- Sanitize video titles immediately after fetch (apply `sanitizeInput()` to
  each title before returning) - treats playlist data as untrusted
- Return array of items with: `videoId`, `title`, `publishedAt`, `url`
- Return empty array `[]` if env vars not set (graceful no-op, log warning
  once at module load)
- Never log API key in error messages (sanitize errors)
- Unit tests with mock fetch responses (single page, multi-page, error
  cases, missing env vars returning empty array)

### task-26: Video-to-Fixture Matcher

Requirements: FR-24, TR-20

Build an adapter module (`src/highlights/adapter.js`) that matches playlist
videos to local fixtures by parsing team names from video titles.

- Input: array of video items + array of fixtures (filtered to target date)
- Title parsing: extract matchup portion (before first `|`), split on
  ` v `, ` vs `, ` - `
- Normalization: NFD decomposition + strip combining marks + lowercase
- Match against: `teams.json` full names, team IDs (FIFA codes),
  `countries.json` aliases
- Require BOTH home and away teams present in title
- Skip videos without "Highlight" in title (case-insensitive)
- Tie-breaking: exact name > alias; if video matches multiple fixtures,
  pick fixture with smallest `abs(videoPublishedAt - fixtureKickoff)`;
  if fixture matches multiple videos, prefer title containing "Highlights"
  over "Extended"/"Full Match" (deterministic fallback: lower fixture ID)
- Return array of `{ fixture, videoId, url, title }` matches
- Log unmatched videos for observability
- Unit tests: exact match, alias match, diacritics, multi-fixture day,
  skip non-highlight, tie-breaking scenarios

### task-27: Fixture Data Enrichment

Requirements: FR-25, TR-21

Build an enrichment module (`src/highlights/enrich.js`) that persists
`highlightsURL` into `fixtures.json` for matched fixtures.

- Input: array of matches from task-26 (fixture ID + video URL)
- Read `fixtures.json`, merge `highlightsURL` field (upsert: overwrite if
  exists, add if absent)
- Atomic write: write to temp file with unique name
  (`fixtures.tmp.${process.pid}.json`) in same directory, then rename over
  original. PID-based naming prevents collision between concurrent processes
  (e.g., manual sync + scheduled job)
- Module-level mutex (promise queue) to serialize concurrent writes within
  the same process
- Return count of fixtures updated
- Unit tests: add new field, overwrite existing, empty matches (no write),
  concurrent write serialization (fire 2 enrich calls in parallel, verify
  writes are serial via fs spy)

### task-28: Manual Sync Command

Requirements: FR-28

Add `npm run sync:highlights` script for operator backfill.

- Add to `scripts/sync-data.js` as a new subcommand (`highlights`) or as
  a separate `scripts/sync-highlights.js`
- Fetches full playlist (all pages, no date filter)
- Runs adapter against ALL local fixtures (not just previous day)
- Runs enrichment to persist `highlightsURL` for all matches found
- Reports: total videos, matched, unmatched, fixtures updated
- No digest generation (data enrichment only)
- Add `"sync:highlights"` to `package.json` scripts
- Unit test: verify it runs adapter without date filter

### task-29: Daily Highlight Digest (AI + Post)

Requirements: FR-26, FR-27, TR-23, TR-24, TR-26

Build digest generation and posting (`src/highlights/digest.js`).

- Input: array of matches (fixture + video URL) from adapter
- Build grounding context: for each matched fixture, include team names,
  final score, key events, and highlight URL
- Sanitize video titles via `sanitizeInput()` before MIA context
- Use `ask()` in recap mode with a digest-specific system prompt
- Post digest to broadcast channel as standalone message (not threaded)
- Skip entirely if matches array is empty (FR-27)
- Per-run logging: total fetched, previous-day count, matched, unmatched,
  ratio. Denominator is `previous-day count` (videos published yesterday).
  Warn if `matched / previous-day count < 0.9` (TR-26)
- Log `'Digest skipped: 0 highlights matched for previous day'` when
  matches array is empty (observability for operators)
- Unit tests: digest generation with mock MIA, empty matches (no post,
  skip log emitted), Slack post failure handling, ratio logging/warning

### task-30: Daily Scheduler

Requirements: FR-23, FR-29, TR-22

Build the daily scheduler (`src/highlights/scheduler.js`) that orchestrates
the full daily job.

- setInterval with time-of-day check (configurable via
  `HIGHLIGHTS_RUN_HOUR_IN_UTC`, default 12)
- Persist `lastRunDate` to `src/data/.last-highlights-run` file
- Missed-run logic on startup: read `lastRunDate`. Fire immediately only if
  `currentDate > lastRunDate AND currentHour >= HIGHLIGHTS_RUN_HOUR_IN_UTC`.
  If `currentDate > lastRunDate` but hour is before run time, wait for
  normal tick (don't fire early). If `currentDate === lastRunDate`, already
  ran today, skip.
- Update `lastRunDate` only after successful digest post (or zero highlights
  found for previous day)
- If digest post fails, do NOT update `lastRunDate` (triggers retry next
  tick)
- Full orchestration: fetch playlist -> filter previous day -> match ->
  enrich -> digest -> post
- Wire into `src/index.js` startup (after app.start())
- Graceful no-op if env vars missing (log warning, skip)
- Unit tests: scheduled tick, missed-run detection, retry on failure,
  lastRunDate persistence, env var missing

### task-31: `/worldcup2026 highlights` Command

Requirements: FR-30, FR-31

Add a `highlights` subcommand to `/worldcup2026` that renders recent matched
highlights on demand as rich Block Kit cards. Consolidates the command, its
discovery surfaces, and the latest-N selection behavior (full detail in
`docs/plan-task-31-20260619.md`).

- `src/highlights/query.js`: `getLatestHighlights(limit)` reads `fixtures.json`,
  filters to fixtures with a `highlightsURL` (+ date + teams), sorts newest-first
  by `dateAndTimeInUTC`, slices to the limit, maps to `{ fixture, url, title }`.
  N defaults to 5, overridable via `HIGHLIGHTS_COMMAND_FIXTURES_LIMIT`
  (explicit arg > env var > default); invalid values fall back to 5.
- `src/commands/worldcup.js`: `highlights` case calls `getLatestHighlights()`,
  builds cards via `buildMatchBlocks` under a "Recent Highlights" header,
  responds ephemerally; friendly empty-state message when none.
- Discovery surfaces list `highlights`: `docs/slack-app-manifest.yaml`
  (`description`/`usage_hint`), `DIAGRAMS.md` Slash Commands component, and the
  in-command usage text.
- `.env.example`: document `HIGHLIGHTS_COMMAND_FIXTURES_LIMIT=5`.
- Reuses `buildMatchBlocks` from `src/highlights/digest.js` - single source of
  truth for card layout; no AI generation (instant response).
- Command-only: the daily digest/scheduler (task-29/30) is unaffected.
- Unit tests: `src/test/highlights-query.test.js` (latest-N ordering, env/arg
  override, invalid fallback, exclusions, empty) and `src/test/commands.test.js`
  (block shape, header text, empty state, help-text update).

### task-32: Fix Flaky Enrich/Poller Test Race

Requirements: TR-27

Follow-up fix. The full suite failed intermittently with
`Unexpected end of JSON input` when a parallel worker `require`d
`fixtures.json` while `highlights-enrich.test.js` was mid-write (non-atomic
`writeFileSync` on the committed file).

- `src/highlights/enrich.js`: resolve `FIXTURES_PATH` from
  `HIGHLIGHTS_FIXTURES_PATH` (test-only seam), defaulting to the real file -
  production behavior unchanged
- `src/test/highlights-enrich.test.js`: write to a throwaway `os.tmpdir()`
  copy instead of the committed `fixtures.json`; clean up in `afterAll`
- Not a production bug (runtime writes were already atomic); the flake was the
  test mutating shared source data
- Verify: real `fixtures.json` untouched after a run; full suite run 50x with
  zero failures

### task-33: Broadcast & Command UI Polish

Requirements: FR-32, FR-33, TR-27

Follow-up UI/UX pass across the Slack-facing surfaces (full detail in
`docs/plan-task-33-20260619.md`).

- Fix frozen live card: `formatScorers` (`src/broadcast/format.js`) returned an
  empty string when goals had an unmapped `teamId`, producing an invalid Slack
  context block (`invalid_blocks`) that silently froze `chat.update`. Falls back
  to "No goals yet"; `updateCard` now logs the Slack error code.
- Beautify `schedule`/`groups` (`src/commands/worldcup.js`): flags, emoji
  headers, dividers; groups sorted A->L and rank-sorted with mini standings
  (Pts/GD); team names not bold; UK constituent-country flags (England/Scotland).
- Match time everywhere: new `utcTime()` in `src/utils/format.js`; schedule and
  `buildMatchBlocks` (highlights command + daily digest) show
  `🕒 {localized} · {HH:MM} UTC` via the shared utility.
- Tests: format-util unit tests, scorers edge cases, schedule/groups structure,
  highlight kickoff line.

### task-34: Off-Topic Question Handling (Trust-Layer Grounding Scope)

Requirements: FR-34

Decisions: ADR-5

Follow-up trust-layer guardrail (full detail in
`docs/plan-task-34-20260619.md`), enforced at two layers.

Layer 1 - system prompt (primary boundary):

- `src/mia/personas.js`: add a `SCOPE_INSTRUCTION` folded into every persona and
  `DEFAULT_PROMPT`. Instructs the model to answer only football-related questions
  (focused on World Cup 2026), politely redirect off-topic / general-knowledge
  questions instead of answering, allow only greetings/capability questions, and
  follow prompt-defense rules (don't reveal system prompt/config/functions;
  masked data is real). Adapted from the Agentforce "Off Topic" subagent pattern.

Layer 2 - web-search fallback gate (backstop, LLM OR keyword):

- LLM signal: `src/mia/personas.js` adds `<isFootballRelatedScore>` (0-100) to
  the XML format with `FOOTBALL_RELATED_THRESHOLD = 70`; `parseResponse` in
  `src/mia/index.js` returns `footballRelated` = score >= 70 (or null if absent).
- Keyword signal: `src/mia/ground.js` `isFootballRelated(userText)` - true on
  football vocabulary, team names, or FIFA codes matched as whole words (so
  "USA" in "usagi" or "iran" in "iranian" does not match).
- `src/mia/index.js`: gate the fallback on
  `lowConfidence && (parsed.footballRelated === true || isFootballRelatedKeyword(...))`.
  Off-topic low-confidence questions keep the model's redirect / "I don't have
  enough information" answer; on-topic ones still get the web-search rescue.

Tests: persona prompts contain the scope instruction; `src/test/ground.test.js`
(keyword relevance, whole-word matching); `src/test/mia.test.js` (off-topic
skip by both signals, LLM score rescues a keyword miss, keyword gates when the
tag is absent).

## Execution Notes

- All new code lives in `src/highlights/` (new directory)
- Shared utilities (team name normalization) may be extracted to
  `src/utils/` if reusable
- Tests in `src/test/highlights-*.test.js`
- Env vars added to `.env.example`
- No new npm dependencies
