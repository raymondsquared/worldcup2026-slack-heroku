'use strict';

const playlistPage1 = require('./playlist.sample.json');
const sampleFixtures = require('./fixtures.sample.json');

const MOCK_KEY = 'test-highlights-key';

describe('highlights API integration', () => {
  let originalFetch;
  let originalEnv;

  beforeAll(() => {
    originalFetch = global.fetch;
    originalEnv = process.env;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      HIGHLIGHTS_API_KEY: MOCK_KEY,
      HIGHLIGHTS_PLAYLIST_ID: 'PLBRLtDhTHh5o',
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => playlistPage1,
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    console.log.mockRestore();
    console.warn.mockRestore();
  });

  test('real API response parses into expected video objects', async () => {
    const { fetchPlaylistItems } = require('../../highlights/client');
    const videos = await fetchPlaylistItems();

    expect(videos).toHaveLength(8);
    expect(videos[0]).toEqual({
      videoId: 'PmevGCkUtM8',
      title: 'Highlights | Mexico 2-0 South Africa | FIFA World Cup 2026',
      publishedAt: '2026-06-12T04:30:00Z',
      url: 'https://www.youtube.com/watch?v=PmevGCkUtM8',
    });
  });

  test('full pipeline: 6 highlight videos match their correct fixtures', async () => {
    const { fetchPlaylistItems } = require('../../highlights/client');
    const { matchVideosToFixtures } = require('../../highlights/adapter');

    const videos = await fetchPlaylistItems();
    const matches = matchVideosToFixtures(videos, sampleFixtures);

    // 8 videos total, 6 are highlights, 2 skipped (press conf + goals)
    expect(matches).toHaveLength(6);

    const byFixture = new Map(matches.map((m) => [m.fixture.id, m]));
    expect(byFixture.get(1).videoId).toBe('PmevGCkUtM8');   // Mexico 2-0 South Africa
    expect(byFixture.get(2).videoId).toBe('6k18EJY8zIc');   // Korea Republic 2-1 Czechia
    expect(byFixture.get(3).videoId).toBe('w-_rY5morQY');   // Canada 1-1 Bosnia & Herzegovina
    expect(byFixture.get(4).videoId).toBe('0PVo3bk-TMk');   // USA 4-1 Paraguay
    expect(byFixture.get(5).videoId).toBe('KVz43-eddIQ');   // Qatar 1-1 Switzerland
    expect(byFixture.get(6).videoId).toBe('gerCur01');      // Germany 7-1 Curacao
  });

  test('match output shape satisfies enrich contract', async () => {
    const { fetchPlaylistItems } = require('../../highlights/client');
    const { matchVideosToFixtures } = require('../../highlights/adapter');

    const videos = await fetchPlaylistItems();
    const matches = matchVideosToFixtures(videos, sampleFixtures);

    for (const match of matches) {
      expect(match).toHaveProperty('fixture.id');
      expect(match).toHaveProperty('videoId');
      expect(match).toHaveProperty('url');
      expect(match).toHaveProperty('title');
      expect(typeof match.fixture.id).toBe('number');
      expect(match.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
    }
  });
});
