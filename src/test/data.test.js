'use strict';

const {
  getAllFixtures,
  getUpcomingFixtures,
  getLiveFixtures,
  getGroups,
  getPlayers,
  getFixtureById,
  getFixtureEvents,
  getLiveScore,
  setLiveCache,
} = require('../data');

describe('data helpers', () => {
  test('getAllFixtures returns all fixtures', () => {
    const fixtures = getAllFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures[0]).toHaveProperty('id');
    expect(fixtures[0]).toHaveProperty('dateAndTimeInUTC');
    expect(fixtures[0]).toHaveProperty('teams.homeTeamId');
    expect(fixtures[0]).toHaveProperty('teams.awayTeamId');
    expect(fixtures[0]).toHaveProperty('stage');
    expect(fixtures[0]).toHaveProperty('finalScore');
  });

  test('getUpcomingFixtures returns n fixtures after reference date', () => {
    const before = new Date('2026-06-01T00:00:00Z');
    const upcoming = getUpcomingFixtures(3, before);
    expect(upcoming.length).toBe(3);
    for (const fixture of upcoming) {
      expect(new Date(fixture.dateAndTimeInUTC).getTime()).toBeGreaterThan(before.getTime());
    }
  });

  test('getUpcomingFixtures returns fixtures in chronological order', () => {
    const before = new Date('2026-06-01T00:00:00Z');
    const upcoming = getUpcomingFixtures(3, before);
    for (let i = 1; i < upcoming.length; i++) {
      expect(new Date(upcoming[i].dateAndTimeInUTC).getTime()).toBeGreaterThanOrEqual(
        new Date(upcoming[i - 1].dateAndTimeInUTC).getTime(),
      );
    }
  });

  test('getUpcomingFixtures defaults to current time when no reference date', () => {
    const upcoming = getUpcomingFixtures(3);
    expect(upcoming.length).toBeLessThanOrEqual(3);
  });

  test('getGroups returns groups with teams', () => {
    const groups = getGroups();
    const keys = Object.keys(groups);
    expect(keys.length).toBeGreaterThan(0);
    for (const group of keys) {
      expect(groups[group].length).toBeGreaterThan(0);
      expect(groups[group][0]).toHaveProperty('id');
      expect(groups[group][0]).toHaveProperty('name');
    }
  });

  test('getPlayers returns players for a valid team', () => {
    const usaPlayers = getPlayers('USA');
    expect(usaPlayers.length).toBeGreaterThan(0);
    for (const player of usaPlayers) {
      expect(player.teamId).toBe('USA');
      expect(player).toHaveProperty('name');
      expect(player).toHaveProperty('position');
    }
  });

  test('getPlayers returns empty array for unknown team', () => {
    const result = getPlayers('XYZ');
    expect(result).toEqual([]);
  });
});

describe('tiered data resolution', () => {
  afterEach(() => {
    // Reset live cache between tests
    setLiveCache(null);
  });

  describe('getFixtureById', () => {
    test('returns fixture from static schedule (tier 3)', () => {
      const fixture = getFixtureById(1);
      expect(fixture).not.toBeNull();
      expect(fixture.id).toBe(1);
      expect(fixture.teams.homeTeamId).toEqual(expect.any(String));
      expect(fixture.teams.awayTeamId).toEqual(expect.any(String));
    });

    test('returns null for unknown fixture id', () => {
      const fixture = getFixtureById(9999);
      expect(fixture).toBeNull();
    });

    test('returns live cache data when available (tier 1)', () => {
      const mockCache = {
        getFixture: (id) =>
          id === 1 ? { status: 'First Half', finalScore: { home: 2, away: 1 }, events: [] } : null,
      };
      setLiveCache(mockCache);

      const fixture = getFixtureById(1);
      expect(fixture.status).toBe('First Half');
      expect(fixture.finalScore.home).toBe(2);
      expect(fixture.finalScore.away).toBe(1);
      // Should still have base data merged
      expect(fixture.teams.homeTeamId).toEqual(expect.any(String));
    });

    test('returns detail file data when available (tier 2)', () => {
      // Fixture 1 has a committed detail file (1-MEX-RSA.json)
      const fixture = getFixtureById(1);
      expect(fixture.status).toBe('Match Finished');
      expect(fixture.finalScore.home).toEqual(expect.any(Number));
      expect(fixture.events.length).toBeGreaterThan(0);
    });

    test('live cache takes priority over detail file (tier 1 > tier 2)', () => {
      // Fixture 1 has a committed detail file, but live cache should win
      const mockCache = {
        getFixture: (id) =>
          id === 1 ? { status: 'Second Half', finalScore: { home: 2, away: 1 } } : null,
      };
      setLiveCache(mockCache);

      const fixture = getFixtureById(1);
      // Live cache wins
      expect(fixture.status).toBe('Second Half');
      expect(fixture.finalScore.home).toBe(2);
    });
  });

  describe('getFixtureEvents', () => {
    test('returns empty array when no events available', () => {
      // Non-existent fixture has no cache, no detail file, no events
      const events = getFixtureEvents(9999);
      expect(events).toEqual([]);
    });

    test('returns events from live cache', () => {
      const mockEvents = [
        { type: 'goal', minute: 23, player: 'Pulisic' },
        { type: 'goal', minute: 51, player: 'Weah' },
      ];
      const mockCache = {
        getFixture: (id) => (id === 1 ? { events: mockEvents } : null),
      };
      setLiveCache(mockCache);

      const events = getFixtureEvents(1);
      expect(events).toEqual(mockEvents);
    });

    test('returns events from detail file', () => {
      // Fixture 1 has a committed detail file with real events
      const events = getFixtureEvents(1);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toHaveProperty('type');
      expect(events[0]).toHaveProperty('minute');
    });
  });

  describe('getLiveScore', () => {
    test('returns null when no score data', () => {
      const score = getLiveScore(9999); // Non-existent fixture
      expect(score).toBeNull();
    });

    test('returns score from live cache', () => {
      const mockCache = {
        getFixture: (id) =>
          id === 1
            ? { status: 'Second Half', elapsed: 67, finalScore: { home: 1, away: 0 } }
            : null,
      };
      setLiveCache(mockCache);

      const score = getLiveScore(1);
      expect(score).toEqual({
        status: 'Second Half',
        elapsed: 67,
        home: 1,
        away: 0,
      });
    });

    test('surfaces stale flag from live cache', () => {
      const mockCache = {
        getFixture: (id) =>
          id === 1
            ? { status: 'First Half', elapsed: 30, finalScore: { home: 0, away: 0 }, stale: true }
            : null,
      };
      setLiveCache(mockCache);

      const score = getLiveScore(1);
      expect(score.stale).toBe(true);
      expect(score.elapsed).toBe(30);
    });

    test('does not include stale flag when data is fresh', () => {
      const mockCache = {
        getFixture: (id) =>
          id === 1
            ? { status: 'Second Half', elapsed: 55, finalScore: { home: 1, away: 1 } }
            : null,
      };
      setLiveCache(mockCache);

      const score = getLiveScore(1);
      expect(score.stale).toBeUndefined();
    });

    test('returns score from detail file for finished fixture', () => {
      // Fixture 1 has a committed detail file with Match Finished status
      const score = getLiveScore(1);
      expect(score).not.toBeNull();
      expect(score.status).toBe('Match Finished');
      expect(score.home).toEqual(expect.any(Number));
      expect(score.away).toEqual(expect.any(Number));
    });
  });

  describe('getLiveFixtures', () => {
    test('returns empty array when liveCache is null', () => {
      setLiveCache(null);
      expect(getLiveFixtures()).toEqual([]);
    });

    test('returns only fixtures with an active (long) live status', () => {
      const mockCache = {
        getFixture: (id) => {
          if (id === 1) {
            return { status: 'Halftime', elapsed: null, finalScore: { home: 0, away: 0 } };
          }
          if (id === 2) {
            return { status: 'Second Half', elapsed: 67, finalScore: { home: 2, away: 1 } };
          }
          if (id === 3) {
            return { status: 'Match Finished', finalScore: { home: 1, away: 0 } };
          }
          return null;
        },
      };
      setLiveCache(mockCache);

      const live = getLiveFixtures();
      const ids = live.map((f) => f.id);

      // Fixtures 1 (Halftime) and 2 (Second Half) are live; 3 (Match Finished) is excluded
      expect(ids).toEqual([1, 2]);
      // Merged result carries both base (teams) and live (status/score) fields
      expect(live[0]).toHaveProperty('teams.homeTeamId');
      expect(live[0].status).toBe('Halftime');
      expect(live[1].status).toBe('Second Half');
      expect(live[1].finalScore).toEqual({ home: 2, away: 1 });
    });
  });
});
