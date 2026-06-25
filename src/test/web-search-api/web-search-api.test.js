'use strict';

describe('web-search/client', () => {
  const ORIGINAL_ENV = process.env;
  const MOCK_URL = 'https://api.tavily.com/search';

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, WEB_SEARCH_API_KEY: 'test-key', WEB_SEARCH_API_URL: MOCK_URL };
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    delete global.fetch;
  });

  test('returns structured results on success', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: 'Result 1', content: 'Snippet 1', url: 'https://example.com/1' },
          { title: 'Result 2', content: 'Snippet 2', url: 'https://example.com/2' },
        ],
      }),
    });

    const { search } = require('../../web-search/client');
    const results = await search('world cup 2026');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Result 1',
      snippet: 'Snippet 1',
      url: 'https://example.com/1',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      MOCK_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('"query":"world cup 2026"'),
      }),
    );
  });

  test('returns null when no API key set', async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WEB_SEARCH_API_KEY;

    const { search } = require('../../web-search/client');
    const results = await search('test query');

    expect(results).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('throws on HTTP error without exposing API key', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
    });

    const { search } = require('../../web-search/client');

    await expect(search('test')).rejects.toThrow('Web search request failed (403)');
    await expect(search('test')).rejects.not.toThrow('test-key');
  });

  test('limits to 5 results max', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      content: `Snippet ${i}`,
      url: `https://example.com/${i}`,
    }));
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: manyResults }),
    });

    const { search } = require('../../web-search/client');
    const results = await search('test');

    expect(results).toHaveLength(5);
  });

  test('handles empty results gracefully', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const { search } = require('../../web-search/client');
    const results = await search('obscure query');

    expect(results).toEqual([]);
  });

  test('throws on network error', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    const { search } = require('../../web-search/client');

    await expect(search('test')).rejects.toThrow('Network error');
  });

  test('throws on timeout (AbortError)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'TimeoutError';
    global.fetch.mockRejectedValue(abortError);

    const { search } = require('../../web-search/client');

    await expect(search('test')).rejects.toThrow('The operation was aborted');
  });
});
