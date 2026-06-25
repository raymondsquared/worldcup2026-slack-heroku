'use strict';

const {
  getAllFixtures,
  getFixtureById,
  getUpcomingFixtures,
  getFixtureEvents,
  getGroups,
  getPlayers,
  getAllPlayers,
  getTeamName,
} = require('../data');
const { isMatchLive } = require('../lib/dates');
const teams = require('../data/teams.json');

const FINISHED = 'Match Finished';
const DEFAULT_GLOBAL_LIMIT = 3;
const DEFAULT_TEAM_LIMIT = 5;
const MAX_LIMIT = 10;

function resolveTeam(name) {
  if (!name || typeof name !== 'string') return null;
  const q = name.trim().toLowerCase();
  if (!q) return null;

  let team = teams.find((t) => t.id.toLowerCase() === q);
  if (team) return team.id;

  team = teams.find((t) => t.name.toLowerCase() === q);
  if (team) return team.id;

  // Word-boundary prefix match on the team name (e.g. "korea" -> "South Korea",
  // "ivory" -> "Ivory Coast"): some name token must START WITH the query.
  if (q.length >= 3) {
    team = teams.find((t) =>
      t.name
        .toLowerCase()
        .split(/\s+/)
        .some((tok) => tok.startsWith(q)),
    );
    if (team) return team.id;
  }
  return null;
}

// Map a player name to a single squad record via the getAllPlayers() index.
function resolvePlayer(name) {
  if (!name || typeof name !== 'string') return null;
  const q = name.trim().toLowerCase();
  if (!q) return null;

  const players = getAllPlayers();
  const nameTokens = (p) =>
    p.name
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/\.$/, ''));
  const queryTokens = q.split(/\s+/).filter(Boolean);

  let player = players.find((p) => p.name.toLowerCase() === q);
  if (player) return player;

  // Surname anchor: last query token must equal a full name token.
  // "Mbappe" -> "Kylian Mbappe", "Kane" -> "H. Kane".
  const surname = queryTokens[queryTokens.length - 1];
  const earlier = queryTokens.slice(0, -1);
  player = players.find((p) => {
    const tokens = nameTokens(p);
    if (!tokens.includes(surname)) return false;
    return earlier.every((qt) =>
      tokens.some((nt) => nt === qt || (nt.length === 1 && nt === qt[0])),
    );
  });
  if (player) return player;

  return null;
}

function safeParseArgs(str) {
  if (str == null) return {};
  if (typeof str === 'object') return str;
  if (typeof str !== 'string') return {};
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function shapeFixture(f) {
  const out = {
    id: f.id,
    date: f.dateAndTimeInUTC,
    stage: f.stage,
    group: f.group,
    home: getTeamName(f.teams.homeTeamId),
    away: getTeamName(f.teams.awayTeamId),
    homeTeamId: f.teams.homeTeamId,
    awayTeamId: f.teams.awayTeamId,
    status: f.status,
  };
  if (f.finalScore && f.finalScore.home != null) {
    out.score = `${f.finalScore.home}-${f.finalScore.away}`;
  }
  return out;
}

function shapeEvent(e) {
  const out = {
    type: e.type,
    minute: e.extraMinute ? `${e.minute}+${e.extraMinute}` : e.minute,
    team: getTeamName(e.teamId),
    player: e.playerName,
    detail: e.detail,
  };
  if (e.assistPlayerName) out.assist = e.assistPlayerName;
  return out;
}

function shapeStandings(group) {
  return group
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((t) => ({ rank: t.rank, team: t.name, points: t.points, goalsDiff: t.goalsDiff }));
}

function clampLimit(limit, fallback) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// --- Tool implementations ---------------------------------------------------

function toolGetUpcomingFixtures(args) {
  const teamId = args.teamId ? resolveTeam(args.teamId) : null;
  if (args.teamId && !teamId) {
    return { error: `Unknown team: ${args.teamId}` };
  }
  if (teamId) {
    const limit = clampLimit(args.limit, DEFAULT_TEAM_LIMIT);
    const now = new Date();
    return getAllFixtures()
      .filter(
        (f) =>
          f.status === 'Not Started' &&
          new Date(f.dateAndTimeInUTC) > now &&
          (f.teams.homeTeamId === teamId || f.teams.awayTeamId === teamId),
      )
      .sort((a, b) => new Date(a.dateAndTimeInUTC) - new Date(b.dateAndTimeInUTC))
      .slice(0, limit)
      .map(shapeFixture);
  }
  const limit = clampLimit(args.limit, DEFAULT_GLOBAL_LIMIT);
  return getUpcomingFixtures(limit).map(shapeFixture);
}

function toolGetTeamResults(args) {
  const teamId = resolveTeam(args.teamId);
  if (!teamId) return { error: `Unknown team: ${args.teamId}` };
  return getAllFixtures()
    .filter(
      (f) =>
        f.status === FINISHED && (f.teams.homeTeamId === teamId || f.teams.awayTeamId === teamId),
    )
    .sort((a, b) => new Date(a.dateAndTimeInUTC) - new Date(b.dateAndTimeInUTC))
    .map(shapeFixture);
}

function toolGetFixtureEvents(args) {
  const fixtureId = Number(args.fixtureId);
  if (!Number.isInteger(fixtureId)) {
    return { error: `Invalid fixtureId: ${args.fixtureId}` };
  }
  return getFixtureEvents(fixtureId).map(shapeEvent);
}

function toolGetStandings(args) {
  const groups = getGroups();
  if (args.group) {
    const want = String(args.group)
      .toLowerCase()
      .replace(/^group\s*/, '')
      .trim();
    const key = Object.keys(groups).find(
      (k) =>
        k
          .toLowerCase()
          .replace(/^group\s*/, '')
          .trim() === want,
    );
    if (!key) return { error: `Unknown group: ${args.group}` };
    return { group: key, standings: shapeStandings(groups[key]) };
  }
  const out = {};
  for (const key of Object.keys(groups).sort()) {
    out[key] = shapeStandings(groups[key]);
  }
  return out;
}

function toolGetTeamSquad(args) {
  const teamId = resolveTeam(args.teamId);
  if (!teamId) return { error: `Unknown team: ${args.teamId}` };
  return getPlayers(teamId).map((p) => ({
    name: p.name,
    number: p.number,
    position: p.position,
    team: getTeamName(teamId),
  }));
}

function toolGetPlayer(args) {
  const player = resolvePlayer(args.name);
  if (!player) return null;
  return {
    name: player.name,
    team: getTeamName(player.teamId),
    teamId: player.teamId,
    position: player.position,
    number: player.number,
  };
}

function toolGetPlayerGoals(args) {
  const player = resolvePlayer(args.name);
  if (!player) return null;

  const base = {
    name: player.name,
    team: getTeamName(player.teamId),
    teamId: player.teamId,
    goals: 0,
    penalties: 0,
    fixtures: [],
  };

  const extId = player.externalId;
  if (extId == null) return base; // no stable id to match events on

  for (const f of getAllFixtures()) {
    const status = (getFixtureById(f.id) || f).status;
    if (status !== FINISHED && !isMatchLive(status)) continue;
    const scored = getFixtureEvents(f.id).filter(
      (e) =>
        e.type === 'Goal' &&
        e.playerExternalId === extId &&
        (e.detail === 'Normal Goal' || e.detail === 'Penalty'),
    );
    if (scored.length === 0) continue;
    base.goals += scored.length;
    base.penalties += scored.filter((e) => e.detail === 'Penalty').length;
    const oppId = f.teams.homeTeamId === player.teamId ? f.teams.awayTeamId : f.teams.homeTeamId;
    base.fixtures.push({
      fixtureId: f.id,
      opponent: getTeamName(oppId),
      minutes: scored.map((e) => (e.extraMinute ? `${e.minute}+${e.extraMinute}` : e.minute)),
    });
  }
  return base;
}

// Tool registry
const TOOLS = [
  {
    type: 'function',
    handler: toolGetUpcomingFixtures,
    function: {
      name: 'get_upcoming_fixtures',
      description:
        'Get upcoming World Cup 2026 fixtures from local data, optionally filtered ' +
        'to a specific team. Use for any question about when a team plays next or ' +
        'what matches are coming up.',
      parameters: {
        type: 'object',
        properties: {
          teamId: {
            type: 'string',
            description: 'Optional team name or FIFA code to filter by, e.g. England, ENG, Brazil.',
          },
          limit: {
            type: 'integer',
            description:
              'Optional max number of fixtures to return (default 3, or 5 when filtered by team).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    handler: toolGetTeamResults,
    function: {
      name: 'get_team_results',
      description:
        "Get a team's finished World Cup 2026 match results (with scores) from " +
        'local data. Use for past-result questions like "what was the score" or ' +
        '"did Brazil win". Returns an empty list if the team has no finished match yet.',
      parameters: {
        type: 'object',
        properties: {
          teamId: {
            type: 'string',
            description: 'Team name or FIFA code, e.g. Brazil, BRA, MEX.',
          },
        },
        required: ['teamId'],
      },
    },
  },
  {
    type: 'function',
    handler: toolGetFixtureEvents,
    function: {
      name: 'get_fixture_events',
      description:
        'Get the events (goals, cards, substitutions) for one fixture by its ' +
        'numeric id, from local data. Use for "who scored" or "any red cards" after ' +
        'first finding the fixture id via get_team_results or get_upcoming_fixtures.',
      parameters: {
        type: 'object',
        properties: {
          fixtureId: {
            type: 'integer',
            description: 'The numeric fixture id (the "id" field from a fixture result).',
          },
        },
        required: ['fixtureId'],
      },
    },
  },
  {
    type: 'function',
    handler: toolGetStandings,
    function: {
      name: 'get_standings',
      description:
        'Get World Cup 2026 group standings (rank, points, goal difference) from ' +
        'local data, optionally for one group. Use for "group table" or "how many ' +
        'points does a team have".',
      parameters: {
        type: 'object',
        properties: {
          group: {
            type: 'string',
            description: 'Optional group to filter by, e.g. "A" or "Group A". Omit for all groups.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    handler: toolGetTeamSquad,
    function: {
      name: 'get_team_squad',
      description:
        "Get a team's squad (player names, numbers, positions) from local data. " +
        'Use for "list the Brazil squad" or "who is on the England team".',
      parameters: {
        type: 'object',
        properties: {
          teamId: {
            type: 'string',
            description: 'Team name or FIFA code, e.g. England, ENG, BRA.',
          },
        },
        required: ['teamId'],
      },
    },
  },
  {
    type: 'function',
    handler: toolGetPlayer,
    function: {
      name: 'get_player',
      description:
        'Look up a single player by name from local squad data, returning their ' +
        'team, position, and shirt number. Use for "what number does Mbappe wear" ' +
        'or "what position does Harry Kane play". Returns null if not found.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The player name to look up, e.g. Harry Kane, Mbappe.',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    handler: toolGetPlayerGoals,
    function: {
      name: 'get_player_goals',
      description:
        'Count how many goals a player has scored in World Cup 2026 matches ' +
        '(both finished and currently in-progress), from local event data. Use ' +
        'for "how many goals has Messi scored" or "is X the top scorer". ' +
        'Penalties count; own goals do not. Returns the goal total, how many ' +
        'were penalties, and the contributing fixtures. Returns null if the ' +
        'player is not found, or a zero count if they have not scored.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The player name to tally goals for, e.g. Messi, Harry Kane.',
          },
        },
        required: ['name'],
      },
    },
  },
];

// What the model sees: the schema half of each registry entry, handler stripped.
const TOOL_SCHEMAS = TOOLS.map(({ type, function: fn }) => ({ type, function: fn }));

// Whitelist dispatch table: tool name -> read-only handler.
const TOOL_HANDLERS = Object.fromEntries(TOOLS.map((t) => [t.function.name, t.handler]));

// Whitelist dispatch: routes a model-requested tool name to its read-only
// handler.
function dispatchTool(name, args = {}) {
  if (!Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name)) {
    return { error: `Unknown tool: ${name}` };
  }
  const handler = TOOL_HANDLERS[name];
  try {
    return handler(args || {});
  } catch (err) {
    return { error: `Tool ${name} failed: ${err.message}` };
  }
}

module.exports = {
  TOOL_SCHEMAS,
  dispatchTool,
  resolveTeam,
  resolvePlayer,
  safeParseArgs,
};
