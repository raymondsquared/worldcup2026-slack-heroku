'use strict';

jest.mock('../data', () => ({
  getAllFixtures: jest.fn(),
  getTeamName: jest.fn((id) => {
    const names = {
      MEX: 'Mexico',
      RSA: 'South Africa',
      GER: 'Germany',
      JPN: 'Japan',
      ARG: 'Argentina',
      ALG: 'Algeria',
      FRA: 'France',
      SEN: 'Senegal',
    };
    return names[id] || id;
  }),
}));

const { getAllFixtures } = require('../data');
const { getLatestHighlights, DEFAULT_LIMIT } = require('../highlights/query');

function fx(id, date, home, away, withUrl = true) {
  const f = {
    id,
    dateAndTimeInUTC: `${date}T19:00:00+00:00`,
    teams: { homeTeamId: home, awayTeamId: away },
    status: 'Match Finished',
  };
  if (withUrl) f.highlightsURL = `https://youtube.com/watch?v=${id}`;
  return f;
}

describe('highlights/query', () => {
  const ORIGINAL_LIMIT = process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT;
  });

  afterAll(() => {
    if (ORIGINAL_LIMIT === undefined) delete process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT;
    else process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT = ORIGINAL_LIMIT;
  });

  test('returns the latest N highlights newest-first (default limit 5)', () => {
    getAllFixtures.mockReturnValue([
      fx(1, '2026-06-12', 'MEX', 'RSA'),
      fx(2, '2026-06-13', 'GER', 'JPN'),
      fx(3, '2026-06-14', 'FRA', 'SEN'),
      fx(4, '2026-06-15', 'MEX', 'JPN'),
      fx(5, '2026-06-16', 'GER', 'RSA'),
      fx(6, '2026-06-17', 'ARG', 'ALG'),
    ]);

    const result = getLatestHighlights();

    expect(result).toHaveLength(5);
    expect(result.map((m) => m.fixture.id)).toEqual([6, 5, 4, 3, 2]);
    expect(result[0].title).toBe('Highlights | Argentina vs Algeria');
  });

  test('maps team names and url correctly', () => {
    getAllFixtures.mockReturnValue([fx(1, '2026-06-17', 'MEX', 'RSA')]);

    const result = getLatestHighlights();

    expect(result[0]).toEqual({
      fixture: { id: 1, teams: { homeTeamId: 'MEX', awayTeamId: 'RSA' } },
      url: 'https://youtube.com/watch?v=1',
      title: 'Highlights | Mexico vs South Africa',
    });
  });

  test('spans multiple days (not limited to a single date)', () => {
    getAllFixtures.mockReturnValue([
      fx(1, '2026-06-16', 'FRA', 'SEN'),
      fx(2, '2026-06-17', 'ARG', 'ALG'),
    ]);

    const result = getLatestHighlights();

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.fixture.id)).toEqual([2, 1]);
  });

  test('honors HIGHLIGHTS_COMMAND_FIXTURES_LIMIT env var', () => {
    process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT = '2';
    getAllFixtures.mockReturnValue([
      fx(1, '2026-06-15', 'GER', 'JPN'),
      fx(2, '2026-06-16', 'FRA', 'SEN'),
      fx(3, '2026-06-17', 'ARG', 'ALG'),
    ]);

    const result = getLatestHighlights();

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.fixture.id)).toEqual([3, 2]);
  });

  test('explicit limit argument overrides env var', () => {
    process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT = '2';
    getAllFixtures.mockReturnValue([
      fx(1, '2026-06-15', 'GER', 'JPN'),
      fx(2, '2026-06-16', 'FRA', 'SEN'),
      fx(3, '2026-06-17', 'ARG', 'ALG'),
    ]);

    const result = getLatestHighlights(1);

    expect(result).toHaveLength(1);
    expect(result[0].fixture.id).toBe(3);
  });

  test('falls back to default limit when env var is invalid', () => {
    process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT = 'not-a-number';
    getAllFixtures.mockReturnValue([
      fx(1, '2026-06-12', 'MEX', 'RSA'),
      fx(2, '2026-06-13', 'GER', 'JPN'),
      fx(3, '2026-06-14', 'FRA', 'SEN'),
      fx(4, '2026-06-15', 'MEX', 'JPN'),
      fx(5, '2026-06-16', 'GER', 'RSA'),
      fx(6, '2026-06-17', 'ARG', 'ALG'),
    ]);

    const result = getLatestHighlights();

    expect(result).toHaveLength(DEFAULT_LIMIT);
  });

  test('falls back to default when env var is negative or zero (no silent drop)', () => {
    const fixtures = [
      fx(1, '2026-06-12', 'MEX', 'RSA'),
      fx(2, '2026-06-13', 'GER', 'JPN'),
      fx(3, '2026-06-14', 'FRA', 'SEN'),
      fx(4, '2026-06-15', 'MEX', 'JPN'),
      fx(5, '2026-06-16', 'GER', 'RSA'),
      fx(6, '2026-06-17', 'ARG', 'ALG'),
    ];

    for (const bad of ['-2', '0', '-1']) {
      getAllFixtures.mockReturnValue(fixtures);
      process.env.HIGHLIGHTS_COMMAND_FIXTURES_LIMIT = bad;

      const result = getLatestHighlights();

      // Must return the default count with the NEWEST items, never slice(0, -n)
      expect(result).toHaveLength(DEFAULT_LIMIT);
      expect(result[0].fixture.id).toBe(6); // newest first, not dropped
    }
  });

  test('excludes fixtures without highlightsURL', () => {
    getAllFixtures.mockReturnValue([
      fx(1, '2026-06-17', 'ARG', 'ALG', true),
      fx(2, '2026-06-17', 'FRA', 'SEN', false),
    ]);

    const result = getLatestHighlights();

    expect(result).toHaveLength(1);
    expect(result[0].fixture.id).toBe(1);
  });

  test('returns empty array when no highlights exist anywhere', () => {
    getAllFixtures.mockReturnValue([fx(1, '2026-06-11', 'MEX', 'RSA', false)]);

    expect(getLatestHighlights()).toHaveLength(0);
  });

  test('ignores fixtures missing dateAndTimeInUTC', () => {
    getAllFixtures.mockReturnValue([
      { id: 1, teams: { homeTeamId: 'MEX', awayTeamId: 'RSA' }, highlightsURL: 'https://x/y' },
    ]);

    expect(getLatestHighlights()).toHaveLength(0);
  });

  test('ignores fixtures missing teams', () => {
    getAllFixtures.mockReturnValue([
      { id: 1, dateAndTimeInUTC: '2026-06-17T19:00:00+00:00', highlightsURL: 'https://x/y' },
    ]);

    expect(getLatestHighlights()).toHaveLength(0);
  });
});
