'use strict';

const cache = require('../live-data/cache');

describe('Live data cache', () => {
  beforeEach(() => {
    cache.clear();
  });

  describe('updateFixtures', () => {
    it('stores fixtures by internal ID', () => {
      const fixtures = [
        [1, { status: 'First Half', finalScore: { home: 1, away: 0 } }],
        [2, { status: 'Second Half', finalScore: { home: 2, away: 1 } }],
      ];

      cache.updateFixtures(fixtures);

      expect(cache.getFixture(1)).toEqual({
        status: 'First Half',
        finalScore: { home: 1, away: 0 },
      });
      expect(cache.getFixture(2)).toEqual({
        status: 'Second Half',
        finalScore: { home: 2, away: 1 },
      });
    });

    it('resets failure count on successful update', () => {
      cache.recordFailure();
      cache.recordFailure();

      const stats = cache.getStats();
      expect(stats.failureCount).toBe(2);

      cache.updateFixtures([[1, { status: 'Match Finished' }]]);

      const updatedStats = cache.getStats();
      expect(updatedStats.failureCount).toBe(0);
      expect(updatedStats.isStale).toBe(false);
    });
  });

  describe('getFixture', () => {
    it('returns cached fixture data', () => {
      cache.updateFixtures([[5, { status: 'First Half', finalScore: { home: 1, away: 1 } }]]);

      const result = cache.getFixture(5);
      expect(result).toEqual({
        status: 'First Half',
        finalScore: { home: 1, away: 1 },
      });
    });

    it('returns null for uncached fixture', () => {
      const result = cache.getFixture(9999);
      expect(result).toBeNull();
    });

    it('adds stale flag when cache is marked stale', () => {
      cache.updateFixtures([[1, { status: 'First Half' }]]);
      cache.markStale();

      const result = cache.getFixture(1);
      expect(result.stale).toBe(true);
      expect(result.status).toBe('First Half');
    });
  });

  describe('exponential backoff', () => {
    it('implements 15s -> 30s -> 60s -> 120s backoff', () => {
      expect(cache.recordFailure()).toBe(15000); // 1st failure
      expect(cache.recordFailure()).toBe(30000); // 2nd failure
      expect(cache.recordFailure()).toBe(60000); // 3rd failure
      expect(cache.recordFailure()).toBe(120000); // 4th failure
      expect(cache.recordFailure()).toBe(120000); // 5th+ failures capped at 120s
    });
  });

  describe('markStale', () => {
    it('marks cache as stale after 5 failures', () => {
      cache.recordFailure();
      cache.recordFailure();
      cache.recordFailure();
      cache.recordFailure();

      let stats = cache.getStats();
      expect(stats.isStale).toBe(false);

      cache.recordFailure(); // 5th failure

      stats = cache.getStats();
      expect(stats.isStale).toBe(true);
    });

    it('can be called manually', () => {
      cache.markStale();

      const stats = cache.getStats();
      expect(stats.isStale).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns cache statistics', () => {
      cache.updateFixtures([
        [1, { status: 'First Half' }],
        [2, { status: 'Second Half' }],
      ]);
      cache.recordFailure();

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.isStale).toBe(false);
    });
  });

  describe('clear', () => {
    it('resets cache to empty state', () => {
      cache.updateFixtures([[1, { status: 'First Half' }]]);
      cache.recordFailure();
      cache.markStale();

      cache.clear();

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.failureCount).toBe(0);
      expect(stats.isStale).toBe(false);
    });
  });
});
