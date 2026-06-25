'use strict';

const { matchVideosToFixtures, normalize, extractTeams } = require('../highlights/adapter');

function makeVideo(videoId, title, publishedAt) {
  return {
    videoId,
    title,
    publishedAt,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function makeFixture(id, homeTeamId, awayTeamId, dateAndTimeInUTC) {
  return {
    id,
    dateAndTimeInUTC,
    teams: { homeTeamId, awayTeamId },
  };
}

describe('highlights/adapter', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  describe('normalize', () => {
    test('lowercases text', () => {
      expect(normalize('Mexico')).toBe('mexico');
    });

    test('strips diacritics', () => {
      expect(normalize('Türkiye')).toBe('turkiye');
    });

    test('handles combined marks', () => {
      expect(normalize('Gútierrez')).toBe('gutierrez');
    });

    test('trims whitespace', () => {
      expect(normalize('  Brazil  ')).toBe('brazil');
    });
  });

  describe('extractTeams', () => {
    test('extracts teams from traditional title format (matchup first)', () => {
      const teams = extractTeams('Mexico v South Africa | Match Highlights | FIFA World Cup 2026');
      expect(teams.has('MEX')).toBe(true);
      expect(teams.has('RSA')).toBe(true);
    });

    test('extracts teams from FIFA 2026 title format (highlights first, score separator)', () => {
      const teams = extractTeams('Highlights | Mexico 2-0 South Africa | FIFA World Cup 2026');
      expect(teams.has('MEX')).toBe(true);
      expect(teams.has('RSA')).toBe(true);
    });

    test('extracts teams from FIFA 2026 format with high scores', () => {
      const teams = extractTeams('Highlights | Germany 7-1 Curacao | FIFA World Cup 2026');
      expect(teams.has('GER')).toBe(true);
      expect(teams.has('CUW')).toBe(true);
    });

    test('extracts teams from FIFA 2026 format with draw score', () => {
      const teams = extractTeams('Highlights | Brazil 1-1 Morocco | FIFA World Cup 2026');
      expect(teams.has('BRA')).toBe(true);
      expect(teams.has('MAR')).toBe(true);
    });

    test('handles vs separator', () => {
      const teams = extractTeams('Mexico vs South Africa | Highlights');
      expect(teams.has('MEX')).toBe(true);
      expect(teams.has('RSA')).toBe(true);
    });

    test('handles dash separator', () => {
      const teams = extractTeams('Mexico - South Africa | Highlights');
      expect(teams.has('MEX')).toBe(true);
      expect(teams.has('RSA')).toBe(true);
    });

    test('matches FIFA codes', () => {
      const teams = extractTeams('MEX v RSA | Highlights');
      expect(teams.has('MEX')).toBe(true);
      expect(teams.has('RSA')).toBe(true);
    });

    test('matches aliases', () => {
      const teams = extractTeams('Korea Republic v United States | Highlights');
      expect(teams.has('KOR')).toBe(true);
      expect(teams.has('USA')).toBe(true);
    });

    test('handles title without pipe character', () => {
      // Without |, full title is used. Split on " v " gives
      // ["Mexico", "South Africa Match Highlights"] - second part
      // won't match because it's not an exact team name lookup.
      // This is expected: non-standard titles may partially match.
      const teams = extractTeams('Mexico v South Africa');
      expect(teams.has('MEX')).toBe(true);
      expect(teams.has('RSA')).toBe(true);
    });

    test('returns empty set for unrecognized teams', () => {
      const teams = extractTeams('Unknown v Nobody | Highlights');
      expect(teams.size).toBe(0);
    });
  });

  describe('matchVideosToFixtures', () => {
    test('matches video to fixture by exact team names', () => {
      const videos = [
        makeVideo(
          'v1',
          'Mexico v South Africa | Match Highlights | FIFA World Cup 2026',
          '2026-06-12T08:00:00Z',
        ),
      ];
      const fixtures = [makeFixture(1, 'MEX', 'RSA', '2026-06-11T19:00:00+00:00')];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].fixture.id).toBe(1);
      expect(result[0].videoId).toBe('v1');
    });

    test('matches via FIFA codes', () => {
      const videos = [makeVideo('v1', 'MEX v RSA | Match Highlights', '2026-06-12T08:00:00Z')];
      const fixtures = [makeFixture(1, 'MEX', 'RSA', '2026-06-11T19:00:00+00:00')];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].fixture.id).toBe(1);
    });

    test('matches via country aliases', () => {
      const videos = [
        makeVideo('v1', 'Korea Republic v United States | Highlights', '2026-06-12T08:00:00Z'),
      ];
      const fixtures = [makeFixture(5, 'KOR', 'USA', '2026-06-12T02:00:00+00:00')];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].fixture.id).toBe(5);
    });

    test('handles diacritics in title', () => {
      const videos = [
        makeVideo('v1', 'Türkiye v Germany | Match Highlights', '2026-06-15T10:00:00Z'),
      ];
      const fixtures = [makeFixture(10, 'TUR', 'GER', '2026-06-15T02:00:00+00:00')];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].fixture.id).toBe(10);
    });

    test('multi-fixture day: matches correct fixture by date proximity', () => {
      const videos = [
        makeVideo('v1', 'Mexico v South Africa | Highlights', '2026-06-11T22:00:00Z'),
      ];
      const fixtures = [
        makeFixture(1, 'MEX', 'RSA', '2026-06-11T19:00:00+00:00'),
        makeFixture(2, 'MEX', 'RSA', '2026-06-14T19:00:00+00:00'),
      ];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].fixture.id).toBe(1);
    });

    test('skips videos without Highlight in title', () => {
      const videos = [
        makeVideo('v1', 'Mexico v South Africa | Press Conference', '2026-06-12T08:00:00Z'),
        makeVideo('v2', 'Mexico v South Africa | Match Highlights', '2026-06-12T08:00:00Z'),
      ];
      const fixtures = [makeFixture(1, 'MEX', 'RSA', '2026-06-11T19:00:00+00:00')];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].videoId).toBe('v2');
    });

    test('fixture with multiple videos: newer video wins', () => {
      const videos = [
        makeVideo('v1', 'Mexico v South Africa | Extended Highlights', '2026-06-12T08:00:00Z'),
        makeVideo('v2', 'Mexico v South Africa | Match Highlights', '2026-06-12T09:00:00Z'),
      ];
      const fixtures = [makeFixture(1, 'MEX', 'RSA', '2026-06-11T19:00:00+00:00')];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].videoId).toBe('v2');
    });

    test('fixture with multiple videos: older video does not replace newer', () => {
      const videos = [
        makeVideo('v1', 'Mexico v South Africa | Match Highlights', '2026-06-12T10:00:00Z'),
        makeVideo('v2', 'Mexico v South Africa | Extended Highlights', '2026-06-12T08:00:00Z'),
      ];
      const fixtures = [makeFixture(1, 'MEX', 'RSA', '2026-06-11T19:00:00+00:00')];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].videoId).toBe('v1');
    });

    test('logs unmatched highlight videos', () => {
      const videos = [
        makeVideo('v1', 'Unknown v Nobody | Match Highlights', '2026-06-12T08:00:00Z'),
      ];
      const fixtures = [makeFixture(1, 'MEX', 'RSA', '2026-06-11T19:00:00+00:00')];

      const result = matchVideosToFixtures(videos, fixtures);

      expect(result).toHaveLength(0);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('1 highlight video(s) unmatched'),
        expect.any(Array),
      );
    });

    test('returns empty array for empty videos', () => {
      const fixtures = [makeFixture(1, 'MEX', 'RSA', '2026-06-11T19:00:00+00:00')];
      expect(matchVideosToFixtures([], fixtures)).toEqual([]);
    });

    test('returns empty array for empty fixtures', () => {
      const videos = [
        makeVideo('v1', 'Mexico v South Africa | Highlights', '2026-06-12T08:00:00Z'),
      ];
      expect(matchVideosToFixtures(videos, [])).toEqual([]);
    });

    test('returns empty array for null inputs', () => {
      expect(matchVideosToFixtures(null, null)).toEqual([]);
      expect(matchVideosToFixtures(undefined, undefined)).toEqual([]);
    });
  });
});
