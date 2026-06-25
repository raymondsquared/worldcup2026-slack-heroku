# Task Plan: Live Data, Thread-Aware Mentions, and Real Squads

Date: 2026-06-16

## Objective

Break down the approved PRD (docs/prd-20260616.md) into specific, actionable implementation
tasks ordered by dependencies and criticality.

## Approach

The tasks follow a layered approach building on the existing codebase. Tasks 1-8 (iteration 1)
are documented in docs/prd-20260613.md and are complete.

Layers:

1. API Client - football API HTTP client with auth, error handling, and key security
   (both the sync script and the poller depend on this)
2. Data Foundation - real team/player data via sync script, schema migration to add
   `externalId` field, and tiered data resolution in `src/data/index.js`
3. Live Data Poller - lifecycle management, in-memory cache, event diffing, graceful degradation
4. Broadcast Enhancements - manifest update for metadata, message metadata on cards, card
   updates with live scores, event alerts to threads, Slack rate-limiting priority
5. Thread-Grounded AI - context detection via metadata, match-specific grounding
6. Schedule Command Update - show live scores in `/worldcup2026 schedule`

## Task Summary

6 tasks total:

- 2 CRITICAL (API client and live data poller - all live features depend on them)
- 3 HIGH (real data, broadcast enhancements, thread-grounded AI)
- 1 MEDIUM (schedule command update - incremental improvement)

## Dependency Chain

```text
task-9 (football API client) DONE [src/live-data/api.js]
  └─> task-10 (real data + sync script) DONE [scripts/sync-data.js + src/data/ + src/live-data/mapper.js]
        └─> task-11 (live data poller + cache) [src/live-data/poller.js, cache.js, differ.js]
              └─> task-12 (broadcast enhancements) [src/broadcast/scheduler.js enhancements]
                    └─> task-13 (thread-grounded AI) [src/handlers/chat.js + metadata]
                          └─> task-14 (schedule command update) [src/commands/worldcup.js]
                                └─> task-15 (architecture diagram update) [DIAGRAMS.md]
```

Execution order: ~~task-9 -> task-10~~ (done) -> task-11 -> task-12 -> task-13 -> task-14 -> task-15

## Requirements-to-Task Mapping

| Requirement                                          | Task                                                 |
|------------------------------------------------------|------------------------------------------------------|
| FR-1 (poll /fixtures?live=all every 15s)             | task-11 (uses api.js fetchLiveFixtures)              |
| FR-2 (goal alerts to threads)                        | task-12                                              |
| FR-3 (card/sub event alerts)                         | task-12                                              |
| FR-4 (edit broadcast cards with score)               | task-12                                              |
| FR-5 (attach matchId metadata to cards)              | task-12 (sub-deliverable 1, blocker for task-13)     |
| FR-6 (read metadata in thread, ground on match)      | task-13                                              |
| FR-7 (general mentions/DMs unchanged)                | task-13                                              |
| FR-8 (schedule shows live scores)                    | task-14                                              |
| FR-9 (npm run sync script)                           | task-10                                              |
| FR-10 (function with cached data on failure)         | task-11 (cache fallback), task-12 (stale indication) |
| TR-1 (native fetch, no new deps)                     | task-9 DONE (src/live-data/api.js)                   |
| TR-2 (externalId in fixtures.json)                   | task-10 DONE (all fixtures have externalId)          |
| TR-3 (fixtures/{id}-{home}-{away}.json via sync)     | task-10 DONE                                         |
| TR-4 (exponential backoff, stale marking)            | task-11                                              |
| TR-5 (never log API keys in errors)                  | task-9 DONE (sanitizeError in src/live-data/api.js)  |
| TR-6 (poller lifecycle: 15min check, 15s aggressive) | task-11                                              |
| TR-7 (Slack rate-limit priority + 30s drop)          | task-12                                              |
| TR-8 (existing guardrails maintained)                | task-13                                              |
| Constraint: manifest metadata.event_type             | task-12 (sub-deliverable 1)                          |

## Task Descriptions with Sub-Deliverables

### task-9: Football API Client (CRITICAL) - DONE

HTTP client for the football API integration.

Implementation (actual):

1. `src/live-data/api.js` - fetch wrapper with `x-apisports-key` auth header, 10s timeout
2. `sanitizeError()` - never logs API key in error output (TR-5)
3. Endpoint helpers: `fetchLiveFixtures()`, `fetchFixturesByDate()`, `fetchFixtureById()`,
   `fetchSquad()`, `fetchStandings()`
4. Tests in `src/test/scores-api.test.js` with mock responses

### task-10: Real Data and Sync Script (HIGH) - DONE

Replace mock data with real World Cup 2026 data.

Implementation (actual):

1. `src/data/fixtures.json` - 72 fixtures with: id, dateAndTimeInUTC, stage, group,
   externalId, status, teams (homeTeamId, homeTeamExternalId, awayTeamId, awayTeamExternalId),
   finalScore, score (halftime/fulltime/extratime/penalty)
2. `scripts/sync-data.js` - subcommands: teams, fixtures, players, fixture-events, all
   - `sync:teams` - fetches standings (league=1, season=2026), rebuilds teams.json
   - `sync:fixtures` - fetches all fixtures by date range, rebuilds fixtures.json from scratch
   - `sync:players` - fetches squads per team, writes players/{teamId}.json
   - `sync:fixture-events` - two-step: fetch by date to discover finished fixtures (API source
     of truth for status), then fetch each individually via `/fixtures?id=` for events/statistics;
     writes `fixtures/{id}-{homeTeamId}-{awayTeamId}.json`
   - Single fixture mode: `npm run sync:fixture-events -- 1`
3. `src/data/index.js` - tiered query resolution per ADR-2:
   - `getFixtureById(id)`: live cache -> detail file -> static schedule
   - `getFixtureEvents(id)`: live cache -> detail file -> empty array
   - `getLiveScore(id)`: live cache -> detail file -> static schedule -> null
   - `loadFixtureDetail(id)`: constructs filename `{id}-{homeTeamId}-{awayTeamId}.json`
4. `src/live-data/mapper.js` - reshapes API responses (no value transformation):
   - `mapFixtureWithEvents()` - maps fixture with events + statistics (no lineups)
   - `registerTeamMapping()` - registers API team ID -> internal team ID
   - Events include: type, minute, extraMinute, teamId, teamExternalId, playerExternalId,
     playerName, assistPlayerExternalId, assistPlayerName, detail, comments
   - Statistics stored as raw API format per team
5. `src/data/teams.json` - 48 teams (id, name, group, rank, points, goalsDiff, externalId)
6. `src/data/players/{teamId}.json` - per-team squads (id, name, teamId, position, number,
   externalId); position stored raw from API (e.g. "Goalkeeper", "Attacker")

### task-11: Live Data Poller and Cache (CRITICAL)

Live match polling with in-memory cache and event diffing.

Sub-deliverables:

1. `src/live-data/poller.js` - lifecycle: check fixtures every 15 min, switch to 15s when
   live matches detected, stop when none remain (TR-6)
2. `src/live-data/cache.js` - in-memory store keyed by fixtureId, exposes `getFixture(id)`
   (returns { status, finalScore, score, events, statistics }), `isStale()` flag;
   integrates with `src/data/index.js` via `setLiveCache(cache)`
3. `src/live-data/differ.js` - compare events between polls, emit new events only
4. Exponential backoff on failure (15s -> 30s -> 60s -> 120s max), mark stale after 5
   consecutive failures (TR-4)
5. Graceful degradation - serve stale cached data with staleness indicator (FR-10)

Note: API client already exists at `src/live-data/api.js` with `fetchLiveFixtures()`.
Mapper already exists at `src/live-data/mapper.js` with `mapFixtureWithEvents()`.

### task-12: Broadcast Enhancements (HIGH)

Live score updates to broadcast cards and event alerts to threads.
Builds on existing `src/broadcast/scheduler.js` which already posts pre-match cards.

Sub-deliverables:

1. Update Slack app manifest - register `metadata.event_type: worldcup_match` (BLOCKER
   for task-13)
2. Attach message metadata (`{ matchId }`) when posting broadcast cards in
   `src/broadcast/scheduler.js` (FR-5) - currently posts via `client.chat.postMessage`
3. Edit broadcast cards with current score when score changes (FR-4) - use `chat.update()`
   with stored `{matchId -> messageTs}` map
4. Post goal/card/sub event alerts to match threads (FR-2, FR-3) - event data shape from
   mapper: { type, minute, extraMinute, teamId, teamExternalId, playerExternalId,
   playerName, assistPlayerExternalId, assistPlayerName, detail, comments }
5. Slack rate-limiting priority logic: user responses > broadcast updates > event posts;
   drop event posts older than 30 seconds (TR-7)

### task-13: Thread-Grounded AI (HIGH)

Context-aware AI responses in broadcast threads.
Builds on existing `src/handlers/chat.js` which already handles @mentions and DMs
via `src/mia/index.js` (`ask()` pipeline).

Sub-deliverables:

1. Detect broadcast thread - read parent message metadata to identify matchId (FR-6)
2. Build match context string from live cache/detail files - use `getFixtureById(id)`,
   `getFixtureEvents(id)`, `getLiveScore(id)` from `src/data/index.js` (score, events,
   statistics - no lineups)
3. Pass context to existing `ask(text, context)` in `src/mia/index.js` - no signature
   changes needed
4. Ensure existing guardrails (masking, toxicity, audit) remain active (TR-8)
5. Non-broadcast @mentions and DMs continue working unchanged (FR-7)

### task-14: Schedule Command Update (MEDIUM)

Show live scores alongside upcoming matches.
Modifies existing `src/commands/worldcup.js` `scheduleBlocks()` function.

Sub-deliverables:

1. Modify `scheduleBlocks()` in `src/commands/worldcup.js` to check `getLiveScore(id)`
   from `src/data/index.js` for in-progress matches
2. Display live score + minute for active matches, upcoming time for future matches (FR-8)

### task-15: Architecture Diagram Update (LOW)

Update DIAGRAMS.md to reflect the iteration 2 architecture now that all implementation
is complete. The current diagrams only show the iteration 1 structure.

Sub-deliverables:

1. Add the football API as an external system in the C4 System Context diagram
2. Update the Container diagram to show:
   - `src/live-data/` module: api.js, mapper.js, poller.js, cache.js, differ.js
   - Live Data Poller component polling the football API every 15s
   - Event Differ detecting new goals/cards/subs
   - In-memory cache integrating with `src/data/index.js` via `setLiveCache(cache)`
   - Thread context flow: broadcaster attaches metadata -> chat handler reads metadata
3. Update the Agentic Flow diagram if the grounding pipeline changed (context parameter)

## Complexity Assessment

- DONE: task-9 (API client), task-10 (real data + sync)
- SMALL tasks: task-14 (schedule command update), task-15 (diagram update)
- MEDIUM tasks: task-13 (thread-grounded AI)
- LARGE tasks: task-11 (poller lifecycle + cache + differ), task-12 (metadata + card edits +
  events + rate priority)

## Current Status

Tasks 1-10 are complete. Next up: task-11 (Live Data Poller and Cache).

Key files for remaining work:

- `src/live-data/api.js` - HTTP client (ready)
- `src/live-data/mapper.js` - response reshaping (ready)
- `src/data/index.js` - tiered resolution with `setLiveCache()` hook (ready)
- `src/broadcast/scheduler.js` - pre-match card posting (ready, needs enhancement)
- `src/handlers/chat.js` - mention/DM handling (ready, needs thread context)
- `src/commands/worldcup.js` - slash commands (ready, needs live score display)
- `DIAGRAMS.md` - architecture diagrams (ready, needs iteration 2 update)
