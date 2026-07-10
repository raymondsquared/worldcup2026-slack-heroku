'use strict';

const {
  TOOL_SCHEMAS,
  dispatchTool,
  resolveTeam,
  resolvePlayer,
  safeParseArgs,
} = require('../mia/tools');

describe('tools - TOOL_SCHEMAS', () => {
  test('every schema is a valid OpenAI function tool', () => {
    expect(Array.isArray(TOOL_SCHEMAS)).toBe(true);
    expect(TOOL_SCHEMAS.length).toBe(7);
    for (const tool of TOOL_SCHEMAS) {
      // Exactly the model-facing keys: the internal `handler` from the TOOLS
      // registry must never leak into the schema sent to the model.
      expect(Object.keys(tool).sort()).toEqual(['function', 'type']);
      expect(tool.type).toBe('function');
      expect(typeof tool.function.name).toBe('string');
      expect(tool.function.name.length).toBeGreaterThan(0);
      expect(typeof tool.function.description).toBe('string');
      expect(tool.function.description.length).toBeGreaterThan(0);
      expect(tool.function.parameters.type).toBe('object');
      expect(typeof tool.function.parameters.properties).toBe('object');
      expect(Array.isArray(tool.function.parameters.required)).toBe(true);
    }
  });

  test('catalog covers exactly the seven documented tools', () => {
    const names = TOOL_SCHEMAS.map((t) => t.function.name).sort();
    expect(names).toEqual([
      'get_fixture_events',
      'get_player',
      'get_player_goals',
      'get_standings',
      'get_team_results',
      'get_team_squad',
      'get_upcoming_fixtures',
    ]);
  });

  test('every schema name has a dispatch handler (no orphan schema)', () => {
    for (const tool of TOOL_SCHEMAS) {
      const result = dispatchTool(tool.function.name, {});
      // A handler ran (returned a value/array/object) rather than the
      // unknown-tool error.
      const isUnknownToolError = result && result.error && /^Unknown tool:/.test(result.error);
      expect(isUnknownToolError).toBeFalsy();
    }
  });
});

describe('tools - resolveTeam', () => {
  test('resolves an exact FIFA code', () => {
    expect(resolveTeam('ENG')).toBe('ENG');
    expect(resolveTeam('eng')).toBe('ENG');
  });

  test('resolves an exact team name', () => {
    expect(resolveTeam('England')).toBe('ENG');
    expect(resolveTeam('brazil')).toBe('BRA');
  });

  test('resolves a partial / substring name', () => {
    expect(resolveTeam('korea')).toBe('KOR');
  });

  test('returns null for an unknown team', () => {
    expect(resolveTeam('Narnia')).toBeNull();
  });

  test('does not resolve a team from an incidental word in a phrase', () => {
    // "USA vs Iran" must not silently resolve to Iran; the model should pass a
    // clean team name. (Regression: the old reverse-includes branch matched.)
    expect(resolveTeam('USA vs Iran')).toBeNull();
    expect(resolveTeam('the Iran match')).toBeNull();
  });

  test('does not mid-word substring mis-hit (word-boundary prefix only)', () => {
    // The old free `name.includes(q)` branch matched a query inside a word:
    // "ran" -> "fRANce". Tier-3 now requires a name token to START WITH the
    // query, so an interior fragment resolves no team.
    expect(resolveTeam('ran')).toBeNull(); // was France via "f-ran-ce"
    // A real leading-token partial still resolves (these exercise multi-word
    // names where only a token-prefix match can succeed).
    expect(resolveTeam('ivory')).toBe('CIV'); // Ivory Coast
    expect(resolveTeam('cape')).toBe('CPV'); // Cape Verde Islands
    expect(resolveTeam('saudi')).toBe('KSA'); // Saudi Arabia
  });

  test('null-safe for empty / non-string input', () => {
    expect(resolveTeam('')).toBeNull();
    expect(resolveTeam(null)).toBeNull();
    expect(resolveTeam(undefined)).toBeNull();
  });
});

describe('tools - resolvePlayer', () => {
  test('resolves via the squad index (exact full name)', () => {
    const p = resolvePlayer('Kylian Mbappe');
    expect(p).not.toBeNull();
    expect(p.teamId).toBe('FRA');
    expect(p.number).toBe(10);
  });

  test('resolves an abbreviated squad name from a fuller query (surname match)', () => {
    const p = resolvePlayer('Harry Kane');
    expect(p).not.toBeNull();
    expect(p.name).toBe('H. Kane');
    expect(p.teamId).toBe('ENG');
  });

  test('returns null for an unknown name', () => {
    expect(resolvePlayer('Zxqv Nobody')).toBeNull();
  });

  test('does not mid-token mis-hit on a short query', () => {
    // "Lee" must not match "Saleem"; "son" must not match "Alisson". Token-
    // aligned matching means these resolve to a real same-surname player or
    // null, never a confidently-wrong mid-token substring hit.
    const lee = resolvePlayer('Lee');
    expect(lee === null || lee.name.toLowerCase().split(/\s+/).includes('lee')).toBe(true);
    const son = resolvePlayer('son');
    expect(son === null || son.name.toLowerCase().split(/\s+/).includes('son')).toBe(true);
    // A bare two-letter fragment must not resolve anyone.
    expect(resolvePlayer('an')).toBeNull();
  });

  test('disambiguates a shared surname by first initial', () => {
    // ENG squad has both D. Henderson (#13) and J. Henderson (#14).
    const jordan = resolvePlayer('Jordan Henderson');
    expect(jordan).not.toBeNull();
    expect(jordan.number).toBe(14);
    const dean = resolvePlayer('Dean Henderson');
    expect(dean).not.toBeNull();
    expect(dean.number).toBe(13);
  });

  test('a bare shared surname resolves deterministically (stable across runs)', () => {
    // A surname shared across teams (e.g. "Rodriguez" appears in several squads)
    // must resolve to the SAME player on every call and platform. getAllPlayers()
    // sorts its squad-file read, so the winner is filesystem-independent; this
    // guards against the readdir-order nondeterminism that would otherwise pick a
    // different player on Linux/prod than on macOS/dev.
    const first = resolvePlayer('Rodriguez');
    expect(first).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      expect(resolvePlayer('Rodriguez')).toEqual(first);
    }
    // And the bare-surname result is itself a real Rodriguez.
    expect(first.name.toLowerCase()).toContain('rodriguez');
  });

  test('null-safe for empty / non-string input', () => {
    expect(resolvePlayer('')).toBeNull();
    expect(resolvePlayer(null)).toBeNull();
  });
});

describe('tools - safeParseArgs', () => {
  test('parses valid JSON', () => {
    expect(safeParseArgs('{"teamId":"ENG"}')).toEqual({ teamId: 'ENG' });
  });

  test('returns {} for malformed JSON (never throws)', () => {
    expect(safeParseArgs('{bad json')).toEqual({});
  });

  test('returns {} for null / undefined / empty', () => {
    expect(safeParseArgs(null)).toEqual({});
    expect(safeParseArgs(undefined)).toEqual({});
    expect(safeParseArgs('')).toEqual({});
  });

  test('passes an already-parsed object through', () => {
    expect(safeParseArgs({ name: 'Mbappe' })).toEqual({ name: 'Mbappe' });
  });

  test('returns {} for a non-object JSON scalar', () => {
    expect(safeParseArgs('42')).toEqual({});
    expect(safeParseArgs('"hi"')).toEqual({});
  });
});

describe('tools - dispatchTool routing', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('rejects an unknown tool name with a structured error (never throws)', () => {
    expect(dispatchTool('rm_rf', {})).toEqual({ error: 'Unknown tool: rm_rf' });
    expect(dispatchTool('', {})).toEqual({ error: 'Unknown tool: ' });
  });

  test('rejects inherited Object.prototype names (whitelist is own-key only)', () => {
    // A bare TOOL_HANDLERS[name] lookup would resolve these to inherited
    // prototype members - `constructor` would even return a fake success.
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(dispatchTool(name, { x: 1 })).toEqual({ error: `Unknown tool: ${name}` });
    }
  });

  test('get_upcoming_fixtures filters to a named team', () => {
    const out = dispatchTool('get_upcoming_fixtures', { teamId: 'England' });
    expect(Array.isArray(out)).toBe(true);
    for (const f of out) {
      expect(f.homeTeamId === 'ENG' || f.awayTeamId === 'ENG').toBe(true);
    }
  });

  test('get_upcoming_fixtures without a team returns the global upcoming list', () => {
    // Pin the clock to during the tournament so upcoming fixtures exist.
    jest.useFakeTimers().setSystemTime(new Date('2026-06-20T00:00:00Z'));
    const out = dispatchTool('get_upcoming_fixtures', {});
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(3);
  });

  test('get_upcoming_fixtures errors on an unknown team filter', () => {
    expect(dispatchTool('get_upcoming_fixtures', { teamId: 'Narnia' })).toEqual({
      error: 'Unknown team: Narnia',
    });
  });

  test('get_team_results returns finished fixtures with scores', () => {
    const out = dispatchTool('get_team_results', { teamId: 'MEX' });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    for (const f of out) {
      expect(f.status).toBe('Match Finished');
      expect(typeof f.score).toBe('string');
    }
  });

  test('get_team_results returns [] for a team with no finished match', () => {
    // Resolve a real team that has only "Not Started" fixtures. Find one
    // dynamically so the test does not codify a specific schedule.
    const { getAllFixtures } = require('../data');
    const teams = require('../data/teams.json');
    const finishedTeamIds = new Set();
    for (const f of getAllFixtures()) {
      if (f.status === 'Match Finished') {
        finishedTeamIds.add(f.teams.homeTeamId);
        finishedTeamIds.add(f.teams.awayTeamId);
      }
    }
    const noResultTeam = teams.find((t) => !finishedTeamIds.has(t.id));
    if (noResultTeam) {
      expect(dispatchTool('get_team_results', { teamId: noResultTeam.id })).toEqual([]);
    }
  });

  test('get_fixture_events returns shaped events for a finished fixture', () => {
    const out = dispatchTool('get_fixture_events', { fixtureId: 1 });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toHaveProperty('type');
    expect(out[0]).toHaveProperty('minute');
    expect(out[0]).toHaveProperty('team');
  });

  test('get_fixture_events errors on a non-numeric fixtureId', () => {
    expect(dispatchTool('get_fixture_events', { fixtureId: 'abc' })).toEqual({
      error: 'Invalid fixtureId: abc',
    });
  });

  test('get_standings returns one group sorted by rank', () => {
    const out = dispatchTool('get_standings', { group: 'A' });
    expect(out.group).toBe('Group A');
    expect(Array.isArray(out.standings)).toBe(true);
    const ranks = out.standings.map((s) => s.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test('get_standings without a group returns all groups', () => {
    const out = dispatchTool('get_standings', {});
    expect(out['Group A']).toBeDefined();
    expect(Array.isArray(out['Group A'])).toBe(true);
  });

  test('get_standings errors on an unknown group', () => {
    expect(dispatchTool('get_standings', { group: 'Z' })).toEqual({
      error: 'Unknown group: Z',
    });
  });

  test('get_team_squad returns players for a team', () => {
    const out = dispatchTool('get_team_squad', { teamId: 'ENG' });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toHaveProperty('name');
    expect(out[0]).toHaveProperty('number');
    expect(out[0]).toHaveProperty('position');
  });

  test('get_player returns a single player record', () => {
    const out = dispatchTool('get_player', { name: 'Mbappe' });
    expect(out).toMatchObject({ teamId: 'FRA', number: 10, position: 'Attacker' });
  });

  test('get_player returns null for an unrecognized name (no throw)', () => {
    expect(dispatchTool('get_player', { name: 'Zxqv' })).toBeNull();
  });

  test('get_player_goals tallies a known scorer with contributing fixtures', () => {
    // Messi scored 3 in the finished-fixture data; cross-check the tool's tally
    // against a direct scan of the Goal events so the test is data-driven, not a
    // codified schedule.
    const direct = directGoalTally('Messi');
    const out = dispatchTool('get_player_goals', { name: 'Messi' });
    expect(out).toMatchObject({ teamId: 'ARG' });
    expect(out.goals).toBe(direct.goals);
    expect(out.goals).toBeGreaterThan(0);
    expect(Array.isArray(out.fixtures)).toBe(true);
    // The reported fixtures account for every goal.
    const fromFixtures = out.fixtures.reduce((n, f) => n + f.minutes.length, 0);
    expect(fromFixtures).toBe(out.goals);
    expect(out.fixtures[0]).toHaveProperty('opponent');
  });

  test("get_player_goals EXCLUDES own goals but counts the same player's real goal", () => {
    // Aymen Hussein (IRQ) has both a Normal Goal and an Own Goal in the same
    // finished fixture. The own goal must not be credited, so the tally is the
    // real goal only. This single case proves both rules: real goal counts, own
    // goal does not.
    const out = dispatchTool('get_player_goals', { name: 'Aymen Hussein' });
    expect(out).toMatchObject({ teamId: 'IRQ', goals: 1 });
    // Cross-check: a raw scan that ignored detail would over-count.
    const rawIncludingOwnGoals = directGoalTally('Aymen Hussein', true).goals;
    expect(rawIncludingOwnGoals).toBeGreaterThan(out.goals);
  });

  test('get_player_goals reports penalties as a subset of goals', () => {
    // Havertz (GER) scored a penalty among his goals.
    const out = dispatchTool('get_player_goals', { name: 'Havertz' });
    expect(out.teamId).toBe('GER');
    expect(out.penalties).toBeGreaterThanOrEqual(1);
    expect(out.penalties).toBeLessThanOrEqual(out.goals);
  });

  test('get_player_goals returns zero (not an error) for a player who has not scored', () => {
    // A goalkeeper with no goals: a recognized player, so a structured zero, not
    // an error and not null.
    const out = dispatchTool('get_player_goals', { name: 'Benbot' });
    expect(out).toMatchObject({ teamId: 'ALG', goals: 0, penalties: 0 });
    expect(out.fixtures).toEqual([]);
  });

  test('get_player_goals returns null for an unrecognized name (no throw)', () => {
    expect(dispatchTool('get_player_goals', { name: 'Zxqv Nobody' })).toBeNull();
  });

  test('get_player_goals EXCLUDES a missed penalty (type Goal, detail Missed Penalty)', () => {
    // A missed penalty is emitted as type "Goal" with detail "Missed Penalty"
    // (same shape the broadcaster drops in formatScorers). There are none in the
    // current finished-fixture data, so inject one via a mocked data layer to
    // prove the allowlist (Normal Goal / Penalty only), not a denylist of just
    // "Own Goal", governs the tally. isolateModules keeps the mock scoped to
    // this test so the real-data tests above are unaffected.
    jest.isolateModules(() => {
      jest.doMock('../data', () => ({
        getAllFixtures: () => [
          { id: 1, status: 'Match Finished', teams: { homeTeamId: 'X', awayTeamId: 'Y' } },
        ],
        // null -> the tool falls back to the static getAllFixtures() status,
        // which is "Match Finished" here, so this fixture still counts.
        getFixtureById: () => null,
        getFixtureEvents: () => [
          {
            type: 'Goal',
            detail: 'Normal Goal',
            playerExternalId: 42,
            minute: 10,
            extraMinute: null,
          },
          { type: 'Goal', detail: 'Penalty', playerExternalId: 42, minute: 55, extraMinute: null },
          {
            type: 'Goal',
            detail: 'Missed Penalty',
            playerExternalId: 42,
            minute: 70,
            extraMinute: null,
          },
          { type: 'Goal', detail: 'Own Goal', playerExternalId: 42, minute: 80, extraMinute: null },
        ],
        getUpcomingFixtures: () => [],
        getGroups: () => ({}),
        getPlayers: () => [],
        getAllPlayers: () => [
          { name: 'Test Striker', teamId: 'X', externalId: 42, position: 'Attacker', number: 9 },
        ],
        getTeamName: (id) => id,
      }));
      const { dispatchTool: dispatchIsolated } = require('../mia/tools');
      const out = dispatchIsolated('get_player_goals', { name: 'Test Striker' });
      // Normal Goal + Penalty = 2; Missed Penalty and Own Goal both excluded.
      expect(out.goals).toBe(2);
      expect(out.penalties).toBe(1);
      expect(out.fixtures[0].minutes).toEqual([10, 55]);
    });
    jest.dontMock('../data');
  });

  test('get_player_goals counts goals in an in-progress (live) match, not just finished ones', () => {
    // C1 regression (found in the task-41 review): getAllFixtures() returns the
    // STATIC schedule status, which is stale during a live match, while
    // getFixtureById() returns the live-cache-merged status and
    // getFixtureEvents() returns the live goals. Before the fix the tally
    // filtered on the stale static status ("Not Started") and skipped the live
    // fixture, undercounting a current top scorer. The tool must read the merged
    // status (live or finished) and count it.
    jest.isolateModules(() => {
      jest.doMock('../data', () => ({
        // Static schedule still says the match has not started...
        getAllFixtures: () => [
          { id: 7, status: 'Not Started', teams: { homeTeamId: 'X', awayTeamId: 'Y' } },
        ],
        // ...but the live-cache-merged view says it is in progress.
        getFixtureById: (id) => ({
          id,
          status: 'Second Half',
          teams: { homeTeamId: 'X', awayTeamId: 'Y' },
        }),
        getFixtureEvents: () => [
          {
            type: 'Goal',
            detail: 'Normal Goal',
            playerExternalId: 42,
            minute: 12,
            extraMinute: null,
          },
          { type: 'Goal', detail: 'Penalty', playerExternalId: 42, minute: 60, extraMinute: null },
        ],
        getUpcomingFixtures: () => [],
        getGroups: () => ({}),
        getPlayers: () => [],
        getAllPlayers: () => [
          { name: 'Test Striker', teamId: 'X', externalId: 42, position: 'Attacker', number: 9 },
        ],
        getTeamName: (id) => id,
      }));
      const { dispatchTool: dispatchIsolated } = require('../mia/tools');
      const out = dispatchIsolated('get_player_goals', { name: 'Test Striker' });
      expect(out.goals).toBe(2);
      expect(out.penalties).toBe(1);
      expect(out.fixtures[0].minutes).toEqual([12, 60]);
    });
    jest.dontMock('../data');
  });

  test('dispatchTool tolerates missing args object', () => {
    expect(() => dispatchTool('get_upcoming_fixtures')).not.toThrow();
  });
});

// Independent re-implementation of the goal tally for cross-checking the tool,
// so a test failure points at the tool's logic rather than a copied constant.
// The correct rule is an allowlist: only "Normal Goal" and "Penalty" count.
// When includeOwnGoals is true it instead counts every Goal event (the wrong
// rule) to prove the tool's exclusions actually change the number.
function directGoalTally(name, includeOwnGoals = false) {
  const { getAllFixtures, getFixtureEvents } = require('../data');
  const { resolvePlayer } = require('../mia/tools');
  const player = resolvePlayer(name);
  if (!player) return null;
  let goals = 0;
  for (const f of getAllFixtures()) {
    if (f.status !== 'Match Finished') continue;
    for (const e of getFixtureEvents(f.id)) {
      if (e.type !== 'Goal' || e.playerExternalId !== player.externalId) continue;
      const counts = includeOwnGoals ? true : e.detail === 'Normal Goal' || e.detail === 'Penalty';
      if (counts) goals += 1;
    }
  }
  return { goals };
}
