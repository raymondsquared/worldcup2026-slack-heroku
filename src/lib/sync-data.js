'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Sync logic (pure exports, no side effects). CLI wrapper validates env first.
const {
  fetchFixturesByDate,
  fetchFixtureById,
  fetchSquad,
  fetchStandings,
} = require('../live-data/api');
const { mapFixtureWithEvents, registerTeamMapping } = require('../live-data/mapper');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FIXTURES_DIR = path.join(DATA_DIR, 'fixtures');

// World Cup 2026 tournament dates (group stage through final)
const TOURNAMENT_START = '2026-06-11';
const TOURNAMENT_END = '2026-07-19';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadFixtures() {
  return loadJson(path.join(DATA_DIR, 'fixtures.json'));
}

function loadTeams() {
  return loadJson(path.join(DATA_DIR, 'teams.json'));
}

// Name->ID mapping from countries.json (source of truth).
const countries = loadJson(path.join(DATA_DIR, 'countries.json'));
const FIFA_CODES = {};
for (const country of countries) {
  FIFA_CODES[country.name.toLowerCase()] = country.id;
  if (country.aliases) {
    for (const alias of country.aliases) {
      FIFA_CODES[alias.toLowerCase()] = country.id;
    }
  }
}

function buildTeamNameMap(teams) {
  const map = new Map();
  for (const [name, code] of Object.entries(FIFA_CODES)) {
    map.set(name, code);
  }
  for (const team of teams) {
    map.set(team.name.toLowerCase(), team.id);
  }
  return map;
}

function normalizeName(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function resolveTeamId(apiTeam, teamNameMap) {
  return teamNameMap.get(normalizeName(apiTeam.name).toLowerCase()) || null;
}

function getDateRange(start, end) {
  const dates = [];
  const current = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (current <= last) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function fetchAllFixtures() {
  const dates = getDateRange(TOURNAMENT_START, TOURNAMENT_END);
  const allFixtures = [];
  let fetchedDays = 0;

  for (const date of dates) {
    try {
      const response = await fetchFixturesByDate(date);
      const fixtures = response.response || [];
      const wcFixtures = fixtures.filter(
        (f) => f.league && (f.league.name.includes('World Cup') || f.league.name.includes('FIFA')),
      );
      if (wcFixtures.length > 0) {
        allFixtures.push(...wcFixtures);
        console.log(`  ${date}: ${wcFixtures.length} fixture(s)`);
      }
      fetchedDays++;
    } catch (err) {
      console.warn(`  Warning: Failed to fetch ${date}: ${err.message}`);
    }

    // Rate limit: pause every 5 requests
    if (fetchedDays % 5 === 0) {
      await sleep(1000);
    }
  }

  return allFixtures;
}

async function syncTeams() {
  console.log('\n=== Sync Teams ===\n');

  const WORLD_CUP_LEAGUE_ID = 1;
  const SEASON = 2026;

  console.log(`Fetching standings (league=${WORLD_CUP_LEAGUE_ID}, season=${SEASON})...`);
  const response = await fetchStandings(WORLD_CUP_LEAGUE_ID, SEASON);

  const standings = response.response?.[0]?.league?.standings;
  if (!standings || standings.length === 0) {
    console.warn('\n⚠ No standings data returned from the API.');
    console.warn('  The tournament may not have group data available yet.');
    console.warn('  Skipping teams.json update to avoid wiping existing data.');
    return;
  }

  // standings is an array of groups; each group is an array of team entries
  const existingTeams = loadTeams();
  const nameMap = buildTeamNameMap(existingTeams);
  const teams = [];

  const seen = new Set();
  for (const group of standings) {
    for (const entry of group) {
      // Only include teams with a group-stage assignment (e.g. "Group A")
      // and ranked 1-4 (API may include playoff teams that didn't qualify)
      if (!entry.group || !entry.group.startsWith('Group')) continue;
      if (entry.rank > 4) continue;

      const apiTeam = entry.team;
      // Skip duplicates (team may appear in multiple standings arrays)
      if (seen.has(apiTeam.id)) continue;
      seen.add(apiTeam.id);

      const name = normalizeName(apiTeam.name);
      const internalId = nameMap.get(name.toLowerCase()) || generateTeamId(name);
      teams.push({
        id: internalId,
        name,
        group: entry.group,
        rank: entry.rank,
        points: entry.points,
        goalsDiff: entry.goalsDiff,
        externalId: apiTeam.id,
      });
      registerTeamMapping(apiTeam.id, internalId);
    }
  }

  if (teams.length === 0) {
    console.warn('\n⚠ Standings returned but no teams extracted.');
    console.warn('  Skipping teams.json update.');
    return;
  }

  const withGroups = teams.filter((t) => t.group != null);
  if (withGroups.length === 0) {
    console.warn('\n⚠ No group assignments found in standings data.');
    console.warn('  Skipping teams.json update to avoid wiping existing group data.');
    return;
  }

  teams.sort((a, b) => a.name.localeCompare(b.name));
  writeJson(path.join(DATA_DIR, 'teams.json'), teams);
  console.log(`\n✓ teams.json rebuilt (${teams.length} teams, ${withGroups.length} with groups)`);
}

function generateTeamId(name) {
  const lower = normalizeName(name).toLowerCase();
  if (FIFA_CODES[lower]) return FIFA_CODES[lower];
  // Last resort fallback - log a warning so we know to add the code
  const fallback = name
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase();
  console.warn(`  Warning: No FIFA code for "${name}", using fallback "${fallback}"`);
  return fallback;
}

async function syncFixtures() {
  console.log('\n=== Sync Fixtures ===\n');

  const teams = loadTeams();

  // Build lookup: API numeric team id -> our 3-letter code
  const externalToTeamId = new Map();
  for (const team of teams) {
    if (team.externalId != null) {
      externalToTeamId.set(team.externalId, team.id);
      registerTeamMapping(team.externalId, team.id);
    }
  }

  // Fallback: name-based lookup for teams without externalId
  const teamNameMap = buildTeamNameMap(teams);

  function resolveTeam(apiTeam) {
    return externalToTeamId.get(apiTeam.id) || resolveTeamId(apiTeam, teamNameMap);
  }

  console.log('Fetching fixtures...');
  const apiFixtures = await fetchAllFixtures();

  if (apiFixtures.length === 0) {
    console.log('No fixtures found.');
    return;
  }

  apiFixtures.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));

  // Reuse existing IDs so re-syncing never shifts previously assigned IDs.
  let existingFixtures = [];
  try {
    existingFixtures = loadFixtures();
  } catch {
    // First sync - no fixtures.json yet.
  }
  const existingIdByExternal = new Map();
  let maxExistingId = 0;
  for (const ef of existingFixtures) {
    if (ef.externalId != null) {
      existingIdByExternal.set(ef.externalId, ef.id);
    }
    if (ef.id > maxExistingId) maxExistingId = ef.id;
  }
  let nextId = maxExistingId;

  const fixtures = [];
  let unmatched = [];

  for (const f of apiFixtures) {
    const homeId = resolveTeam(f.teams.home);
    const awayId = resolveTeam(f.teams.away);

    if (!homeId || !awayId) {
      unmatched.push(`${f.teams.home.name} vs ${f.teams.away.name}`);
      continue;
    }

    const round = f.league.round || '';
    const isGroupStage = round.startsWith('Group Stage');
    const homeTeam = teams.find((t) => t.id === homeId);
    const group = isGroupStage && homeTeam ? homeTeam.group : null;

    const stableId = existingIdByExternal.get(f.fixture.id) || ++nextId;
    fixtures.push({
      id: stableId,
      dateAndTimeInUTC: f.fixture.date,
      stage: round,
      group,
      externalId: f.fixture.id,
      status: f.fixture.status.long,
      teams: {
        homeTeamId: homeId,
        homeTeamExternalId: f.teams.home.id,
        awayTeamId: awayId,
        awayTeamExternalId: f.teams.away.id,
      },
      finalScore: {
        home: f.goals.home,
        away: f.goals.away,
      },
      score: f.score,
    });
  }

  if (unmatched.length > 0) {
    console.warn(`\n⚠ Could not resolve teams for ${unmatched.length} fixture(s):`);
    for (const u of unmatched.slice(0, 10)) {
      console.warn(`  - ${u}`);
    }
  }

  writeJson(path.join(DATA_DIR, 'fixtures.json'), fixtures);
  console.log(`\n✓ fixtures.json rebuilt (${fixtures.length} fixtures from API)`);
}

async function syncPlayers() {
  console.log('\n=== Sync Players ===\n');

  const teams = loadTeams();
  const teamsWithExternal = teams.filter((t) => t.externalId != null);

  if (teamsWithExternal.length === 0) {
    console.log('No teams have externalId set. Run sync:teams first.');
    return;
  }

  console.log(`Fetching squads for ${teamsWithExternal.length} teams...`);
  const players = [];

  for (const team of teamsWithExternal) {
    try {
      const response = await fetchSquad(team.externalId);
      const squad = response.response || [];
      if (squad.length > 0) {
        const squadPlayers = squad[0].players || [];
        for (const player of squadPlayers) {
          const number = player.number || null;
          players.push({
            id: number ? `${team.id}-${number}` : `${team.id}-${player.id}`,
            name: normalizeName(player.name),
            teamId: team.id,
            position: player.position || null,
            number,
            externalId: player.id,
          });
        }
        console.log(`  ${team.id} (${team.name}): ${squadPlayers.length} players`);
      }
    } catch (err) {
      console.warn(`  Warning: Failed to fetch squad for ${team.id}: ${err.message}`);
    }

    // Rate limit
    await sleep(500);
  }

  if (players.length === 0) {
    console.log('No players fetched. Keeping existing player files.');
    return;
  }

  const PLAYERS_DIR = path.join(DATA_DIR, 'players');
  fs.mkdirSync(PLAYERS_DIR, { recursive: true });

  const byTeam = {};
  for (const player of players) {
    if (!byTeam[player.teamId]) byTeam[player.teamId] = [];
    byTeam[player.teamId].push(player);
  }

  for (const [teamId, squad] of Object.entries(byTeam)) {
    writeJson(path.join(PLAYERS_DIR, `${teamId}.json`), squad);
  }

  console.log(
    `\n✓ players written (${players.length} players across ${Object.keys(byTeam).length} teams)`,
  );
}

async function syncFixtureEvents(fixtureId) {
  console.log('\n=== Sync Fixture Events ===\n');

  const localFixtures = loadFixtures();
  const teams = loadTeams();

  // Register team mappings so mapFixtureWithEvents can resolve team IDs
  for (const team of teams) {
    if (team.externalId != null) {
      registerTeamMapping(team.externalId, team.id);
    }
  }

  // Ensure fixtures directory exists
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // If a specific fixture ID was given, fetch just that one
  if (fixtureId != null) {
    const entry = localFixtures.find((f) => f.id === fixtureId);
    if (!entry) {
      console.error(`Fixture ${fixtureId} not found in fixtures.json`);
      return;
    }
    if (!entry.externalId) {
      console.error(`Fixture ${fixtureId} has no externalId - run sync:fixtures first`);
      return;
    }

    console.log(`Fetching fixture ${fixtureId} (externalId: ${entry.externalId})...`);
    const response = await fetchFixtureById(entry.externalId);
    const apiFixture = response.response?.[0];

    if (!apiFixture) {
      console.error('No data returned from API');
      return;
    }

    const detail = mapFixtureWithEvents(apiFixture);
    detail.id = entry.id;
    detail.stage = entry.stage;
    detail.group = entry.group;
    detail.teams = entry.teams;

    const filePath = path.join(
      FIXTURES_DIR,
      `${entry.id}-${entry.teams.homeTeamId}-${entry.teams.awayTeamId}.json`,
    );
    writeJson(filePath, detail);
    console.log(`  ${entry.id}.json (${entry.teams.homeTeamId} vs ${entry.teams.awayTeamId})`);
    console.log(`\n✓ fixture ${fixtureId} events written`);
    return;
  }

  // No ID: discover finished fixtures by date, then fetch each for events.
  console.log('Step 1: Discovering finished fixtures via /fixtures?date=...');
  const allApiFixtures = await fetchAllFixtures();

  const finishedApiFixtures = allApiFixtures.filter((f) =>
    ['FT', 'AET', 'PEN'].includes(f.fixture.status.short),
  );

  if (finishedApiFixtures.length === 0) {
    console.log('No finished fixtures found.');
    return;
  }

  const toFetch = [];
  for (const apiFixture of finishedApiFixtures) {
    const entry = localFixtures.find((f) => f.externalId === apiFixture.fixture.id);
    if (entry) {
      toFetch.push(entry);
    }
  }

  if (toFetch.length === 0) {
    console.log('No matching local fixtures found for finished API fixtures.');
    return;
  }

  console.log(
    `\nStep 2: Fetching ${toFetch.length} finished fixture(s) individually for events/statistics...`,
  );
  let written = 0;

  for (const entry of toFetch) {
    try {
      const response = await fetchFixtureById(entry.externalId);
      const apiFixture = response.response?.[0];

      if (!apiFixture) {
        console.warn(
          `  ⚠ No data returned for fixture ${entry.id} (externalId: ${entry.externalId})`,
        );
        continue;
      }

      const detail = mapFixtureWithEvents(apiFixture);
      detail.id = entry.id;
      detail.stage = entry.stage;
      detail.group = entry.group;
      detail.teams = entry.teams;

      const filePath = path.join(
        FIXTURES_DIR,
        `${entry.id}-${entry.teams.homeTeamId}-${entry.teams.awayTeamId}.json`,
      );
      writeJson(filePath, detail);
      console.log(`  ${entry.id}.json (${entry.teams.homeTeamId} vs ${entry.teams.awayTeamId})`);
      written++;
    } catch (err) {
      console.error(`  ✗ Failed to fetch fixture ${entry.id}: ${err.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`\n✓ ${written} fixture event file(s) written`);
}

async function syncAll() {
  console.log('=== World Cup 2026 Full Data Sync ===');
  await syncTeams();
  await syncFixtures();
  await syncPlayers();
  await syncFixtureEvents();
  console.log('\n=== Full sync complete ===');
}

const COMMANDS = {
  teams: syncTeams,
  fixtures: syncFixtures,
  players: syncPlayers,
  'fixture-events': syncFixtureEvents,
  all: syncAll,
};

module.exports = {
  COMMANDS,
  syncTeams,
  syncFixtures,
  syncPlayers,
  syncFixtureEvents,
  syncAll,
  buildTeamNameMap,
  normalizeName,
  resolveTeamId,
  generateTeamId,
  getDateRange,
};
