'use strict';

const { mapLiveFixture } = require('../live-data/mapper');

describe('live-data/mapper', () => {
  describe('mapLiveFixture', () => {
    it('extracts status and scores from API fixture', () => {
      const apiFixture = {
        fixture: {
          id: 1489369,
          status: {
            long: 'Second Half',
            elapsed: 67,
          },
        },
        goals: {
          home: 2,
          away: 1,
        },
        score: {
          halftime: { home: 1, away: 0 },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
      };

      const result = mapLiveFixture(apiFixture);

      expect(result).toEqual({
        status: 'Second Half',
        elapsed: 67,
        finalScore: {
          home: 2,
          away: 1,
        },
        score: {
          halftime: { home: 1, away: 0 },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
        events: [],
      });
    });

    it('handles finished match with fulltime score', () => {
      const apiFixture = {
        fixture: {
          status: {
            long: 'Match Finished',
            elapsed: 90,
          },
        },
        goals: {
          home: 3,
          away: 2,
        },
        score: {
          halftime: { home: 2, away: 1 },
          fulltime: { home: 3, away: 2 },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
      };

      const result = mapLiveFixture(apiFixture);

      expect(result.status).toBe('Match Finished');
      expect(result.elapsed).toBe(90);
      expect(result.finalScore).toEqual({ home: 3, away: 2 });
      expect(result.score.fulltime).toEqual({ home: 3, away: 2 });
    });

    it('handles match with extra time and penalties', () => {
      const apiFixture = {
        fixture: {
          status: {
            long: 'Match Finished After Penalties',
            elapsed: 120,
          },
        },
        goals: {
          home: 2,
          away: 2,
        },
        score: {
          halftime: { home: 1, away: 1 },
          fulltime: { home: 2, away: 2 },
          extratime: { home: 2, away: 2 },
          penalty: { home: 4, away: 3 },
        },
      };

      const result = mapLiveFixture(apiFixture);

      expect(result.status).toBe('Match Finished After Penalties');
      expect(result.elapsed).toBe(120);
      expect(result.score.extratime).toEqual({ home: 2, away: 2 });
      expect(result.score.penalty).toEqual({ home: 4, away: 3 });
    });

    it('maps events from API response', () => {
      const apiFixture = {
        fixture: {
          status: { long: 'First Half', elapsed: 23 },
        },
        goals: { home: 1, away: 0 },
        score: {
          halftime: { home: null, away: null },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
        events: [
          {
            type: 'Goal',
            time: { elapsed: 23, extra: null },
            team: { id: 16 },
            player: { id: 35532, name: 'J. Quinones' },
            assist: { id: 266345, name: 'E. Lira' },
            detail: 'Normal Goal',
            comments: null,
          },
        ],
        statistics: [{ team: { id: 16 }, stats: [] }],
      };

      const result = mapLiveFixture(apiFixture);

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toEqual({
        type: 'Goal',
        minute: 23,
        extraMinute: null,
        teamId: 'MEX',
        teamExternalId: 16,
        playerExternalId: 35532,
        playerName: 'J. Quinones',
        assistPlayerExternalId: 266345,
        assistPlayerName: 'E. Lira',
        detail: 'Normal Goal',
        comments: null,
      });
      // Statistics not included
      expect(result.statistics).toBeUndefined();
    });

    it('resolves playerName to the canonical squad name by externalId', () => {
      const apiFixture = {
        fixture: { status: { long: 'First Half', elapsed: 4 } },
        goals: { home: 0, away: 0 },
        score: {
          halftime: { home: null, away: null },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
        events: [
          {
            type: 'Card',
            time: { elapsed: 4, extra: null },
            team: { id: 2386 },
            player: { id: 20850, name: 'Carlens Arcus' },
            assist: { id: null, name: null },
            detail: 'Yellow Card',
            comments: 'Foul',
          },
        ],
      };

      const result = mapLiveFixture(apiFixture);

      // API sent the full name; the mapper rewrites it to the squad's short form.
      expect(result.events[0].playerName).toBe('C. Arcus');
      expect(result.events[0].playerExternalId).toBe(20850);
    });

    it('resolves the assist playerName to the canonical squad name', () => {
      const apiFixture = {
        fixture: { status: { long: 'Second Half', elapsed: 46 } },
        goals: { home: 0, away: 0 },
        score: {
          halftime: { home: null, away: null },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
        events: [
          {
            type: 'subst',
            time: { elapsed: 46, extra: null },
            team: { id: 2386 },
            player: { id: 20850, name: 'Carlens Arcus' },
            assist: { id: 194242, name: 'Duckens Simon' },
            detail: 'Substitution 1',
            comments: null,
          },
        ],
      };

      const result = mapLiveFixture(apiFixture);

      expect(result.events[0].playerName).toBe('C. Arcus');
      expect(result.events[0].assistPlayerName).toBe('D. Simon');
    });

    it('falls back to the API name when the player id is not in any squad', () => {
      const apiFixture = {
        fixture: { status: { long: 'First Half', elapsed: 10 } },
        goals: { home: 0, away: 0 },
        score: {
          halftime: { home: null, away: null },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
        events: [
          {
            type: 'Goal',
            time: { elapsed: 10, extra: null },
            team: { id: 2386 },
            player: { id: 99999999, name: 'Unsynced Callup' },
            assist: { id: null, name: null },
            detail: 'Normal Goal',
            comments: null,
          },
        ],
      };

      const result = mapLiveFixture(apiFixture);

      expect(result.events[0].playerName).toBe('Unsynced Callup');
      expect(result.events[0].assistPlayerName).toBeNull();
    });

    it('handles null elapsed (e.g. halftime)', () => {
      const apiFixture = {
        fixture: {
          status: { long: 'Halftime', elapsed: null },
        },
        goals: { home: 0, away: 0 },
        score: {
          halftime: { home: 0, away: 0 },
          fulltime: { home: null, away: null },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
      };

      const result = mapLiveFixture(apiFixture);

      expect(result.status).toBe('Halftime');
      expect(result.elapsed).toBeNull();
      expect(result.events).toEqual([]);
    });
  });
});
