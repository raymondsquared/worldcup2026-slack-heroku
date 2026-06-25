'use strict';

const { fetchLiveFixtures, fetchFixturesByDate, fetchFixtureById } = require('./api');
const { mapLiveFixture } = require('./mapper');
const cache = require('./cache');
const differ = require('./differ');
const { getTodayUTC, isMatchLive } = require('../lib/dates');
const fixtures = require('../data/fixtures.json');

let passiveTimer = null;
let activeTimer = null;
let kickoffTimer = null;
let mode = 'stopped'; // 'stopped' | 'passive' | 'active'
let changesCallback = null;

const previousLiveIds = new Set();
const finishedIds = new Set();

const PASSIVE_INTERVAL = Number(process.env.POLLER_PASSIVE_INTERVAL_IN_MS) || 15 * 60 * 1000;
const ACTIVE_INTERVAL = Number(process.env.POLLER_ACTIVE_INTERVAL_IN_MS) || 15 * 1000;
const MAX_FAILURES = 5;
// Cap at 24h to avoid 32-bit setTimeout overflow; later passive ticks cover further fixtures.
const MAX_KICKOFF_SCHEDULE_IN_MS = 24 * 60 * 60 * 1000;

function start() {
  if (mode !== 'stopped') {
    console.warn('Poller already running');
    return;
  }

  mode = 'passive';
  console.log('Live poller started (passive mode)');

  checkForLiveMatches();
  passiveTimer = setInterval(checkForLiveMatches, PASSIVE_INTERVAL);
}

function stop() {
  if (passiveTimer) {
    clearInterval(passiveTimer);
    passiveTimer = null;
  }

  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }

  if (kickoffTimer) {
    clearTimeout(kickoffTimer);
    kickoffTimer = null;
  }

  mode = 'stopped';
  differ.clear();
  previousLiveIds.clear();
  finishedIds.clear();
  console.log('Live poller stopped');
}

async function checkForLiveMatches() {
  try {
    const today = getTodayUTC();
    const response = await fetchFixturesByDate(today);
    const allFixtures = response.response || [];

    const wcFixtures = allFixtures.filter(
      (f) => f.league?.name?.includes('World Cup') || f.league?.name?.includes('FIFA'),
    );

    // Passive fallback: catch missed match-ends
    const finishedFixtures = wcFixtures.filter(
      (f) =>
        !isMatchLive(f.fixture.status.long) && f.fixture.status.long.startsWith('Match Finished'),
    );

    for (const apiFixture of finishedFixtures) {
      const externalId = apiFixture.fixture.id;
      const localFixture = fixtures.find((f) => f.externalId === externalId);
      if (!localFixture) continue;
      if (finishedIds.has(localFixture.id)) continue;

      const liveData = mapLiveFixture(apiFixture);
      cache.updateFixtures([[localFixture.id, liveData]]);
      const diff = differ.buildMatchEndDiff(localFixture.id, liveData);
      finishedIds.add(localFixture.id);
      console.log(`Passive fallback: match ended for fixture ${localFixture.id}`);

      if (changesCallback) {
        Promise.resolve(changesCallback([diff])).catch((err) => {
          console.error('Passive match-end callback error:', err.message);
        });
      }
    }

    const liveFixtures = wcFixtures.filter((f) => isMatchLive(f.fixture.status.long));

    if (liveFixtures.length > 0 && mode === 'passive') {
      switchToActiveMode(liveFixtures.length);
    } else if (mode === 'passive') {
      // Re-arm kickoff timer. If the API lags, next passive tick recovers.
      scheduleKickoffActivation();
    }
  } catch (err) {
    console.error(`Passive check failed: ${err.message}`);
  }
}

function scheduleKickoffActivation() {
  if (kickoffTimer) {
    clearTimeout(kickoffTimer);
    kickoffTimer = null;
  }

  const now = Date.now();
  let nextKickoff = Infinity;

  for (const f of fixtures) {
    const kickoff = new Date(f.dateAndTimeInUTC).getTime();
    if (kickoff > now && kickoff < nextKickoff) {
      nextKickoff = kickoff;
    }
  }

  if (nextKickoff === Infinity) return;

  const delay = nextKickoff - now;

  if (delay > MAX_KICKOFF_SCHEDULE_IN_MS) return;

  console.log(`Kickoff activation scheduled in ${Math.round(delay / 60000)} min`);
  kickoffTimer = setTimeout(() => {
    kickoffTimer = null;
    if (mode === 'passive') {
      console.log('Kickoff timer fired - switching to active polling');
      switchToActiveMode(1);
    }
  }, delay);
}

function switchToActiveMode(liveCount) {
  console.log(`Switching to active polling - ${liveCount} live matches detected`);

  if (passiveTimer) {
    clearInterval(passiveTimer);
    passiveTimer = null;
  }
  if (kickoffTimer) {
    clearTimeout(kickoffTimer);
    kickoffTimer = null;
  }

  mode = 'active';

  // setTimeout chain prevents overlap
  scheduleActivePoll(0);
}

function scheduleActivePoll(delayMs) {
  if (mode !== 'active') return;
  activeTimer = setTimeout(() => pollLiveFixtures(), delayMs);
}

async function pollLiveFixtures() {
  if (mode !== 'active') return;

  try {
    const response = await fetchLiveFixtures();
    const apiFixtures = response.response || [];

    const wcFixtures = apiFixtures.filter(
      (f) => f.league?.name?.includes('World Cup') || f.league?.name?.includes('FIFA'),
    );

    // Detect match-ends (dropped from live feed)
    const currentLiveExternalIds = new Set(wcFixtures.map((f) => f.fixture.id));
    const matchEndDiffs = await detectMatchEnds(currentLiveExternalIds);

    previousLiveIds.clear();
    for (const id of currentLiveExternalIds) {
      previousLiveIds.add(id);
    }

    if (wcFixtures.length === 0) {
      if (matchEndDiffs.length > 0 && changesCallback) {
        Promise.resolve(changesCallback(matchEndDiffs)).catch((err) => {
          console.error('Match-end callback error:', err.message);
        });
      }
      switchToPassiveMode();
      return;
    }

    const cacheEntries = [];
    for (const apiFixture of wcFixtures) {
      const externalId = apiFixture.fixture.id;
      const localFixture = fixtures.find((f) => f.externalId === externalId);

      if (localFixture) {
        const liveData = mapLiveFixture(apiFixture);
        cacheEntries.push([localFixture.id, liveData]);
      } else {
        console.warn(`Unknown fixture externalId: ${externalId}`);
      }
    }

    cache.updateFixtures(cacheEntries);

    const diffs = differ.diffAll(cacheEntries);
    const allDiffs = [...matchEndDiffs, ...diffs];
    if (allDiffs.length > 0 && changesCallback) {
      // Fire and forget - don't block the poll loop
      Promise.resolve(changesCallback(allDiffs)).catch((err) => {
        console.error('Changes callback error:', err.message);
      });
    }

    // Normal interval (auto-recovers from backoff)
    scheduleActivePoll(ACTIVE_INTERVAL);
  } catch (err) {
    handlePollError(err);
  }
}

async function detectMatchEnds(currentLiveExternalIds) {
  const diffs = [];

  for (const externalId of previousLiveIds) {
    if (currentLiveExternalIds.has(externalId)) continue;

    const localFixture = fixtures.find((f) => f.externalId === externalId);
    if (!localFixture) continue;
    if (finishedIds.has(localFixture.id)) continue;

    try {
      const response = await fetchFixtureById(externalId);
      const apiFixture = (response.response || [])[0];
      if (!apiFixture) continue;

      const liveData = mapLiveFixture(apiFixture);
      // Coerce to finished: detail endpoint may lag behind the live feed drop-off.
      if (!String(liveData.status).startsWith('Match Finished')) {
        liveData.status = 'Match Finished';
        liveData.elapsed = null;
      }
      cache.updateFixtures([[localFixture.id, liveData]]);
      diffs.push(differ.buildMatchEndDiff(localFixture.id, liveData));
      finishedIds.add(localFixture.id);
      console.log(`Match ended: fixture ${localFixture.id} (ext: ${externalId})`);
    } catch (err) {
      console.error(`Failed to fetch final state for fixture ${externalId}: ${err.message}`);
    }
  }

  return diffs;
}

function switchToPassiveMode() {
  console.log('No live matches - returning to passive mode');

  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }

  mode = 'passive';

  passiveTimer = setInterval(checkForLiveMatches, PASSIVE_INTERVAL);

  // Immediate kickoff arm so multi-match days don't wait a full passive interval.
  scheduleKickoffActivation();
}

function handlePollError(err) {
  const backoffInterval = cache.recordFailure();
  const stats = cache.getStats();

  console.error(`Poll failed (attempt ${stats.failureCount}/5): ${err.message}`);

  if (stats.failureCount >= MAX_FAILURES) {
    switchToPassiveMode();
  } else {
    // Retry with backoff
    scheduleActivePoll(backoffInterval);
  }
}

function onChanges(callback) {
  changesCallback = callback;
}

function getStatus() {
  return {
    mode,
    cacheStats: cache.getStats(),
  };
}

module.exports = {
  start,
  stop,
  getStatus,
  onChanges,
};
