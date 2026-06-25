'use strict';

const { getTodayUTC, isMatchLive } = require('../lib/dates');

describe('Date utilities', () => {
  describe('getTodayUTC', () => {
    it('returns date in YYYY-MM-DD format', () => {
      const result = getTodayUTC();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns UTC date not local date', () => {
      const result = getTodayUTC();
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const day = String(now.getUTCDate()).padStart(2, '0');
      const expected = `${year}-${month}-${day}`;
      expect(result).toBe(expected);
    });
  });

  describe('isMatchLive', () => {
    it('returns true for live match statuses', () => {
      expect(isMatchLive('First Half')).toBe(true);
      expect(isMatchLive('Kick Off')).toBe(true);
      expect(isMatchLive('Halftime')).toBe(true);
      expect(isMatchLive('Second Half')).toBe(true);
      expect(isMatchLive('2nd Half Started')).toBe(true);
      expect(isMatchLive('Extra Time')).toBe(true);
      expect(isMatchLive('Break Time')).toBe(true);
      expect(isMatchLive('Penalty In Progress')).toBe(true);
      expect(isMatchLive('Match Suspended')).toBe(true);
      expect(isMatchLive('Match Interrupted')).toBe(true);
    });

    it('returns false for non-live statuses', () => {
      expect(isMatchLive('Time To Be Defined')).toBe(false);
      expect(isMatchLive('Not Started')).toBe(false);
      expect(isMatchLive('Match Finished')).toBe(false);
      expect(isMatchLive('Match Postponed')).toBe(false);
      expect(isMatchLive('Match Cancelled')).toBe(false);
      expect(isMatchLive('Match Abandoned')).toBe(false);
      expect(isMatchLive('Technical Loss')).toBe(false);
      expect(isMatchLive('WalkOver')).toBe(false);
      expect(isMatchLive('In Progress')).toBe(false);
    });

    it('returns false for comma-joined forms (separate-values guard)', () => {
      expect(isMatchLive('First Half, Kick Off')).toBe(false);
      expect(isMatchLive('Second Half, 2nd Half Started')).toBe(false);
    });
  });
});
