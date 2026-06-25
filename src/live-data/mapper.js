'use strict';

const fixtures = require('../data/fixtures.json');
const teams = require('../data/teams.json');
const { getAllPlayers } = require('../data/index');

const externalFixtureIdToInternalId = new Map();
for (const fixture of fixtures) {
  if (fixture.externalId != null) {
    externalFixtureIdToInternalId.set(fixture.externalId, fixture.id);
  }
}

const externalTeamIdToTeamId = new Map();
for (const team of teams) {
  if (team.externalId != null) {
    externalTeamIdToTeamId.set(team.externalId, team.id);
  }
}

const externalPlayerIdToName = new Map();
for (const player of getAllPlayers()) {
  if (player.externalId != null && player.name) {
    externalPlayerIdToName.set(player.externalId, player.name);
  }
}

if (externalPlayerIdToName.size === 0) {
  console.warn('[mapper] no squad players loaded; event names will fall back to raw API names');
}

function resolvePlayerName(externalId, apiName) {
  if (externalId != null && externalPlayerIdToName.has(externalId)) {
    return externalPlayerIdToName.get(externalId);
  }
  return apiName;
}

function registerTeamMapping(externalTeamId, internalTeamId) {
  externalTeamIdToTeamId.set(externalTeamId, internalTeamId);
}

function findTeamIdByExternalId(externalTeamId) {
  return externalTeamIdToTeamId.get(externalTeamId) || null;
}

function mapFixture(fixture) {
  const externalId = fixture.fixture.id;
  const internalId = externalFixtureIdToInternalId.get(externalId) || null;

  return {
    id: internalId,
    dateAndTimeInUTC: fixture.fixture.date,
    stage: fixture.league.round || null,
    externalId,
    status: fixture.fixture.status.long,
    teams: {
      homeTeamId: findTeamIdByExternalId(fixture.teams.home.id),
      awayTeamId: findTeamIdByExternalId(fixture.teams.away.id),
    },
    finalScore: {
      home: fixture.goals.home,
      away: fixture.goals.away,
    },
    score: fixture.score,
  };
}

function mapFixtureWithEvents(fixture) {
  const summary = mapFixture(fixture);

  return {
    ...summary,
    events: (fixture.events || []).map(mapEvent),
    statistics: (fixture.statistics || []).map(mapStatistics),
  };
}

function mapEvent(event) {
  return {
    type: event.type,
    minute: event.time.elapsed,
    extraMinute: event.time.extra || null,
    teamId: findTeamIdByExternalId(event.team.id),
    teamExternalId: event.team.id,
    playerExternalId: event.player.id,
    playerName: resolvePlayerName(event.player.id, event.player.name),
    assistPlayerExternalId: event.assist?.id || null,
    assistPlayerName: resolvePlayerName(event.assist?.id, event.assist?.name || null),
    detail: event.detail,
    comments: event.comments || null,
  };
}

function mapStatistics(teamStats) {
  return {
    teamId: findTeamIdByExternalId(teamStats.team.id),
    statistics: teamStats.statistics,
  };
}

function mapLiveFixture(apiFixture) {
  return {
    status: apiFixture.fixture.status.long,
    elapsed: apiFixture.fixture.status.elapsed ?? null,
    finalScore: {
      home: apiFixture.goals.home,
      away: apiFixture.goals.away,
    },
    score: {
      halftime: {
        home: apiFixture.score.halftime.home,
        away: apiFixture.score.halftime.away,
      },
      fulltime: {
        home: apiFixture.score.fulltime.home,
        away: apiFixture.score.fulltime.away,
      },
      extratime: {
        home: apiFixture.score.extratime.home,
        away: apiFixture.score.extratime.away,
      },
      penalty: {
        home: apiFixture.score.penalty.home,
        away: apiFixture.score.penalty.away,
      },
    },
    events: (apiFixture.events || []).map(mapEvent),
  };
}

module.exports = {
  mapFixtureWithEvents,
  mapLiveFixture,
  registerTeamMapping,
  resolvePlayerName,
};
