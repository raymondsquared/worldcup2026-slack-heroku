'use strict';

const fs = require('node:fs');
const path = require('node:path');

const fixtures = require('./fixtures.json');
const teams = require('./teams.json');
const { isMatchLive } = require('../lib/dates');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const PLAYERS_DIR = path.join(__dirname, 'players');

// Caches: only invalidated by sync (separate process), safe for process lifetime.
const fixtureDetailCache = new Map();
let allPlayersCache = null;

// Live cache reference - set by the live data poller (task-11) via setLiveCache()
let liveCache = null;

function setLiveCache(cache) {
  liveCache = cache;
}

function getFixtureById(id) {
  // Tier 1: Live cache
  if (liveCache) {
    const live = liveCache.getFixture(id);
    if (live) {
      const base = fixtures.find((f) => f.id === id);
      return { ...base, ...live };
    }
  }

  // Tier 2: Per-fixture detail file (shallow copy prevents callers from
  // mutating the cached object).
  const detail = loadFixtureDetail(id);
  if (detail) {
    return { ...detail };
  }

  // Tier 3: Static schedule
  const base = fixtures.find((f) => f.id === id);
  return base || null;
}

function getFixtureEvents(id) {
  // Tier 1: Live cache
  if (liveCache) {
    const live = liveCache.getFixture(id);
    if (live && live.events) {
      return live.events;
    }
  }

  // Tier 2: Per-fixture detail file (slice prevents mutation of cached array)
  const detail = loadFixtureDetail(id);
  if (detail && detail.events) {
    return detail.events.slice();
  }

  return [];
}

function getLiveScore(id) {
  // Tier 1: Live cache (authoritative for active fixtures)
  if (liveCache) {
    const live = liveCache.getFixture(id);
    if (live) {
      const result = {
        status: live.status,
        elapsed: live.elapsed ?? null,
        home: live.finalScore?.home ?? null,
        away: live.finalScore?.away ?? null,
      };
      if (live.stale) result.stale = true;
      return result;
    }
  }

  // Tier 2: Per-fixture detail file (finished fixtures)
  const detail = loadFixtureDetail(id);
  if (detail && detail.status === 'Match Finished') {
    return {
      status: detail.status,
      home: detail.finalScore?.home ?? null,
      away: detail.finalScore?.away ?? null,
    };
  }

  // Tier 3: Check static schedule for any score data
  const base = fixtures.find((f) => f.id === id);
  if (base && base.finalScore?.home != null) {
    return {
      status: base.status,
      home: base.finalScore.home,
      away: base.finalScore.away,
    };
  }

  return null;
}

function loadFixtureDetail(id) {
  if (fixtureDetailCache.has(id)) return fixtureDetailCache.get(id);

  const base = fixtures.find((f) => f.id === id);
  if (!base || !base.teams) return null;
  const fileName = `${id}-${base.teams.homeTeamId}-${base.teams.awayTeamId}.json`;
  const filePath = path.join(FIXTURES_DIR, fileName);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const detail = JSON.parse(content);
    fixtureDetailCache.set(id, detail);
    return detail;
  } catch {
    return null;
  }
}

function getAllFixtures() {
  return fixtures;
}

function getUpcomingFixtures(n = 3, referenceDate = new Date()) {
  return fixtures
    .filter((f) => new Date(f.dateAndTimeInUTC) > referenceDate && f.status === 'Not Started')
    .sort((a, b) => new Date(a.dateAndTimeInUTC) - new Date(b.dateAndTimeInUTC))
    .slice(0, n);
}

function getLiveFixtures() {
  if (!liveCache) return [];

  return fixtures
    .map((f) => {
      const live = liveCache.getFixture(f.id);
      return live ? { ...f, ...live } : null;
    })
    .filter((merged) => merged && isMatchLive(merged.status));
}

function getGroups() {
  const groups = {};
  for (const team of teams) {
    if (!groups[team.group]) {
      groups[team.group] = [];
    }
    groups[team.group].push(team);
  }
  return groups;
}

function getPlayers(teamId) {
  const filePath = path.join(PLAYERS_DIR, `${teamId}.json`);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

// Lazily loads and caches all squad files for the process lifetime.
function getAllPlayers() {
  if (allPlayersCache) return allPlayersCache;

  let files;
  try {
    files = fs.readdirSync(PLAYERS_DIR).sort();
  } catch {
    return [];
  }

  const players = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = fs.readFileSync(path.join(PLAYERS_DIR, file), 'utf8');
      const squad = JSON.parse(content);
      if (Array.isArray(squad)) players.push(...squad);
    } catch {
      // Skip unreadable/malformed squad file rather than failing startup.
    }
  }
  allPlayersCache = players;
  return players;
}

function getTeamName(id) {
  const team = teams.find((t) => t.id === id);
  return team ? team.name : id;
}

module.exports = {
  getAllFixtures,
  getUpcomingFixtures,
  getLiveFixtures,
  getGroups,
  getPlayers,
  getAllPlayers,
  getTeamName,
  getFixtureById,
  getFixtureEvents,
  getLiveScore,
  setLiveCache,
};
