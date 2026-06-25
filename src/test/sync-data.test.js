'use strict';

const path = require('node:path');
const fs = require('node:fs');

// Mock the live-data modules the lib depends on. The real api module throws at
// load time when FOOTBALL_API_KEY is unset, and both make network calls, so they
// must be stubbed before the lib is required.
jest.mock('../live-data/api', () => ({
  fetchFixturesByDate: jest.fn(),
  fetchFixtureById: jest.fn(),
  fetchSquad: jest.fn(),
  fetchStandings: jest.fn(),
}));

jest.mock('../live-data/mapper', () => ({
  mapFixtureWithEvents: jest.fn((fixture) => ({
    id: null,
    externalId: fixture.fixture.id,
    status: 'Match Finished',
    teams: { homeTeamId: null, awayTeamId: null },
    finalScore: { home: fixture.goals.home, away: fixture.goals.away },
    score: fixture.score || {},
    events: fixture.events || [],
    statistics: fixture.statistics || [],
  })),
  registerTeamMapping: jest.fn(),
}));

// Require the REAL sync lib. It is a pure module - requiring it runs no command
// and writes nothing - so we get the exported subcommands and helpers directly.
// (The CLI wrapper scripts/sync-data.js is the run-only entry point and is not
// imported here.)
const sync = require('../lib/sync-data');
const api = require('../live-data/api');

describe('sync-data script', () => {
  test('exports the testable subcommands and helpers', () => {
    for (const fn of [
      'syncTeams',
      'syncFixtures',
      'syncPlayers',
      'syncFixtureEvents',
      'syncAll',
      'buildTeamNameMap',
      'normalizeName',
      'resolveTeamId',
      'generateTeamId',
      'getDateRange',
    ]) {
      expect(typeof sync[fn]).toBe('function');
    }
  });

  describe('normalizeName', () => {
    test('strips combining diacritics from accented names', () => {
      expect(sync.normalizeName('Türkiye')).toBe('Turkiye');
      expect(sync.normalizeName('Gútierrez')).toBe('Gutierrez');
    });

    test('leaves plain ASCII names unchanged', () => {
      expect(sync.normalizeName('Pulisic')).toBe('Pulisic');
      expect(sync.normalizeName('South Korea')).toBe('South Korea');
    });
  });

  describe('getDateRange', () => {
    test('returns an inclusive UTC date range spanning a month boundary', () => {
      expect(sync.getDateRange('2026-06-29', '2026-07-02')).toEqual([
        '2026-06-29',
        '2026-06-30',
        '2026-07-01',
        '2026-07-02',
      ]);
    });

    test('returns a single date when start equals end', () => {
      expect(sync.getDateRange('2026-06-11', '2026-06-11')).toEqual(['2026-06-11']);
    });

    test('spans the full tournament window', () => {
      const range = sync.getDateRange('2026-06-11', '2026-07-19');
      expect(range).toHaveLength(39);
      expect(range[0]).toBe('2026-06-11');
      expect(range[range.length - 1]).toBe('2026-07-19');
    });
  });

  describe('buildTeamNameMap', () => {
    test('seeds the map with FIFA codes from countries.json', () => {
      const map = sync.buildTeamNameMap([]);
      expect(map.get('england')).toBe('ENG');
      expect(map.get('brazil')).toBe('BRA');
      // Country aliases are included alongside the canonical name.
      expect(map.get('turkiye')).toBe('TUR');
      expect(map.get('turkey')).toBe('TUR');
    });

    test('overlays teams.json entries on top of the FIFA baseline', () => {
      const map = sync.buildTeamNameMap([
        { name: 'England', id: 'ZZZ' }, // overrides the baseline ENG
        { name: 'Custom United', id: 'CUS' }, // name not in countries.json
      ]);
      expect(map.get('england')).toBe('ZZZ');
      expect(map.get('custom united')).toBe('CUS');
    });
  });

  describe('resolveTeamId', () => {
    const map = sync.buildTeamNameMap([]);

    test('resolves an API team name to its internal id', () => {
      expect(sync.resolveTeamId({ name: 'Brazil' }, map)).toBe('BRA');
    });

    test('normalizes accented API names before lookup', () => {
      expect(sync.resolveTeamId({ name: 'Türkiye' }, map)).toBe('TUR');
    });

    test('returns null when the team name is unknown', () => {
      expect(sync.resolveTeamId({ name: 'Atlantis' }, map)).toBeNull();
    });
  });

  describe('generateTeamId', () => {
    test('returns the FIFA code for a known country name', () => {
      expect(sync.generateTeamId('England')).toBe('ENG');
    });

    test('resolves via an alias and normalizes accents', () => {
      expect(sync.generateTeamId('Turkey')).toBe('TUR'); // alias of Turkiye
      expect(sync.generateTeamId('Türkiye')).toBe('TUR'); // accented canonical
    });

    test('falls back to a 3-letter uppercase code for unknown names', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(sync.generateTeamId('Atlantis')).toBe('ATL');
      expect(warn).toHaveBeenCalled(); // warns so a missing code gets noticed
      warn.mockRestore();
    });
  });

  // These exercise the real subcommands through the now-live api/mapper mocks.
  // They use empty API responses on purpose so each subcommand hits an early
  // return BEFORE writing - keeping the tests read-only against src/data.
  describe('subcommand dispatch (mocked api)', () => {
    let logSpy;
    let warnSpy;
    let errorSpy;

    beforeEach(() => {
      jest.clearAllMocks();
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    test('syncTeams calls the standings API and skips the write on empty data', async () => {
      api.fetchStandings.mockResolvedValue({ response: [] });

      await expect(sync.syncTeams()).resolves.toBeUndefined();

      expect(api.fetchStandings).toHaveBeenCalledWith(1, 2026);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No standings data'));
    });

    test('syncFixtureEvents reports a missing fixture without fetching or writing', async () => {
      const FIXTURES_DIR = path.join(__dirname, '..', 'data', 'fixtures');
      const before = fs.readdirSync(FIXTURES_DIR);

      await expect(sync.syncFixtureEvents(99999)).resolves.toBeUndefined();

      expect(api.fetchFixtureById).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('99999 not found'));
      // No new fixture file was written to the real data directory.
      expect(fs.readdirSync(FIXTURES_DIR)).toEqual(before);
    });
  });
});
