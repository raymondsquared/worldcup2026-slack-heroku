'use strict';

const { slackDate, utcTime } = require('../lib/format');

describe('lib/format', () => {
  describe('slackDate', () => {
    test('emits a Slack <!date> token with epoch and fallback', () => {
      const out = slackDate('2026-06-20T19:00:00+00:00');
      expect(out).toMatch(/^<!date\^\d+\^\{date_short\} at \{time\}\|.+>$/);
      // epoch for 2026-06-20T19:00:00Z
      expect(out).toContain(`^${Math.floor(Date.parse('2026-06-20T19:00:00Z') / 1000)}^`);
    });
  });

  describe('utcTime', () => {
    test('formats UTC hours:minutes with a UTC suffix', () => {
      expect(utcTime('2026-06-20T19:00:00+00:00')).toBe('19:00 UTC');
    });

    test('zero-pads single-digit hours and minutes', () => {
      expect(utcTime('2026-06-20T05:07:00+00:00')).toBe('05:07 UTC');
    });

    test('renders in UTC regardless of source offset', () => {
      // 21:30+02:00 == 19:30 UTC
      expect(utcTime('2026-06-20T21:30:00+02:00')).toBe('19:30 UTC');
    });

    test('handles midnight UTC', () => {
      expect(utcTime('2026-06-20T00:00:00Z')).toBe('00:00 UTC');
    });

    test('returns empty string for an unparseable date (no NaN:NaN)', () => {
      expect(utcTime('not-a-date')).toBe('');
      expect(utcTime(undefined)).toBe('');
    });
  });
});
