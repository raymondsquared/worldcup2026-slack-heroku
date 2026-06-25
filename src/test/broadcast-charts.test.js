'use strict';

const { possessionChartUrl, statsChartUrl, findStat, parsePossession } = require('../broadcast/charts');

const VALID_STATS = [
  {
    teamId: 1,
    statistics: [
      { type: 'Ball Possession', value: '60%' },
      { type: 'Total Shots', value: 15 },
      { type: 'Shots on Goal', value: 7 },
      { type: 'Passes %', value: '85%' },
      { type: 'Fouls', value: 12 },
    ],
  },
  {
    teamId: 2,
    statistics: [
      { type: 'Ball Possession', value: '40%' },
      { type: 'Total Shots', value: 8 },
      { type: 'Shots on Goal', value: 4 },
      { type: 'Passes %', value: '78%' },
      { type: 'Fouls', value: 9 },
    ],
  },
];

describe('broadcast/charts - findStat', () => {
  test('finds stat by teamId and type', () => {
    expect(findStat(VALID_STATS, 1, 'Ball Possession')).toBe('60%');
    expect(findStat(VALID_STATS, 2, 'Total Shots')).toBe(8);
  });

  test('returns null for missing teamId', () => {
    expect(findStat(VALID_STATS, 99, 'Ball Possession')).toBeNull();
  });

  test('returns null for missing stat type', () => {
    expect(findStat(VALID_STATS, 1, 'Nonexistent')).toBeNull();
  });

  test('returns null for null/undefined statistics', () => {
    expect(findStat(null, 1, 'Ball Possession')).toBeNull();
    expect(findStat(undefined, 1, 'Ball Possession')).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(findStat([], 1, 'Ball Possession')).toBeNull();
  });

  test('returns null when team has no statistics array', () => {
    const stats = [{ teamId: 1 }];
    expect(findStat(stats, 1, 'Ball Possession')).toBeNull();
  });
});

describe('broadcast/charts - parsePossession', () => {
  test('parses "75%" to 75', () => {
    expect(parsePossession('75%')).toBe(75);
  });

  test('parses "0%" to 0', () => {
    expect(parsePossession('0%')).toBe(0);
  });

  test('parses "100%" to 100', () => {
    expect(parsePossession('100%')).toBe(100);
  });

  test('returns null for null', () => {
    expect(parsePossession(null)).toBeNull();
  });

  test('returns null for undefined', () => {
    expect(parsePossession(undefined)).toBeNull();
  });

  test('returns null for non-numeric string', () => {
    expect(parsePossession('abc')).toBeNull();
  });
});

describe('broadcast/charts - possessionChartUrl', () => {
  test('returns valid URL with correct data', () => {
    const url = possessionChartUrl(VALID_STATS, 1, 2, 'USA', 'Mexico');

    expect(url).not.toBeNull();
    expect(url).toContain('https://quickchart.io/chart');
    expect(url).toContain('doughnut');
    expect(url).toContain('USA');
    expect(url).toContain('Mexico');
  });

  test('URL contains correct percentages (away first for left-side home rendering)', () => {
    const url = possessionChartUrl(VALID_STATS, 1, 2, 'USA', 'Mexico');
    const decoded = decodeURIComponent(url);

    expect(decoded).toContain('[40,60]');
  });

  test('returns null when statistics is null', () => {
    expect(possessionChartUrl(null, 1, 2, 'USA', 'Mexico')).toBeNull();
  });

  test('returns null when statistics is empty', () => {
    expect(possessionChartUrl([], 1, 2, 'USA', 'Mexico')).toBeNull();
  });

  test('returns null when possession stat is null', () => {
    const stats = [
      { teamId: 1, statistics: [{ type: 'Ball Possession', value: null }] },
      { teamId: 2, statistics: [{ type: 'Ball Possession', value: '40%' }] },
    ];
    expect(possessionChartUrl(stats, 1, 2, 'USA', 'Mexico')).toBeNull();
  });

  test('returns null when home team not found in stats', () => {
    expect(possessionChartUrl(VALID_STATS, 99, 2, 'USA', 'Mexico')).toBeNull();
  });

  test('handles 0% vs 100% edge case', () => {
    const stats = [
      { teamId: 1, statistics: [{ type: 'Ball Possession', value: '100%' }] },
      { teamId: 2, statistics: [{ type: 'Ball Possession', value: '0%' }] },
    ];
    const url = possessionChartUrl(stats, 1, 2, 'USA', 'Mexico');
    expect(url).not.toBeNull();

    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('[0,100]');
  });

  test('handles 50/50 split', () => {
    const stats = [
      { teamId: 1, statistics: [{ type: 'Ball Possession', value: '50%' }] },
      { teamId: 2, statistics: [{ type: 'Ball Possession', value: '50%' }] },
    ];
    const url = possessionChartUrl(stats, 1, 2, 'USA', 'Mexico');
    expect(url).not.toBeNull();

    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('[50,50]');
  });

  test('matches correct team by ID regardless of array order', () => {
    const reversed = [VALID_STATS[1], VALID_STATS[0]];
    const url = possessionChartUrl(reversed, 1, 2, 'USA', 'Mexico');
    const decoded = decodeURIComponent(url);

    // Away (teamId 2) is 40% first, home (teamId 1) is 60% second
    expect(decoded).toContain('[40,60]');
  });
});

describe('broadcast/charts - statsChartUrl', () => {
  test('returns valid URL with correct data', () => {
    const url = statsChartUrl(VALID_STATS, 1, 2, 'USA', 'Mexico');

    expect(url).not.toBeNull();
    expect(url).toContain('https://quickchart.io/chart');
    expect(url).toContain('horizontalBar');
    expect(url).toContain('USA');
    expect(url).toContain('Mexico');
  });

  test('URL contains all 4 stat labels', () => {
    const url = statsChartUrl(VALID_STATS, 1, 2, 'USA', 'Mexico');
    const decoded = decodeURIComponent(url);

    expect(decoded).toContain('Total Shots');
    expect(decoded).toContain('Shots on Goal');
    expect(decoded).toContain('Pass %');
    expect(decoded).toContain('Fouls');
  });

  test('URL contains correct values per team', () => {
    const url = statsChartUrl(VALID_STATS, 1, 2, 'USA', 'Mexico');
    const decoded = decodeURIComponent(url);

    // Home: [15, 7, 85, 12], Away: [8, 4, 78, 9]
    expect(decoded).toContain('15,7,85,12');
    expect(decoded).toContain('8,4,78,9');
  });

  test('returns null when statistics is null', () => {
    expect(statsChartUrl(null, 1, 2, 'USA', 'Mexico')).toBeNull();
  });

  test('returns null when statistics is empty', () => {
    expect(statsChartUrl([], 1, 2, 'USA', 'Mexico')).toBeNull();
  });

  test('returns null when Total Shots is null', () => {
    const stats = [
      { teamId: 1, statistics: [{ type: 'Total Shots', value: null }] },
      { teamId: 2, statistics: [{ type: 'Total Shots', value: 8 }] },
    ];
    expect(statsChartUrl(stats, 1, 2, 'USA', 'Mexico')).toBeNull();
  });

  test('returns null when Total Shots is not a number', () => {
    const stats = [
      { teamId: 1, statistics: [{ type: 'Total Shots', value: 'many' }] },
      { teamId: 2, statistics: [{ type: 'Total Shots', value: 8 }] },
    ];
    expect(statsChartUrl(stats, 1, 2, 'USA', 'Mexico')).toBeNull();
  });

  test('returns null when away team not found in stats', () => {
    expect(statsChartUrl(VALID_STATS, 1, 99, 'USA', 'Mexico')).toBeNull();
  });

  test('includes only Total Shots when other stats missing', () => {
    const stats = [
      { teamId: 1, statistics: [{ type: 'Total Shots', value: 10 }] },
      { teamId: 2, statistics: [{ type: 'Total Shots', value: 5 }] },
    ];
    const url = statsChartUrl(stats, 1, 2, 'USA', 'Mexico');
    const decoded = decodeURIComponent(url);

    expect(decoded).toContain('Total Shots');
    expect(decoded).not.toContain('Shots on Goal');
    expect(decoded).not.toContain('Pass %');
    expect(decoded).not.toContain('Fouls');
  });

  test('matches correct team by ID regardless of array order', () => {
    const reversed = [VALID_STATS[1], VALID_STATS[0]];
    const url = statsChartUrl(reversed, 1, 2, 'USA', 'Mexico');
    const decoded = decodeURIComponent(url);

    expect(decoded).toContain('15,7,85,12');
    expect(decoded).toContain('8,4,78,9');
  });
});
