'use strict';

// Tracks previously seen events and scores per fixture to detect changes between polls.
//
// On a fixture's FIRST observation (restart guard) the differ seeds dedup state
// without re-broadcasting historical events (newEvents stays []) but still
// emits a one-time diff marked `initial: true`, so the broadcaster can flip the
// pre-match card to the live card at kickoff instead of waiting for the first
// score or elapsed change on a later poll.

const previousKeys = new Map(); // fixtureId -> Set<string>
const previousScores = new Map(); // fixtureId -> { home, away }
const previousElapsed = new Map(); // fixtureId -> number|null

function eventKey(event) {
  const player = event.playerExternalId || event.playerName;

  switch (event.type) {
    case 'subst': {
      // Minute-independent so API minute drift between polls does not re-post
      // the same substitution. Keyed on the (off, on) player pair, which assumes
      // a given pair is involved in at most one substitution per match - true in
      // practice (a player who comes off does not come back on). The residual
      // edge (the exact same off/on pair subbing twice) would dedup to one
      // alert; accepted as effectively impossible under normal match rules.
      const playerOn = event.assistPlayerExternalId || event.assistPlayerName || '';
      return `subst-${player}-${playerOn}`;
    }
    case 'Card':
      return `Card-${event.detail}-${player}`;
    default:
      return `${event.type}-${event.minute}-${player}`;
  }
}

function diffAll(cacheEntries) {
  const results = [];

  for (const [fixtureId, data] of cacheEntries) {
    const events = data.events || [];
    const currentScore = data.finalScore || { home: null, away: null };
    const currentElapsed = data.elapsed ?? null;

    // Build current event keys
    const currentKeys = new Set(events.map(eventKey));

    // First time seeing this fixture (restart guard). Seed dedup state without
    // re-broadcasting historical events (newEvents stays []), but emit a
    // one-time initial diff so the broadcaster can flip the pre-match card to a
    // live card at kickoff instead of waiting for the first score/elapsed change.
    if (!previousKeys.has(fixtureId)) {
      previousKeys.set(fixtureId, currentKeys);
      previousScores.set(fixtureId, { ...currentScore });
      previousElapsed.set(fixtureId, currentElapsed);

      results.push({
        fixtureId,
        newEvents: [],
        currentScore: { ...currentScore },
        previousScore: { ...currentScore },
        scoreChanged: false,
        elapsedChanged: false,
        elapsed: currentElapsed,
        initial: true,
      });
      continue;
    }

    const seenKeys = previousKeys.get(fixtureId);
    const lastScore = previousScores.get(fixtureId);
    const lastElapsed = previousElapsed.get(fixtureId);

    // Find new events (keys not in previous set)
    const newEvents = events.filter((e) => !seenKeys.has(eventKey(e)));

    // Detect score change
    const scoreChanged =
      currentScore.home !== lastScore.home || currentScore.away !== lastScore.away;

    // Detect elapsed change
    const elapsedChanged = currentElapsed !== lastElapsed;

    if (newEvents.length > 0 || scoreChanged || elapsedChanged) {
      results.push({
        fixtureId,
        newEvents,
        currentScore: { ...currentScore },
        previousScore: { ...lastScore },
        scoreChanged,
        elapsedChanged,
        elapsed: currentElapsed,
      });
    }

    // Update state
    previousKeys.set(fixtureId, currentKeys);
    previousScores.set(fixtureId, { ...currentScore });
    previousElapsed.set(fixtureId, currentElapsed);
  }

  return results;
}

function buildMatchEndDiff(fixtureId, data) {
  const currentScore = data.finalScore || { home: null, away: null };

  return {
    fixtureId,
    newEvents: [],
    currentScore: { ...currentScore },
    previousScore: { ...currentScore },
    scoreChanged: true,
    elapsedChanged: false,
    elapsed: null,
    matchEnded: true,
  };
}

function clear() {
  previousKeys.clear();
  previousScores.clear();
  previousElapsed.clear();
}

module.exports = { diffAll, buildMatchEndDiff, clear };
