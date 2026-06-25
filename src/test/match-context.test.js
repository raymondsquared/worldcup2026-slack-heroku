'use strict';

jest.mock('../data', () => ({
  getFixtureById: jest.fn(),
  getFixtureEvents: jest.fn(),
  getLiveScore: jest.fn(),
  getTeamName: jest.fn(),
}));

const { getFixtureById, getFixtureEvents, getLiveScore, getTeamName } = require('../data');
const { buildMatchContext } = require('../handlers/match-context');

describe('match-context/buildMatchContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTeamName.mockImplementation((id) => {
      if (id === 'MEX') return 'Mexico';
      if (id === 'RSA') return 'South Africa';
      return null;
    });
  });

  const baseFixture = {
    id: 101,
    teams: { homeTeamId: 'MEX', awayTeamId: 'RSA' },
    status: 'Not Started',
    dateAndTimeInUTC: '2026-06-14T18:00:00Z',
  };

  test('returns formatted string with score, events, and teams', () => {
    getFixtureById.mockReturnValue(baseFixture);
    getLiveScore.mockReturnValue({
      status: 'Second Half',
      elapsed: 67,
      home: 2,
      away: 1,
      stale: false,
    });
    getFixtureEvents.mockReturnValue([
      {
        type: 'Goal',
        minute: 23,
        playerName: 'J. Quinones',
        assistPlayerName: 'E. Lira',
        teamId: 'MEX',
      },
      { type: 'Goal', minute: 55, playerName: 'H. Lozano', teamId: 'MEX' },
    ]);

    const ctx = buildMatchContext(101);

    expect(ctx).toContain('Match: Mexico vs South Africa');
    expect(ctx).toContain("Status: Second Half (67')");
    expect(ctx).toContain('Score: Mexico 2 - 1 South Africa');
    expect(ctx).toContain("23' Goal: J. Quinones (assist: E. Lira) - Mexico");
    expect(ctx).toContain("55' Goal: H. Lozano - Mexico");
    expect(ctx).toContain('Teams: Mexico (MEX), South Africa (RSA)');
  });

  test('includes elapsed time and status from live cache', () => {
    getFixtureById.mockReturnValue(baseFixture);
    getLiveScore.mockReturnValue({
      status: 'First Half',
      elapsed: 33,
      home: 0,
      away: 0,
      stale: false,
    });
    getFixtureEvents.mockReturnValue([]);

    const ctx = buildMatchContext(101);

    expect(ctx).toContain("Status: First Half (33')");
    expect(ctx).toContain('Score: Mexico 0 - 0 South Africa');
  });

  test('returns "No events yet." when events array is empty but score exists', () => {
    getFixtureById.mockReturnValue(baseFixture);
    getLiveScore.mockReturnValue({
      status: 'First Half',
      elapsed: 5,
      home: 0,
      away: 0,
      stale: false,
    });
    getFixtureEvents.mockReturnValue([]);

    const ctx = buildMatchContext(101);

    expect(ctx).toContain('No events yet.');
  });

  test('returns null for unknown fixture', () => {
    getFixtureById.mockReturnValue(null);

    const ctx = buildMatchContext(999);

    expect(ctx).toBeNull();
  });

  test('includes staleness note when data is stale', () => {
    getFixtureById.mockReturnValue(baseFixture);
    getLiveScore.mockReturnValue({
      status: 'Second Half',
      elapsed: 70,
      home: 1,
      away: 0,
      stale: true,
    });
    getFixtureEvents.mockReturnValue([]);

    const ctx = buildMatchContext(101);

    expect(ctx).toContain('(data may be outdated)');
  });

  test('returns partial context for not-started match (teams + kickoff)', () => {
    getFixtureById.mockReturnValue(baseFixture);
    getLiveScore.mockReturnValue(null);
    getFixtureEvents.mockReturnValue([]);

    const ctx = buildMatchContext(101);

    expect(ctx).toContain('Match: Mexico vs South Africa');
    expect(ctx).toContain('Status: Not Started');
    expect(ctx).toContain('Kickoff: 2026-06-14T18:00:00Z');
    expect(ctx).not.toContain('Score:');
    expect(ctx).not.toContain('No events yet.');
  });

  test('rejects non-numeric matchId (returns null)', () => {
    expect(buildMatchContext('101')).toBeNull();
    expect(buildMatchContext(null)).toBeNull();
    expect(buildMatchContext(undefined)).toBeNull();
    expect(buildMatchContext(NaN)).toBeNull();
    expect(buildMatchContext(Infinity)).toBeNull();
    expect(getFixtureById).not.toHaveBeenCalled();
  });
});
