'use strict';

const { getFlag } = require('../broadcast/flags');

describe('broadcast/flags', () => {
  test('returns correct flag for MEX', () => {
    // MX -> regional indicators M + X
    expect(getFlag('MEX')).toBe('\u{1F1F2}\u{1F1FD}');
  });

  test('returns correct flag for USA', () => {
    // US -> regional indicators U + S
    expect(getFlag('USA')).toBe('\u{1F1FA}\u{1F1F8}');
  });

  test('returns correct flag for ARG', () => {
    // AR -> regional indicators A + R
    expect(getFlag('ARG')).toBe('\u{1F1E6}\u{1F1F7}');
  });

  test('returns correct flag for RSA (special mapping ZA)', () => {
    // ZA -> regional indicators Z + A
    expect(getFlag('RSA')).toBe('\u{1F1FF}\u{1F1E6}');
  });

  test('returns Slack named emoji for UK constituent countries (shared GB ISO)', () => {
    // ENG and SCO both have flagISO "GB"; override to distinct named emoji
    expect(getFlag('ENG')).toBe(':flag-england:');
    expect(getFlag('SCO')).toBe(':flag-scotland:');
    // Distinct from each other and from the plain GB flag
    expect(getFlag('ENG')).not.toBe(getFlag('SCO'));
    expect(getFlag('SCO')).not.toBe('\u{1F1EC}\u{1F1E7}');
  });

  test('returns fallback flag for unknown team ID', () => {
    expect(getFlag('XYZ')).toBe('\u{1F3F3}\u{FE0F}');
  });

  test('returns fallback for null/undefined', () => {
    expect(getFlag(null)).toBe('\u{1F3F3}\u{FE0F}');
    expect(getFlag(undefined)).toBe('\u{1F3F3}\u{FE0F}');
  });
});
