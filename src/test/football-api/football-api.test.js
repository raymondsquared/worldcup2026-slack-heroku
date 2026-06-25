'use strict';

const MOCK_KEY = 'test-api-key-12345';
const MOCK_URL = 'https://v3.football.api-sports.io';

describe('live-data/api', () => {
  let api;
  let originalFetch;

  beforeAll(() => {
    process.env.FOOTBALL_API_KEY = MOCK_KEY;
    process.env.FOOTBALL_API_URL = MOCK_URL;
    originalFetch = global.fetch;
  });

  afterAll(() => {
    delete process.env.FOOTBALL_API_KEY;
    delete process.env.FOOTBALL_API_URL;
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.resetModules();
    process.env.FOOTBALL_API_KEY = MOCK_KEY;
    process.env.FOOTBALL_API_URL = MOCK_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(responseBody, status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(responseBody),
      text: () => Promise.resolve(JSON.stringify(responseBody)),
    });
  }

  function loadApi() {
    return require('../../live-data/api');
  }

  describe('fetchLiveFixtures', () => {
    it('calls /fixtures?live=all with correct headers', async () => {
      const fixture = { response: [{ fixture: { id: 1 } }] };
      mockFetch(fixture);
      api = loadApi();

      const result = await api.fetchLiveFixtures();

      expect(result).toEqual(fixture);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_URL}/fixtures?live=all`,
        expect.objectContaining({
          method: 'GET',
          headers: { 'x-apisports-key': MOCK_KEY },
        }),
      );
    });
  });

  describe('fetchFixturesByDate', () => {
    it('calls /fixtures?date=YYYY-MM-DD', async () => {
      const fixture = { response: [{ fixture: { id: 2 } }] };
      mockFetch(fixture);
      api = loadApi();

      const result = await api.fetchFixturesByDate('2026-06-16');

      expect(result).toEqual(fixture);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_URL}/fixtures?date=2026-06-16`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('fetchSquad', () => {
    it('calls /players/squads?team={id}', async () => {
      const squad = { response: [{ team: { id: 33 }, players: [] }] };
      mockFetch(squad);
      api = loadApi();

      const result = await api.fetchSquad(33);

      expect(result).toEqual(squad);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_URL}/players/squads?team=33`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('error handling', () => {
    it('throws on non-2xx without exposing API key', async () => {
      mockFetch({ message: `Invalid key: ${MOCK_KEY}` }, 401);
      api = loadApi();

      await expect(api.fetchLiveFixtures()).rejects.toThrow(/401/);
      await expect(api.fetchLiveFixtures()).rejects.not.toThrow(MOCK_KEY);
    });

    it('throws descriptive error on timeout', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
        );
      api = loadApi();

      await expect(api.fetchLiveFixtures()).rejects.toThrow(/timed out/);
    });

    it('sanitizes API key from network errors', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error(`Connection failed for key ${MOCK_KEY}`));
      api = loadApi();

      await expect(api.fetchLiveFixtures()).rejects.toThrow(/\[REDACTED\]/);
      await expect(api.fetchLiveFixtures()).rejects.not.toThrow(MOCK_KEY);
    });
  });

  describe('missing env var', () => {
    it('throws if FOOTBALL_API_KEY is not set', () => {
      delete process.env.FOOTBALL_API_KEY;

      expect(() => loadApi()).toThrow(/FOOTBALL_API_KEY/);
    });
  });
});
