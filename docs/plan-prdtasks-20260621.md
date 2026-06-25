# Task Plan: Live-Data Reliability and Data-Model Consistency

Date: 2026-06-21

Task breakdown for PRD iteration 5. Three tasks in execution order. task-35
consolidates live-path reliability and hardening into five areas: live data flow
(card source, poller kickoff, daily restart), event quality (dedup on minute
drift, player name resolution), card transitions (kickoff flip, match-end flip),
code organization (sync-data split, utils->lib rename), and process hardening
(restart-hour-zero fix, exception handlers). task-36 prefixes event alerts with
team flags and aligns four internal team ids to FIFA codes. task-37 replaces the
keyword router with model-driven tool calling over local data accessors,
including a derived player-goals tally.

## Task Summary

| ID      | Title                                                      | Criticality | Dependencies |
| ------- | ---------------------------------------------------------- | ----------- | ------------ |
| task-35 | Live-path reliability: card, poller, restart, dedup, names | HIGH        | task-32      |
| task-36 | Event team flags + team-id FIFA-code alignment             | MEDIUM      | task-35      |
| task-37 | MIA tool-calling retrieval (incl. player-goals)            | MEDIUM      | task-35      |

## Dependency Chain

```text
task-32 (frozen-card/scorers groundwork, iteration 4)
  -> task-35 (live-path reliability: card source, kickoff timer, daily restart,
  |           event dedup on minute drift, player-name resolution, kickoff
  |           card transition)
  |    -> task-36 (event team flags + team-id FIFA-code alignment)
  |    -> task-37 (MIA tool-calling retrieval, incl. player-goals)
```

Execution order: task-35 -> 36 -> 37

task-35 depends on task-32 because iteration 4 already hardened
`formatScorers` to never emit an empty Slack block (TR-27); task-35 corrects
the underlying data so that fallback is no longer hit during normal play.
task-35 consolidates seven bug fixes on one live-broadcast path because they were
all discovered in a single match-day run and all touch the same mapper / differ
/ scheduler seam: the live-card data source, the kickoff activation timer, the
daily restart, the minute-independent event dedup key, the canonical
player-name resolution at the mapper seam, the kickoff card transition (a
one-time initial diff from the differ that `handleDiffs` honors), and the
match-end card render (the differ's `matchEnded` flag forwarded through
`updateCard` into `formatLiveCard`). The dedup, name-resolution, and the two
card-render parts were originally separate work but build directly on the same
differ / scheduler / mapper seam the hotfix introduced, so splitting them added
traceability overhead without separable delivery.

task-36 depends on task-35 rather than standing alone: the team-flag prefix is
only meaningful once the mapper resolves `event.teamId` at runtime - before that
fix every event's team was null and the flag helper would produce nothing - and
the team-id FIFA-code alignment is a behavior-preserving primary-key rename on
the same data the hotfix relies on. task-37 depends on task-35 because its
`get_player` and `get_player_goals` tools rely on the now-canonical event names
and the `getAllPlayers()` squad index task-35 Part 5 added; sequencing it after
the reliability work also keeps the grounding refactor off the live broadcast
path until those fixes are settled. task-37 also includes the derived
player-goals tally: it is the only tool needing new cross-fixture logic rather
than a thin accessor wrapper, so it carries its own counting-rule decisions and
tests within the same task.

## Task Details

### task-35: Live-path reliability (card, kickoff, restart, dedup, names, transition)

Requirements: TR-27, TR-28, TR-31, TR-32, TR-34

Consolidated reliability and hardening work in five areas (full detail in
`docs/plan-task-35-20260621.md`): live data flow, event quality, card
transitions, code organization, and process hardening.

Part 1 - Live card shows "No goals yet" even after goals scored:

- Root cause: the running worker never seeded the mapper's
  `externalTeamIdToTeamId` map (only the offline `scripts/sync-data.js` did),
  so every live `event.teamId` resolved to null. `formatScorers` matched no
  goal to either side and fell back to "No goals yet" for the whole match.
- Fix: seed `externalTeamIdToTeamId` from `teams.json` at module load in
  `src/live-data/mapper.js`, mirroring how the mapper already seeds
  `externalFixtureIdToInternalId`. `registerTeamMapping` stays exported for
  `sync-data.js`. `updateCard` and `postEventAlert` read the merged fixture
  from `getFixtureById` (Tier-1 cache merge already includes `events`).
- Tests: `src/test/live-data-mapper.test.js` updated so the mapped event
  asserts the resolved team (ext id 16 -> `MEX`) instead of codifying the
  null-team bug.

Part 2 - Poller delayed 10-14 minutes after kickoff:

- Root cause: while passive (15-min interval) the poller only switched to
  active (15s) on the next passive tick that detected a live match, leaving a
  blind window at kickoff.
- Fix: add `scheduleKickoffActivation()` in `src/live-data/poller.js` - on each
  passive tick with no live matches, schedule a one-shot `setTimeout` for the
  exact next kickoff; on fire, switch to active. Rescheduled in
  `switchToPassiveMode`, cleared in `switchToActiveMode` and `stop`.

Part 3 - Scheduled daily restart to prevent duplicate posts:

- Problem: Heroku cycles dynos every ~24h at an unpredictable hour; a restart
  in a pre-match window or just after full time re-posts a card or recap
  because `posted` / `finishedIds` dedup sets are in memory.
- Fix: new `src/utils/restart-scheduler.js` schedules an in-process
  `process.exit(0)` at `DAILY_RESTART_HOUR_IN_UTC` (default 11), inside the
  verified 05:00-11:00 UTC no-match window, so Heroku's auto-restart lands
  safely. Timer uses `.unref()`. Wired into `src/index.js`; documented in
  `.env.example` and `README.md`.

Part 4 - Duplicate event alerts caused by API minute drift:

- Problem: the same threaded event alert was posted more than once, each copy
  showing a slightly different minute (observed: a substitution at 75' reposted
  at 76', and others at 71'->70', 84'->83'). The football API revises an
  event's `time.elapsed` between polls.
- Root cause: the differ's dedup key in `src/live-data/differ.js` was
  `${type}-${minute}-${player}`; when the minute drifted the key changed and an
  already-broadcast event looked brand-new.
- Fix: rewrite `eventKey` to a per-type stable key - substitutions key on the
  `(player off, player on)` pair, cards on `detail + player`, and goals/VAR
  keep the minute so a genuine brace stays two distinct alerts. Contained to
  `eventKey`; `diffAll`, the poller, and the scheduler are unchanged. Residual
  risk (accepted, documented in code): a goal whose minute drifts can still
  re-post, traded off to preserve brace detection.
- Tests: `src/test/live-data-differ.test.js` adds a `minute drift (duplicate
  suppression)` block.

Part 5 - Event player names not resolved to the canonical squad name:

- Problem: the football API labels the same player inconsistently between
  events (Haiti player externalId 20850 appeared as "Carlens Arcus" on a card
  at 4' and "C. Arcus" on a sub at 46' in the same match). The drift runs both
  ways - sometimes a full name where the squad uses an abbreviation, sometimes
  the reverse, sometimes an accented vs ASCII spelling.
- Root cause: `mapEvent` in `src/live-data/mapper.js` stored `event.player.name`
  verbatim and never consulted the squad files, which already hold one canonical
  name per player keyed by `externalId`.
- Fix: seed an `externalId -> name` map at module load from `getAllPlayers()`
  (new accessor in `src/data/index.js` that flattens every squad file) and
  resolve both `playerName` and `assistPlayerName` through it; fall back to the
  raw API name when an id is absent from every squad. The resolver is exported
  as `resolvePlayerName` so the backfill reuses it. Covers both live polling and
  offline sync because both route through `mapEvent`.
- Backfill: `scripts/sync-player-names.js` re-resolves `playerName` /
  `assistPlayerName` in the already-synced fixture detail files using the same
  resolver; idempotent, supports `--dry-run`. 35 of 36 files, 280 name fields
  corrected at consolidation; the same idempotent script covers later fixtures.
- Tests: `src/test/live-data-mapper.test.js` adds three cases - resolves the
  player name by externalId, resolves the assist name, and falls back to the API
  name for an id not in any squad.

Part 6 - Live card stays on the pre-match layout after kickoff:

- Problem: the match card stayed on its pre-match "Fixture Starting Soon!"
  layout after kickoff and only switched to the live score card when the differ
  detected the first score/elapsed change. For a 0-0 match the card looked
  frozen for minutes, and because the first goal changes the score it appeared
  to update only "when the first event comes through".
- Root cause: on first observation of a fixture the differ's restart guard
  (`src/live-data/differ.js`) seeds dedup state and `continue`s without emitting
  a diff, and `handleDiffs` (`src/broadcast/scheduler.js`) only calls
  `updateCard` - the sole pre-match-to-live card rewrite - when
  `scoreChanged || elapsedChanged`. So the poll that means "this match is now
  live" produces no card transition.
- Fix: on first observation, keep seeding dedup state and keep `newEvents` empty
  (so a worker restart does not re-broadcast historical events), but emit a
  one-time initial diff carrying an `initial: true` marker with both change flags
  false. `handleDiffs` calls `updateCard` when `diff.initial` in addition to the
  existing score/elapsed triggers. `updateCard`'s existing no-op when no message
  timestamp is tracked keeps a mid-match restart (lost in-memory ts) from posting
  a spurious card; the `postEventAlert` first-event fallback still covers a worker
  that starts after kickoff with no pre-match card. The initial-diff change does
  not touch the match-end diff; Part 7 separately covers the match-end card
  render.
- Tests: `src/test/live-data-differ.test.js` - the three first-observation
  assertions that expected `[]` become assertions of the initial-diff shape
  (`initial: true`, `newEvents: []`, both change flags false), plus an "emitted
  exactly once" case. `src/test/broadcast-live.test.js` - a new `handleDiffs`
  case asserting an `initial: true` diff calls `client.chat.update` once and
  posts nothing to the thread.

Part 7 - Match-end card did not flip to the finished render when the feed lagged:

- Problem: at full time the recap posted but the card beside it could keep a
  green "live" header and a stale minute, because the feed can stop returning a
  fixture without ever emitting a terminal "Match Finished" status, freezing the
  cached status on its last live value.
- Root cause: the differ already emits a match-end diff carrying `matchEnded:
  true` (the flag that fires the recap), but `formatLiveCard` decided
  finished-vs-live purely from the cached `fixture.status` string, so the
  authoritative signal never reached the renderer.
- Fix: thread `matchEnded` from `handleDiffs` (added to the card-update guard)
  through `updateCard` into `formatLiveCard`, where `isFinished` is now the flag
  OR the cached-status check. The `matchEnded = false` default keeps every in-play
  caller on the unchanged status-string behavior; only the match-end diff passes
  `true`. No events re-post (match-end `newEvents` is empty) and the recap branch
  is unchanged.
- Tests: `src/test/broadcast-format.test.js` - a `matchEnded: true` render forces
  the finished card even when `fixture.status` still reads "Second Half".
  `src/test/broadcast-live.test.js` - a `matchEnded` diff triggers `updateCard`
  once and re-posts no events.

Verification: full suite green. `scheduler.js`, `format.js`,
`poller.js`, `differ.js`, `mapper.js`, `data/index.js`, and the backfill script
lint clean; restart scheduler logs the scheduled time and exposes `cancel()`;
`sync-player-names.js --dry-run` reports 0 changes after the backfill
(idempotent); player 20850 reads "C. Arcus" at both events in `31-BRA-HAI.json`;
Part 6 trace flips the pre-match card to the live card on the first active poll;
Part 7 renders the finished card from the `matchEnded` flag despite a lagging
status.

### task-36: Event team flags + team-id FIFA-code alignment

Requirements: TR-29, TR-30

Polish and data-model consistency, in two parts (full detail in
`docs/plan-task-36-20260621.md`).

Part 1 - Event alerts do not show which team the event belongs to:

- Problem: threaded card/sub/missed-penalty alerts named only the player and
  minute, so a neutral viewer could not tell which side an event belonged to.
- Fix: add `teamFlagPrefix(event)` in `src/broadcast/format.js` returning the
  team flag plus a space when `event.teamId` resolves, and an empty string
  otherwise (no white-flag fallback leak). Applied to goal, card,
  missed-penalty, and sub alerts. `formatVarAlert` left unchanged (VAR is not
  attributed to a single team).
- Tests: `src/test/broadcast-format.test.js` adds `teamId` to event fixtures,
  asserts the flag appears, and adds a regression test that no white flag leaks
  when `event.teamId` is null.

Part 2 - Internal team ids did not match official FIFA codes:

- Problem: four teams had an internal `id` differing from `fifaCode`
  (BOS/BIH, CAP/CPV, CON/COD, CUR/CUW). Since `id` is the primary key (used as
  `homeTeamId`/`awayTeamId`, `players/{id}.json`, `{id}-{home}-{away}.json`),
  the key and canonical code diverged for a subset of teams.
- Fix: rename so `id === fifaCode` for all 48 teams. Touches content in
  `teams.json`, `countries.json`, `fixtures.json`, and sample/test JSON, plus
  `git mv` of 4 player-squad files and 5 fixture-detail files. Flag rendering
  is unchanged (keys off `flagISO`, not the team id).
- Safety: old codes grepped with word boundaries across the repo - they
  appeared only as quoted JSON tokens and player-id prefixes (no English-word
  substrings, no source-logic occurrences); target codes do not collide with
  existing ids.

Verification: full suite passing; format/test lint clean; all 48 teams have
`id === fifaCode`; zero orphan fixture team ids; squads and fixtures resolve
for the renamed ids; Ecuador vs Curacao yellow-card scenario rendered the
expected flags end-to-end through the real mapper.

### task-37: MIA tool-calling retrieval (incl. player-goals)

Requirements: TR-33

Grounding improvement on the MIA path (full detail in
`docs/plan-task-37-20260621.md`). Proposes ADR-6 (MIA client-side tool calling);
ADR-5 is already used for trust-layer topic grounding.

- Problem: the retrieval path is a hand-coded keyword router with three regex branches.
  "when is the next england match" injected the global next-3 fixtures rather
  than England's; past-result and scorer questions matched no branch; and a
  player named without their team was invisible (it only recognizes teams). The
  empty or wrong context drove low confidence and a web search for questions the
  app could answer from local data.
- Approach: add a tool-calling loop to `ask()`. Expose a whitelist of seven
  read-only tools over the existing accessors - `get_upcoming_fixtures`
  (optional team filter), `get_team_results`, `get_fixture_events`,
  `get_standings`, `get_team_squad`, `get_player`, and `get_player_goals` - and
  let the model choose which to call. A new capability is then one tool schema,
  not another regex branch. Six are thin accessor wrappers; `get_player_goals`
  is the one tool with new cross-fixture logic (it tallies `Goal` events by
  `externalId`), so it carries its own counting-rule decisions and tests within
  this task.
- Client change: `src/mia/client.js` gains `chatWithTools()` returning the full
  assistant message (with `tool_calls`); `chat()` keeps returning `content` so
  recap and other callers are unaffected (the current client drops
  `message.tool_calls`).
- Loop: execute requested tools via a whitelist `dispatchTool` (rejects unknown
  names, never evaluates input), feed `role: tool` results back, bounded by a
  maximum iteration count and a total wall-clock budget, and parse the final
  answer with the unchanged XML contract. PII masking, sanitize, toxic
  filtering, and the web-search fallback are all unchanged.
- Telemetry: `logInteraction` records the retrieval path (`tool_call`, `context`,
  `direct`, or `web_search`) so the web-search fallback rate is observable and
  SC-8 is measurable.
- Gating: the tool loop is the unconditional primary retriever, gated only by a
  one-shot capability probe (DONE, 2026-06-21; `claude-4-5-haiku` returns
  `tool_calls`). A direct single model call (no tool context) is the
  deterministic fallback when the model is unsupported, emits no tool call,
  exhausts the loop, or exceeds the wall-clock budget.
- Player-goals tool: `get_player_goals(name)` resolves a player and tallies
  `Goal` events by `externalId` across fixtures, returning
  `{ name, team, teamId, goals, penalties, fixtures }`. Counting rules: allowlist
  on `detail` (only `Normal Goal` and `Penalty` count, penalties reported as a
  subset); own goals and missed penalties excluded; VAR-reversed goals need no
  special handling because the feed is already post-reconciliation; both finished
  and in-progress fixtures are counted via the live-cache-merged status. An
  unrecognized name returns `null`; a recognized goalless player returns a
  structured zero, not an error.
- Tests: new `src/test/mia-tools.test.js` (schema validity, `dispatchTool`
  routing and unknown-name rejection, `resolveTeam`/`resolvePlayer`, defensive
  arg parsing, and the player-goals counting rules - own-goal exclusion,
  missed-penalty exclusion via injected data, live-match inclusion, penalties as
  a subset, zero-not-error for a goalless player, null for an unknown name) plus
  `src/test/mia.test.js` integration cases driving a `tool_calls` response
  through execution to a final answer, asserting the gap queries now answer from
  local data (including "how many goals has Messi scored" via `get_player_goals`),
  empty-tool-result graceful degradation (`get_team_results` -> `[]`, `get_player`
  -> null), the `retrievalPath` telemetry value per path, and the direct-call
  fallback path producing an answer when the tool loop grounds nothing.

Verification: new and existing MIA suites passing (catalog tests assert 7 tools);
`client.js`, `tools.js`, `index.js`, `audit.js`, and the new tests lint clean;
the context, tool_call, direct, and web_search paths each covered; capability
probe confirmed tool-call support; ADR-6 recorded.

## Execution Notes

- task-35 touches `src/live-data/mapper.js` (team-id seeding + name resolution),
  `src/live-data/poller.js`, `src/broadcast/scheduler.js` (merged-fixture card
  source + `handleDiffs` honoring `diff.initial` and `diff.matchEnded`,
  forwarding the flag to `updateCard`),
  `src/broadcast/format.js` (Part 7: `formatLiveCard` honors the `matchEnded`
  flag over the cached status), `src/live-data/differ.js` (minute-independent
  dedup key + the kickoff initial diff), `src/data/index.js` (new
  `getAllPlayers()`), new `src/utils/restart-scheduler.js`, new
  `scripts/sync-player-names.js`, `src/index.js`, `.env.example`, `README.md`,
  the per-fixture detail files under `src/data/fixtures/` (names-only backfill),
  and tests under `src/test/` (`live-data-mapper.test.js`,
  `live-data-differ.test.js`, `broadcast-live.test.js`, `broadcast-format.test.js`)
- task-36 touches `src/broadcast/format.js` (a different seam from task-35 Part 7:
  the `teamFlagPrefix` on event alerts), the data JSON files, and renamed
  player/fixture files; tests under `src/test/`
- task-37 touches `src/mia/client.js`, `src/mia/index.js`, `src/mia/personas.js`,
  `src/mia/audit.js` (retrieval-path field), new `src/mia/tools.js` (seven tools,
  including the derived `get_player_goals`), `.env.example`, new
  `docs/adr-6-*.md`, new `src/test/mia-tools.test.js`, and `src/test/mia.test.js`;
  the fallback is a direct single model call
- task-37 is gated on a one-shot probe confirming the configured inference model
  supports function calling; when the loop grounds nothing a direct single model
  call answers, so an unsupported model still works
- No new npm dependencies (native timers, fs, existing data files)
- Two pre-existing eslint errors in `src/test/broadcast-recap.test.js`
  (unused `getTeamName`, `buildRecapBlocks`) exist on clean HEAD and are
  unrelated to these tasks; left untouched
